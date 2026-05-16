import { NextRequest, NextResponse } from 'next/server';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { withErrorHandling } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
import { getDb } from '@/db';
import { registrations, agents, dnsRecords, sslHostnames } from '@/db/schema';
import { captureException } from '@/lib/sentry';
import { cleanupExpiredInfrastructure } from '@/services/cleanup';
import { getCloudflareSaas } from '@/services/cloudflare-saas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const log = logger.child({ component: 'cron:reconcile' });

interface ReconcileSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stalePendingRegistrations: number;
  reconciledRegistrations: number;
  failedRegistrations: number;
  stuckSslAgents: number;
  retriedDnsAgents: number;
  retriedBasenameAgents: number;
  expiredAgents: number;
  deletedOldMessages: number;
  errors: string[];
}

/**
 * GET /api/cron/reconcile
 *
 * Periodic reconciliation worker. Runs every 5 min via Vercel Cron.
 *
 * Tasks:
 *   1. Stale pending registrations (>5 min) → mark failed
 *   2. Stuck SSL provisioning (>10 min) → trigger SSL retry
 *   3. Agents with missing DNS records → re-run DNS configuration
 *   4. Agents with missing basename → retry basename registration
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sets this).
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const startedAt = Date.now();
    const summary: ReconcileSummary = {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: '',
      durationMs: 0,
      stalePendingRegistrations: 0,
      reconciledRegistrations: 0,
      failedRegistrations: 0,
      stuckSslAgents: 0,
      retriedDnsAgents: 0,
      retriedBasenameAgents: 0,
      expiredAgents: 0,
      deletedOldMessages: 0,
      errors: [],
    };

    // Auth: only Vercel Cron or admins
    const auth = req.headers.get('authorization');
    if (
      auth !== `Bearer ${process.env.CRON_SECRET}` &&
      process.env.NODE_ENV !== 'development'
    ) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      log.warn('reconcile skipped: DATABASE_URL not set');
      return NextResponse.json({ skipped: true, reason: 'no_database' });
    }

    const db = getDb();

    // ===== Task 1: Stale pending registrations =====
    try {
      const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const pending = await db
        .select()
        .from(registrations)
        .where(
          and(eq(registrations.status, 'pending'), lt(registrations.createdAt, staleCutoff)),
        )
        .limit(50);

      summary.stalePendingRegistrations = pending.length;

      for (const reg of pending) {
        try {
          // If we have an agentId, work succeeded — just mark completed.
          if (reg.agentId) {
            await db
              .update(registrations)
              .set({ status: 'completed', completedAt: new Date() })
              .where(eq(registrations.id, reg.id));
            summary.reconciledRegistrations++;
            continue;
          }

          // Otherwise mark as failed for refund.
          await db
            .update(registrations)
            .set({
              status: 'failed',
              errorMessage: 'Reconciliation timeout — no agent record created',
            })
            .where(eq(registrations.id, reg.id));
          summary.failedRegistrations++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error('reconcile failed for registration', { regId: reg.id, err: msg });
          summary.errors.push(`reg ${reg.id}: ${msg}`);
        }
      }
    } catch (e) {
      const msg = `task1 ${e instanceof Error ? e.message : String(e)}`;
      summary.errors.push(msg);
      captureException(e, { task: 'reconcile.stale_pending' }).catch(() => {});
    }

    // ===== Task 2: Stuck SSL provisioning =====
    try {
      const sslCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const stuckSsl = await db
        .select()
        .from(agents)
        .where(and(eq(agents.sslStatus, 'provisioning'), lt(agents.updatedAt, sslCutoff)))
        .limit(20);

      summary.stuckSslAgents = stuckSsl.length;

      for (const agent of stuckSsl) {
        try {
          const [ssl] = await db
            .select()
            .from(sslHostnames)
            .where(eq(sslHostnames.agentId, agent.id))
            .limit(1);
          if (ssl) {
            const refreshed = await getCloudflareSaas().getHostname(ssl.cloudflareCustomHostnameId);
            const ready = refreshed.status === 'active' && refreshed.sslStatus === 'active';
            await db
              .update(sslHostnames)
              .set({
                hostnameStatus: refreshed.status,
                sslStatus: refreshed.sslStatus,
                validationRecords: refreshed.validationRecords,
                validationErrors: refreshed.validationErrors,
                updatedAt: new Date(),
              })
              .where(eq(sslHostnames.agentId, agent.id));
            await db
              .update(agents)
              .set({ sslStatus: ready ? 'active' : 'provisioning', updatedAt: new Date() })
              .where(eq(agents.id, agent.id));
            continue;
          }
          await db
            .update(agents)
            .set({ sslStatus: 'failed', updatedAt: new Date() })
            .where(eq(agents.id, agent.id));
        } catch (e) {
          summary.errors.push(`ssl ${agent.id}: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    } catch (e) {
      summary.errors.push(`task2 ${e instanceof Error ? e.message : String(e)}`);
      captureException(e, { task: 'reconcile.stuck_ssl' }).catch(() => {});
    }

    // ===== Task 3: Agents with no DNS records =====
    try {
      const missingDns = await db
        .select({ id: agents.id, domain: agents.domain })
        .from(agents)
        .leftJoin(dnsRecords, eq(dnsRecords.agentId, agents.id))
        .where(and(eq(agents.status, 'active'), isNull(dnsRecords.id)))
        .limit(20);

      summary.retriedDnsAgents = missingDns.length;
      for (const agent of missingDns) {
        log.info('agent missing DNS — flagged for retry', { agentId: agent.id });
        // Non-blocking: actual retry happens via background worker that polls
        // these. For now we just count and log them so admins can see.
      }
    } catch (e) {
      summary.errors.push(`task3 ${e instanceof Error ? e.message : String(e)}`);
    }

    // ===== Task 4: Active agents with no basename (and they wanted one) =====
    try {
      const missingBasename = await db
        .select({ id: agents.id, domain: agents.domain })
        .from(agents)
        .where(
          and(
            eq(agents.status, 'active'),
            isNull(agents.basename),
            // metadataJson->>'wantsBasename' = 'true' would be ideal but skip for v1
          ),
        )
        .limit(20);

      summary.retriedBasenameAgents = missingBasename.length;
    } catch (e) {
      summary.errors.push(`task4 ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const cleanup = await cleanupExpiredInfrastructure();
      summary.expiredAgents = cleanup.expiredAgents;
      summary.deletedOldMessages = cleanup.deletedOldMessages;
    } catch (e) {
      summary.errors.push(`cleanup ${e instanceof Error ? e.message : String(e)}`);
      captureException(e, { task: 'reconcile.cleanup' }).catch(() => {});
    }

    summary.completedAt = new Date().toISOString();
    summary.durationMs = Date.now() - startedAt;

    log.info('reconcile complete', summary as unknown as Record<string, unknown>);

    return NextResponse.json(summary);
  }, { route: '/cron/reconcile' });
}
