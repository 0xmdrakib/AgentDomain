import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { getDb } from '@/db/index';
import { agents, dnsRecords as dnsTable } from '@/db/schema';
import { getCloudflare } from '@/services/cloudflare';
import { requireAuthOrApiKey } from '@/lib/auth';

export const runtime = 'nodejs';

const idSchema = z.string().uuid();

/**
 * DELETE /api/v1/agents/{id}/dns/{recordId}
 * Delete a DNS record.
 */
export async function DELETE(
  _req: NextRequest,
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
    if (agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase()) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    // Get the record
    const [record] = await db
      .select()
      .from(dnsTable)
      .where(and(eq(dnsTable.id, recordId), eq(dnsTable.agentId, id)))
      .limit(1);

    if (!record) return errorResponse(404, 'NOT_FOUND', 'DNS record not found');

    // Delete from Cloudflare if it has a CF ID
    if (record.cloudflareId) {
      const cf = getCloudflare();
      const zone = await cf.getZoneByName(agent.domain);
      if (zone) {
        try {
          await cf.deleteDnsRecord(zone.id, record.cloudflareId);
        } catch (e) {
          // Log but continue if CF fails (maybe already deleted)
          console.error('Failed to delete CF record:', e);
        }
      }
    }

    // Delete from local DB
    await db.delete(dnsTable).where(eq(dnsTable.id, recordId));

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

    const { type, name, value, ttl, priority } = await req.json();

    const db = getDb();
    
    // Check ownership
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    if (agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase()) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied');
    }

    // Get the record
    const [record] = await db
      .select()
      .from(dnsTable)
      .where(and(eq(dnsTable.id, recordId), eq(dnsTable.agentId, id)))
      .limit(1);

    if (!record) return errorResponse(404, 'NOT_FOUND', 'DNS record not found');

    // Update in Cloudflare if it has a CF ID
    if (record.cloudflareId) {
      const cf = getCloudflare();
      const zone = await cf.getZoneByName(agent.domain);
      if (zone) {
        await cf.updateDnsRecord(zone.id, record.cloudflareId, {
          type,
          name,
          content: value,
          ttl,
          priority
        });
      }
    }

    // Update in local DB
    const [updated] = await db
      .update(dnsTable)
      .set({ type, name, value, ttl, priority, updatedAt: new Date() })
      .where(eq(dnsTable.id, recordId))
      .returning();

    return Response.json(updated);
  }, { route: '/agents/[id]/dns/[recordId]:PATCH' });
}
