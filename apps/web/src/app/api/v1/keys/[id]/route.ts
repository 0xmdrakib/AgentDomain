import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { revokeApiKey, findOrCreateUser } from '@/lib/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

/**
 * DELETE /api/v1/keys/{id}
 * Revoke an API key.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return errorResponse(400, 'BAD_ID', 'Invalid key ID');
    }

    const user = await findOrCreateUser(session.address);
    const ok = await revokeApiKey(id, user.id);

    if (!ok) {
      return errorResponse(404, 'NOT_FOUND', 'Key not found or not yours');
    }

    return NextResponse.json({ revoked: true });
  }, { route: '/keys/[id]:DELETE' });
}
