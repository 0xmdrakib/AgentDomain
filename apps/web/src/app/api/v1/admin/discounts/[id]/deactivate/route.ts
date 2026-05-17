import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { discountsRepo } from '@/db';
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

      const code = await discountsRepo.deactivate(id);

      if (!code) return errorResponse(404, 'NOT_FOUND', 'Discount code not found');

      log.info('discount code deactivated', {
        code: code.code,
        admin: auth.address,
      });

      return NextResponse.json({ ok: true, code: code.code });
    },
    { route: '/admin/discounts/deactivate' },
  );
}
