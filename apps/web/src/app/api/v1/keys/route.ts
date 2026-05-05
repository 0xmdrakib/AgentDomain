import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseBody } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { createApiKey, listApiKeys, findOrCreateUser } from '@/lib/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/keys
 * List API keys for the authenticated wallet.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const user = await findOrCreateUser(session.address);
    const keys = await listApiKeys(user.id);

    return NextResponse.json({ keys });
  }, { route: '/keys' });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

/**
 * POST /api/v1/keys
 * Create a new API key for the authenticated wallet.
 *
 * Returns the full key — shown ONCE. Store it securely on the client.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const parsed = await parseBody(req, createSchema);
    if (parsed instanceof Response) return parsed;

    const user = await findOrCreateUser(session.address);
    const key = await createApiKey({ userId: user.id, name: parsed.name });

    return NextResponse.json(
      {
        ...key,
        warning: 'Save this key now — it will not be shown again.',
      },
      { status: 201 },
    );
  }, { route: '/keys:POST' });
}
