import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, errorResponse, parseBody, applyRateLimit } from '@/lib/api-helpers';
import { dnsRecordSchema } from '@agentdomain/shared';
import { agentsRepo, dnsRepo } from '@/db';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getServerEnv } from '@/lib/env';
import { getSpaceshipDns, normalizeRecordName } from '@/services/dns';
import { assertWritesAllowed } from '@/lib/maintenance';

export const runtime = 'nodejs';

const idSchema = z.string().uuid();

/**
 * GET /api/v1/agents/{id}/dns
 * List all DNS records for an agent.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAuthOrApiKey();
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return errorResponse(400, 'BAD_ID', 'Invalid agent ID');
    }
    const agent = await agentsRepo.getById(id);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (!ownsAgent(agent, auth.address)) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    const records = await dnsRepo.list(id);
    return Response.json(records);
  }, { route: '/agents/[id]/dns:GET' });
}

/**
 * POST /api/v1/agents/{id}/dns
 * Add a new DNS record. Requires API key auth (TODO: enforce).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAuthOrApiKey();
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return errorResponse(400, 'BAD_ID', 'Invalid agent ID');
    }
    const parsed = await parseBody(req, dnsRecordSchema);
    if (parsed instanceof Response) return parsed;
    const frozen = assertWritesAllowed();
    if (frozen) return frozen;

    const agent = await agentsRepo.getById(id);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (!ownsAgent(agent, auth.address)) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    const limited = await enforceDnsRateLimit(req, id, auth.address);
    if (limited) return limited;

    const ttl = parsed.ttl ?? 3600;
    const stored = await dnsRepo.create(agent.id, {
      agentId: agent.id,
      type: parsed.type,
      name: normalizeRecordName(parsed.name, agent.domain),
      value: parsed.value,
      ttl,
      priority: parsed.priority ?? null,
      provider: 'spaceship',
      providerRecordId: null,
      systemManaged: false,
      purpose: null,
    });

    await getSpaceshipDns().syncAgentRecords(agent.id, agent.domain);

    return Response.json(stored, { status: 201 });
  }, { route: '/agents/[id]/dns:POST' });
}

function ownsAgent(agent: { ownerAddress: string; walletAddress: string }, address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    agent.ownerAddress.toLowerCase() === normalized ||
    agent.walletAddress.toLowerCase() === normalized
  );
}

async function enforceDnsRateLimit(req: NextRequest, agentId: string, address: string) {
  const env = getServerEnv();
  const key = `${agentId}:${address.toLowerCase()}`;
  return (
    (await applyRateLimit(req, {
      key: `dns:${key}:minute`,
      max: env.DNS_RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60,
    })) ??
    (await applyRateLimit(req, {
      key: `dns:${key}:hour`,
      max: env.DNS_RATE_LIMIT_PER_HOUR,
      windowSeconds: 60 * 60,
    }))
  );
}
