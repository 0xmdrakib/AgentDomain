import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseBody, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { discountsRepo } from '@/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/discounts' });

const createSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, hyphens, or underscores'),
  usageLimit: z.coerce.number().int().min(1).max(10000).default(1),
  discountPercent: z.coerce.number().int().min(1).max(100).default(90),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/v1/admin/discounts
 * List all discount codes.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const parsed = parseQuery(req, listSchema);
      if (parsed instanceof Response) return parsed;

      const result = await discountsRepo.list({ limit: parsed.limit, offset: parsed.offset });
      return NextResponse.json({
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
      });
    },
    { route: '/admin/discounts' },
  );
}

/**
 * POST /api/v1/admin/discounts
 * Create a new discount code.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const parsed = await parseBody(req, createSchema);
      if (parsed instanceof Response) return parsed;

      // Check uniqueness
      const existing = await discountsRepo.getByCode(parsed.code);
      if (existing) {
        return errorResponse(409, 'DUPLICATE', `Code "${parsed.code}" already exists`);
      }

      const code = await discountsRepo.create({
        code: parsed.code,
        usageLimit: parsed.usageLimit ?? 1,
        discountPercent: parsed.discountPercent ?? 90,
        createdBy: auth.address,
      });

      log.info('discount code created', {
        code: parsed.code,
        usageLimit: parsed.usageLimit,
        admin: auth.address,
      });

      return NextResponse.json({ ok: true, code }, { status: 201 });
    },
    { route: '/admin/discounts' },
  );
}
