import { NextRequest } from 'next/server';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { withErrorHandling, parseQuery } from '@/lib/api-helpers';
import {
  tldSchema,
  domainLabelSchema,
  SERVICE_FEE_USDC_ATOMIC,
  USDC_DECIMALS,
} from '@agentdomain/shared';
import { getIdentityService } from '@/services/identity';
import { discountsRepo } from '@/db';

const querySchema = z
  .object({
    preferredName: domainLabelSchema,
    tld: tldSchema.default('xyz'),
    registerBasename: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    basenameLabel: domainLabelSchema.optional(),
    registerEns: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    ensLabel: domainLabelSchema.optional(),
    years: z.coerce.number().int().min(1).max(10).optional(),
    discountCode: z.string().max(50).optional(),
  })
  .strip();

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/quote
 * Returns a pricing breakdown for a registration.
 * Optionally applies a discount code to the service fee.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const parsed = parseQuery(req, querySchema);
      if (parsed instanceof Response) return parsed;

      const svc = getIdentityService();
      const pricing = await svc.computePricing({
        tld: parsed.tld,
        registerBasename: parsed.registerBasename,
        registerEns: parsed.registerEns,
        preferredName: parsed.preferredName,
        basenameLabel: parsed.basenameLabel,
        ensLabel: parsed.ensLabel,
        years: parsed.years,
      });

      // Apply discount code if provided
      let discountApplied = false;
      let discountPercent = 0;
      let discountedFeeUsdc = pricing.serviceFeeUsdc;

      if (parsed.discountCode) {
        try {
          const code = await discountsRepo.getByCode(parsed.discountCode);

          if (
            code &&
            code.isActive &&
            code.usedCount < code.usageLimit &&
            (!code.expiresAt || new Date(code.expiresAt) >= new Date())
          ) {
            discountApplied = true;
            discountPercent = code.discountPercent;
            const feeAtomic = SERVICE_FEE_USDC_ATOMIC;
            const discountAtomic = (feeAtomic * BigInt(discountPercent)) / 100n;
            const discountedAtomic = feeAtomic - discountAtomic;
            discountedFeeUsdc = formatUnits(discountedAtomic, USDC_DECIMALS);
          }
        } catch {
          // DB may not be available — silently skip discount
        }
      }

      let totalUsdc = pricing.totalUsdc;
      if (discountApplied) {
        const domainAtomic = BigInt(Math.round(Number(pricing.domainCostUsdc) * 1_000_000));
        const bnAtomic = BigInt(Math.round(Number(pricing.basenameCostUsdc) * 1_000_000));
        const ensAtomic = BigInt(Math.round(Number(pricing.ensCostUsdc) * 1_000_000));
        const feeAtomic = BigInt(Math.round(Number(discountedFeeUsdc) * 1_000_000));
        totalUsdc = formatUnits(domainAtomic + bnAtomic + ensAtomic + feeAtomic, USDC_DECIMALS);
      }

      return Response.json({
        ...pricing,
        discountApplied,
        discountPercent,
        serviceFeeUsdc: discountApplied ? discountedFeeUsdc : pricing.serviceFeeUsdc,
        totalUsdc,
      });
    },
    { route: '/agents/quote' },
  );
}
