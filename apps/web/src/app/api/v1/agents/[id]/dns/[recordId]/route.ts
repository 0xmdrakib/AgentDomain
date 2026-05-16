import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, errorResponse, applyRateLimit, parseBody } from '@/lib/api-helpers';
import { getDb } from '@/db/index';
import { agents, dnsRecords as dnsTable } from '@/db/schema';
import { requireAuthOrApiKey } from '@/lib/auth';
import { dnsRecordSchema } from '@agentdomain/shared';
import { getServerEnv } from '@/lib/env';
import { getSpaceshipDns, normalizeRecordName } from '@/services/dns';

export const runtime = 'nodejs';

const idSchema = z.string().uuid();

/**
 * DELETE /api/v1/agents/{id}/dns/{recordId}
 * Delete a DNS record.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  return withErrorHandling(async () => {
    const auth = await requireAuthOrApiKey();
    if (auth instanceof Response) return auth;

    const { id, recordId } = await params;
    if (!idSchema.safeParse(id).success || !idSchema.safeParse(recordId).success) {
      return errorResponse(400, 'BAD_ID', 'Invalid ID format');
    }

    const db = getDb();
    
    // Check ownership
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (!ownsAgent(agent, auth.address)) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    // Get the record
    const [record] = await db
      .select()
      .from(dnsTable)
      .where(and(eq(dnsTable.id, recordId), eq(dnsTable.agentId, id)))
      .limit(1);

    if (!record) return errorResponse(404, 'NOT_FOUND', 'DNS record not found');
    if (record.systemManaged) {
      return errorResponse(403, 'SYSTEM_RECORD', 'System-managed DNS records cannot be deleted');
    }

    const limited = await enforceDnsRateLimit(req, id, auth.address);
    if (limited) return limited;

    await db.delete(dnsTable).where(eq(dnsTable.id, recordId));
    await getSpaceshipDns().syncAgentRecords(agent.id, agent.domain);

    return Response.json({ success: true });
  }, { route: '/agents/[id]/dns/[recordId]:DELETE' });
}

/**
 * PATCH /api/v1/agents/{id}/dns/{recordId}
 * Update a DNS record.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  return withErrorHandling(async () => {
    const auth = await requireAuthOrApiKey();
    if (auth instanceof Response) return auth;

    const { id, recordId } = await params;
    if (!idSchema.safeParse(id).success || !idSchema.safeParse(recordId).success) {
      return errorResponse(400, 'BAD_ID', 'Invalid ID format');
    }

    const parsed = await parseBody(req, dnsRecordSchema.partial());
    if (parsed instanceof Response) return parsed;

    const db = getDb();
    
    // Check ownership
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (!ownsAgent(agent, auth.address)) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    // Get the record
    const [record] = await db
      .select()
      .from(dnsTable)
      .where(and(eq(dnsTable.id, recordId), eq(dnsTable.agentId, id)))
      .limit(1);

    if (!record) return errorResponse(404, 'NOT_FOUND', 'DNS record not found');
    if (record.systemManaged) {
      return errorResponse(403, 'SYSTEM_RECORD', 'System-managed DNS records cannot be edited');
    }

    const limited = await enforceDnsRateLimit(req, id, auth.address);
    if (limited) return limited;

    const [updated] = await db
      .update(dnsTable)
      .set({
        type: parsed.type ?? record.type,
        name: parsed.name ? normalizeRecordName(parsed.name, agent.domain) : record.name,
        value: parsed.value ?? record.value,
        ttl: parsed.ttl ?? record.ttl,
        priority: parsed.priority ?? record.priority,
        updatedAt: new Date(),
      })
      .where(eq(dnsTable.id, recordId))
      .returning();

    await getSpaceshipDns().syncAgentRecords(agent.id, agent.domain);

    return Response.json(updated);
  }, { route: '/agents/[id]/dns/[recordId]:PATCH' });
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
