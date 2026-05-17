import { NextRequest, NextResponse } from 'next/server';
import { agentsRepo, registrationsRepo, sslRepo } from '@/db';
import { withErrorHandling } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
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

    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    try {
      const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const pending = await registrationsRepo.listStalePending(staleCutoff, 50);
      summary.stalePendingRegistrations = pending.length;

      for (const reg of pending) {
        try {
          if (reg.agentId) {
            await registrationsRepo.update(reg.id, {
              status: 'completed',
              completedAt: new Date(),
            });
            summary.reconciledRegistrations++;
            continue;
          }

          await registrationsRepo.update(reg.id, {
            status: 'failed',
            errorMessage: 'Reconciliation timeout - no agent record created',
          });
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

    try {
      const sslCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const stuckSsl = await agentsRepo.listStuckSsl(sslCutoff, 20);
      summary.stuckSslAgents = stuckSsl.length;

      for (const agent of stuckSsl) {
        try {
          const ssl = await sslRepo.getByAgent(agent.id);
          if (ssl) {
            const refreshed = await getCloudflareSaas().getHostname(
              ssl.cloudflareCustomHostnameId,
            );
            const ready = refreshed.status === 'active' && refreshed.sslStatus === 'active';
            await sslRepo.update(agent.id, {
              hostnameStatus: refreshed.status,
              sslStatus: refreshed.sslStatus,
              validationRecords: refreshed.validationRecords,
              validationErrors: refreshed.validationErrors,
              updatedAt: new Date(),
            });
            await agentsRepo.update(agent.id, {
              sslStatus: ready ? 'active' : 'provisioning',
              updatedAt: new Date(),
            });
            continue;
          }
          await agentsRepo.update(agent.id, { sslStatus: 'failed', updatedAt: new Date() });
        } catch (e) {
          summary.errors.push(`ssl ${agent.id}: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    } catch (e) {
      summary.errors.push(`task2 ${e instanceof Error ? e.message : String(e)}`);
      captureException(e, { task: 'reconcile.stuck_ssl' }).catch(() => {});
    }

    try {
      const missingDns = await agentsRepo.listMissingDns(20);
      summary.retriedDnsAgents = missingDns.length;
      for (const agent of missingDns) {
        log.info('agent missing DNS - flagged for retry', { agentId: agent.id });
      }
    } catch (e) {
      summary.errors.push(`task3 ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const missingBasename = await agentsRepo.listMissingBasename(20);
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
