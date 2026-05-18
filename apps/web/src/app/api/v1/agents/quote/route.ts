import { NextRequest } from 'next/server';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { withErrorHandling, parseQuery } from '@/lib/api-helpers';
import {
  tldSchema,
  domainLabelSchema,
  SERVICE_FEE_USDC_ATOMIC,
  parseUsdc,
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
    emailEnabled: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    years: z.coerce.number().int().min(1).max(10).optional(),
    discountCode: z.string().max(50).optional(),
  })
  .strip();

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/quote
 * Returns a pricing breakdown for a registration.
 * Optionally applies a discount code to the yearly service fee only.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const parsed = parseQuery(req, querySchema);
      if (parsed instanceof Response) return parsed;

      const years = parsed.years ?? 1;
      const svc = getIdentityService();
      const pricing = await svc.computePricing({
        tld: parsed.tld,
        registerBasename: parsed.registerBasename,
        registerEns: parsed.registerEns,
        emailEnabled: parsed.emailEnabled,
        preferredName: parsed.preferredName,
        basenameLabel: parsed.basenameLabel,
        ensLabel: parsed.ensLabel,
        years,
      });

      let discountApplied = false;
      let discountPercent = 0;
      let discountedFeeUsdc = pricing.serviceFeeUsdc;
      let discountedServiceFeeAtomic = parseUsdc(pricing.serviceFeeUsdc);

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
            const feeAtomic = SERVICE_FEE_USDC_ATOMIC * BigInt(years);
            const discountAtomic = (feeAtomic * BigInt(discountPercent)) / 100n;
            discountedServiceFeeAtomic = feeAtomic - discountAtomic;
            discountedFeeUsdc = formatUnits(discountedServiceFeeAtomic, USDC_DECIMALS);
          }
        } catch {
          // DB may not be available; silently skip discount.
        }
      }

      let totalAtomic = parseUsdc(pricing.totalUsdc);
      if (discountApplied) {
        totalAtomic =
          parseUsdc(pricing.domainCostUsdc) +
          parseUsdc(pricing.basenameCostUsdc) +
          parseUsdc(pricing.ensCostUsdc) +
          parseUsdc(pricing.emailFeeUsdc) +
          discountedServiceFeeAtomic;
      }

      return Response.json({
        ...pricing,
        discountApplied,
        discountPercent,
        serviceFeeUsdc: discountApplied ? discountedFeeUsdc : pricing.serviceFeeUsdc,
        totalUsdc: formatUnits(totalAtomic, USDC_DECIMALS),
      });
    },
    { route: '/agents/quote' },
  );
}
