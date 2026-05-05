import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, errorResponse, parseBody } from '@/lib/api-helpers';
import { dnsRecordSchema } from '@agentdomain/shared';
import { getDb } from '@/db/index';
import { agents, dnsRecords as dnsTable } from '@/db/schema';
import { getCloudflare } from '@/services/cloudflare';
import { requireAuthOrApiKey } from '@/lib/auth';

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
    const db = getDb();
    
    // Check ownership
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase()) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    const records = await db.select().from(dnsTable).where(eq(dnsTable.agentId, id));
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

    const db = getDb();
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase()) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    const cf = getCloudflare();
    const zone = await cf.getZoneByName(agent.domain);
    if (!zone) return errorResponse(500, 'NO_ZONE', 'Cloudflare zone not found for this domain');

    const ttl = parsed.ttl ?? 3600;
    const cfRecord = await cf.createDnsRecord(zone.id, {
      type: parsed.type,
      name: parsed.name,
      content: parsed.value,
      ttl,
      priority: parsed.priority,
    });

    const [stored] = await db
      .insert(dnsTable)
      .values({
        agentId: agent.id,
        type: parsed.type,
        name: parsed.name,
        value: parsed.value,
        ttl,
        priority: parsed.priority ?? null,
        cloudflareId: cfRecord.id,
      })
      .returning();

    return Response.json(stored, { status: 201 });
  }, { route: '/agents/[id]/dns:POST' });
}
