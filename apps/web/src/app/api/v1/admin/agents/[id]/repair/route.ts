import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents, dnsRecords, emailInboxes } from '@/db/schema';
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
 *   dns      - Re-run Cloudflare zone creation + baseline DNS + nameserver update
 *   email    - Re-run Resend domain setup + DKIM records
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
  const { getCloudflare } = await import('@/services/cloudflare');
  const { getSpaceship } = await import('@/services/spaceship');

  const cf = getCloudflare();
  const existingZone = await cf.getZoneByName(agent.domain);
  const zone = existingZone ?? (await cf.createZone(agent.domain));

  log.info('cloudflare zone ready for repair', { domain: agent.domain, zoneId: zone.id });

  // Point Spaceship NS at Cloudflare if needed
  if (zone.nameServers.length > 0 && !existingZone) {
    const ss = getSpaceship();
    await ss.setNameservers(agent.domain, zone.nameServers);
    log.info('nameservers updated during repair', { domain: agent.domain });
  }

  // Re-configure baseline DNS
  const records = await cf.configureBaselineDns({
    zoneId: zone.id,
    domain: agent.domain,
    dnsTarget: agent.dnsTarget ?? 'agentdomain.xyz',
    emailEnabled: false,
    resendDkimRecords: undefined,
  });

  // Sync DNS records to local DB
  await db.delete(dnsRecords).where(eq(dnsRecords.agentId, agent.id));
  if (records.length > 0) {
    await db.insert(dnsRecords).values(
      records.map((r) => ({
        agentId: agent.id,
        type: r.type as 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV',
        name: r.name,
        value: r.content,
        ttl: r.ttl,
        priority: r.priority,
        cloudflareId: r.id,
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    action: 'dns',
    domain: agent.domain,
    zoneId: zone.id,
    recordsCount: records.length,
  });
}

async function repairEmail(
  db: ReturnType<typeof getDb>,
  agent: { id: string; domain: string; dnsTarget: string | null },
) {
  const { getResend } = await import('@/services/resend');
  const resend = getResend();

  const setup = await resend.addDomain(agent.domain);
  const dkimRecords = setup.dnsRecords
    .filter((r) => r.type === 'TXT' || r.type === 'CNAME')
    .map((r) => ({ name: r.name, value: r.value }));

  // Upsert email inbox row
  await db
    .insert(emailInboxes)
    .values({
      agentId: agent.id,
      emailAddress: `agent@${agent.domain}`,
      resendDomainId: setup.domainId,
      dkimConfigured: false,
      spfConfigured: false,
      dmarcConfigured: false,
    })
    .onConflictDoUpdate({
      target: [emailInboxes.agentId],
      set: { resendDomainId: setup.domainId },
    });

  // Add DKIM DNS records
  if (dkimRecords.length > 0) {
    const { getCloudflare } = await import('@/services/cloudflare');
    const cf = getCloudflare();
    const zone = await cf.getZoneByName(agent.domain);
    if (zone) {
      for (const r of dkimRecords) {
        await cf.createDnsRecord(zone.id, {
          type: 'TXT',
          name: r.name,
          content: r.value,
          ttl: 3600,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    action: 'email',
    domain: agent.domain,
    resendDomainId: setup.domainId,
    dkimRecordsCount: dkimRecords.length,
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
