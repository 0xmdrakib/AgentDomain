import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { discountCodes } from '@/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/discounts/deactivate' });

/**
 * POST /api/v1/admin/discounts/{id}/deactivate
 * Deactivate a discount code immediately.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;

      if (!process.env.DATABASE_URL) {
        return errorResponse(503, 'NO_DB', 'Database not configured');
      }

      const db = getDb();
      const [code] = await db.select().from(discountCodes).where(eq(discountCodes.id, id)).limit(1);

      if (!code) return errorResponse(404, 'NOT_FOUND', 'Discount code not found');

      await db.update(discountCodes).set({ isActive: false }).where(eq(discountCodes.id, id));

      log.info('discount code deactivated', {
        code: code.code,
        admin: auth.address,
      });

      return NextResponse.json({ ok: true, code: code.code });
    },
    { route: '/admin/discounts/deactivate' },
  );
}
