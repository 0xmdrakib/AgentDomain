import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailBlocklist } from '@/db/schema';
import { errorResponse, parseBody, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox, normalizeBlocklistValue } from '@/lib/email-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const createSchema = z.object({
  value: z.string().min(3).max(255),
  reason: z.string().max(500).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      if (!idSchema.safeParse(id).success) return errorResponse(400, 'BAD_ID', 'Invalid agent ID');

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const db = getDb();
      const entries = await db
        .select()
        .from(emailBlocklist)
        .where(eq(emailBlocklist.inboxId, row.inbox.id));
      return NextResponse.json({ entries });
    },
    { route: '/agents/[id]/email/blocklist:GET' },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      if (!idSchema.safeParse(id).success) return errorResponse(400, 'BAD_ID', 'Invalid agent ID');

      const parsed = await parseBody(req, createSchema);
      if (parsed instanceof NextResponse) return parsed;

      const value = normalizeBlocklistValue(parsed.value);
      if (!value || !value.includes('.')) {
        return errorResponse(400, 'BAD_BLOCK_VALUE', 'Blocklist value must be an email or domain');
      }

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const db = getDb();
      await db
        .insert(emailBlocklist)
        .values({ inboxId: row.inbox.id, value, reason: parsed.reason })
        .onConflictDoNothing({ target: [emailBlocklist.inboxId, emailBlocklist.value] });

      const [entry] = await db
        .select()
        .from(emailBlocklist)
        .where(and(eq(emailBlocklist.inboxId, row.inbox.id), eq(emailBlocklist.value, value)))
        .limit(1);

      return NextResponse.json({ entry }, { status: 201 });
    },
    { route: '/agents/[id]/email/blocklist:POST' },
  );
}
