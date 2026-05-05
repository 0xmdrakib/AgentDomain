import { NextRequest, NextResponse } from 'next/server';
import { count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseBody, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { discountCodes } from '@/db/schema';
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

      if (!process.env.DATABASE_URL) {
        return errorResponse(503, 'NO_DB', 'Database not configured');
      }

      const parsed = parseQuery(req, listSchema);
      if (parsed instanceof Response) return parsed;

      const db = getDb();
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(discountCodes)
          .orderBy(desc(discountCodes.createdAt))
          .limit(parsed.limit)
          .offset(parsed.offset),
        db.select({ count: count() }).from(discountCodes),
      ]);

      const total = Number(totalRows[0]?.count ?? 0);
      return NextResponse.json({
        items,
        total,
        hasMore: parsed.offset + items.length < total,
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

      if (!process.env.DATABASE_URL) {
        return errorResponse(503, 'NO_DB', 'Database not configured');
      }

      const parsed = await parseBody(req, createSchema);
      if (parsed instanceof Response) return parsed;

      const db = getDb();

      // Check uniqueness
      const [existing] = await db
        .select({ id: discountCodes.id })
        .from(discountCodes)
        .where(eq(discountCodes.code, parsed.code))
        .limit(1);

      if (existing) {
        return errorResponse(409, 'DUPLICATE', `Code "${parsed.code}" already exists`);
      }

      const [code] = await db
        .insert(discountCodes)
        .values({
          code: parsed.code,
          usageLimit: parsed.usageLimit,
          usedCount: 0,
          discountPercent: parsed.discountPercent,
          isActive: true,
          createdBy: auth.address,
        })
        .returning();

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
