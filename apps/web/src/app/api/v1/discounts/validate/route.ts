import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { discountsRepo } from '@/db';
import { SERVICE_FEE_USDC_ATOMIC, USDC_DECIMALS } from '@agentdomain/shared';
import { formatUnits } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validateSchema = z.object({
  code: z.string().min(1).max(50),
});

/**
 * POST /api/v1/discounts/validate
 *
 * Public endpoint. Validates a discount code and returns the discount details.
 * Does NOT mark the code as used — that happens during registration.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const parsed = await parseBody(req, validateSchema);
      if (parsed instanceof Response) return parsed;

      const code = await discountsRepo.getActiveByCode(parsed.code);

      if (!code) {
        return errorResponse(404, 'INVALID_CODE', 'This discount code is not valid or has expired');
      }

      if (code.expiresAt && new Date(code.expiresAt) < new Date()) {
        return errorResponse(410, 'EXPIRED', 'This discount code has expired');
      }

      if (code.usedCount >= code.usageLimit) {
        return errorResponse(410, 'EXHAUSTED', 'This discount code has reached its usage limit');
      }

      // 90% off the $2.00 service fee = $0.20 saved
      const feeAtomic = SERVICE_FEE_USDC_ATOMIC;
      const discountAtomic = (feeAtomic * BigInt(code.discountPercent)) / 100n;
      const discountedFeeAtomic = feeAtomic - discountAtomic;

      return NextResponse.json({
        valid: true,
        code: code.code,
        discountPercent: code.discountPercent,
        appliesTo: code.appliesTo,
        originalFeeUsdc: formatUnits(feeAtomic, USDC_DECIMALS),
        discountedFeeUsdc: formatUnits(discountedFeeAtomic, USDC_DECIMALS),
        youSaveUsdc: formatUnits(discountAtomic, USDC_DECIMALS),
        usesRemaining: code.usageLimit - code.usedCount,
      });
    },
    { route: '/discounts/validate' },
  );
}
