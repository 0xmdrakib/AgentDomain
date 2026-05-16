import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents, emailInboxes, sslHostnames } from '@/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/agents/repair' });

const repairSchema = z.object({
  action: z.enum(['dns', 'email', 'basename', 'ens']),
});

/**
 * POST /api/v1/admin/agents/{id}/repair
 *
 * Repair individual components of an agent identity after a partial failure.
 *
 * Actions:
 *   dns      - Re-run Spaceship Basic DNS baseline sync
 *   email    - Re-run SES identity setup + DNS records
 *   basename - Re-run Basename registration on Base L2
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      const parsed = await parseBody(req, repairSchema);
      if (parsed instanceof Response) return parsed;

      const db = getDb();
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      log.info('repair action triggered', {
        agentId: id,
        domain: agent.domain,
        action: parsed.action,
        admin: auth.address,
      });

      switch (parsed.action) {
        case 'dns':
          return repairDns(db, agent);
        case 'email':
          return repairEmail(db, agent);
        case 'basename':
          return repairBasename(db, agent);
        case 'ens':
          return repairEns(db, agent);
      }
    },
    { route: '/admin/agents/repair' },
  );
}

async function repairDns(
  db: ReturnType<typeof getDb>,
  agent: { id: string; domain: string; dnsTarget: string | null },
) {
  const { buildBaselineDnsRecords, getSpaceshipDns } = await import('@/services/dns');
  const { getCloudflareSaas } = await import('@/services/cloudflare-saas');
  const dns = getSpaceshipDns();
  await dns.ensureBasicDns(agent.domain);

  let cfHostname;
  try {
    cfHostname = await getCloudflareSaas().createApexHostname(agent.domain);
    await db
      .insert(sslHostnames)
      .values({
        agentId: agent.id,
        hostname: agent.domain,
        cloudflareCustomHostnameId: cfHostname.id,
        hostnameStatus: cfHostname.status,
        sslStatus: cfHostname.sslStatus,
        validationRecords: cfHostname.validationRecords,
        validationErrors: cfHostname.validationErrors,
      })
      .onConflictDoUpdate({
        target: [sslHostnames.agentId],
        set: {
          cloudflareCustomHostnameId: cfHostname.id,
          hostnameStatus: cfHostname.status,
          sslStatus: cfHostname.sslStatus,
          validationRecords: cfHostname.validationRecords,
          validationErrors: cfHostname.validationErrors,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    log.warn('cloudflare saas repair failed', { domain: agent.domain, err: String(e) });
  }

  const records = await dns.replaceAgentRecords(
    { id: agent.id, domain: agent.domain },
    buildBaselineDnsRecords({
      domain: agent.domain,
      cloudflareValidationRecords: cfHostname?.dnsValidationRecords,
    }),
  );

  return NextResponse.json({
    ok: true,
    action: 'dns',
    domain: agent.domain,
    recordsCount: records.length,
  });
}

async function repairEmail(
  db: ReturnType<typeof getDb>,
  agent: { id: string; domain: string; dnsTarget: string | null },
) {
  const { getSesEmail } = await import('@/services/ses');
  const { buildBaselineDnsRecords, getSpaceshipDns } = await import('@/services/dns');
  const setup = await getSesEmail().setupDomain(agent.domain);

  await db
    .insert(emailInboxes)
    .values({
      agentId: agent.id,
      emailAddress: `agent@${agent.domain}`,
      sesIdentityArn: setup.identityArn,
      sesVerificationStatus: setup.verificationStatus,
      dkimConfigured: false,
      spfConfigured: false,
      dmarcConfigured: false,
    })
    .onConflictDoUpdate({
      target: [emailInboxes.agentId],
      set: { sesIdentityArn: setup.identityArn, sesVerificationStatus: setup.verificationStatus },
    });

  const dns = getSpaceshipDns();
  await dns.ensureBasicDns(agent.domain);
  await dns.replaceAgentRecords(
    { id: agent.id, domain: agent.domain },
    buildBaselineDnsRecords({ domain: agent.domain, emailRecords: setup.records }),
  );

  return NextResponse.json({
    ok: true,
    action: 'email',
    domain: agent.domain,
    sesIdentityArn: setup.identityArn,
    recordsCount: setup.records.length,
  });
}

async function repairBasename(
  _db: ReturnType<typeof getDb>,
  agent: { id: string; domain: string; basename: string | null; walletAddress: string },
) {
  if (!agent.basename) {
    return errorResponse(400, 'NO_BASENAME', 'Agent does not have a basename configured');
  }

  const basenameLabel = agent.basename.replace('.base.eth', '');
  const { getBasenames } = await import('@/services/basenames');
  const bn = getBasenames();

  // Check if already registered
  const available = await bn.isAvailable(basenameLabel);
  if (!available) {
    // It may already be registered but just not in our DB records
    log.info('basename appears already registered', { basename: agent.basename });
  }

  // Get price and register
  const durationSeconds = 365 * 24 * 60 * 60;
  const priceWei = await bn.getRequiredWei(basenameLabel, durationSeconds);

  // Ensure native balance for gas
  const { getLifiFunding } = await import('@/services/lifi');
  await getLifiFunding().ensureNativeBalance({
    destination: 'base',
    requiredWei: priceWei + 500_000_000_000_000n,
    reason: `admin-repair:basename:${agent.basename}`,
  });

  const result = await bn.register({
    label: basenameLabel,
    ownerAddress: agent.walletAddress as `0x${string}`,
    durationSeconds,
  });

  log.info('basename repaired via admin', {
    basename: agent.basename,
    txHash: result.txHash,
  });

  return NextResponse.json({
    ok: true,
    action: 'basename',
    basename: agent.basename,
    txHash: result.txHash,
  });
}

async function repairEns(
  _db: ReturnType<typeof getDb>,
  agent: { id: string; domain: string; ensName: string | null; walletAddress: string },
) {
  if (!agent.ensName) {
    return errorResponse(400, 'NO_ENS', 'Agent does not have an ENS name configured');
  }

  const ensLabel = agent.ensName.replace('.eth', '');
  const { getEns } = await import('@/services/ens');
  const ens = getEns();

  // Check if already registered
  const available = await ens.isAvailable(ensLabel);
  if (!available) {
    log.info('ens appears already registered', { ensName: agent.ensName });
  }

  const durationSeconds = 365 * 24 * 60 * 60;
  const requiredWei = await ens.getRequiredWei(ensLabel, durationSeconds);

  // Ensure native ETH balance on Ethereum L1
  const { getLifiFunding } = await import('@/services/lifi');
  await getLifiFunding().ensureNativeBalance({
    destination: 'ethereum',
    requiredWei,
    reason: `admin-repair:ens:${agent.ensName}`,
  });

  const result = await ens.register({
    label: ensLabel,
    ownerAddress: agent.walletAddress as `0x${string}`,
    durationSeconds,
  });

  log.info('ens repaired via admin', {
    ensName: agent.ensName,
    txHash: result.txHash,
  });

  return NextResponse.json({
    ok: true,
    action: 'ens',
    ensName: agent.ensName,
    txHash: result.txHash,
  });
}
