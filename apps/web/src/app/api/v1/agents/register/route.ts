import { NextRequest, NextResponse } from 'next/server';
import { formatUnits, keccak256, toHex } from 'viem';
import {
  registrationParamsSchema,
  parseUsdc,
  SERVICE_FEE_USDC_ATOMIC,
  USDC_DECIMALS,
} from '@agentdomain/shared';
import { withX402 } from '@/lib/x402';
import { withErrorHandling, applyRateLimit, errorResponse } from '@/lib/api-helpers';
import { getIdentityService, ValidationError } from '@/services/identity';
import { recordMetric } from '@/lib/metrics';
import { X402_PAYMENT_HEADER } from '@agentdomain/shared';
import { discountsRepo } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/agents/register
 *
 * Register a complete agent identity bundle.
 *
 * Flow:
 *   1. Apply rate limit.
 *   2. Validate request body.
 *   3. Compute pricing.
 *   4. Run x402 payment flow:
 *        - First call: returns 402 + X-Payment-Required.
 *        - With X-Payment header: settles via facilitator, then provisions.
 *   5. Payment settles to backend wallet; the treasury split is swept separately.
 *   6. Provision: LI.FI funding -> ENS -> Spaceship DNS -> Cloudflare SaaS -> AWS SES -> Basenames -> Mint -> DB.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const rl = await applyRateLimit(req, {
        max: 10,
        windowSeconds: 3600,
        key: `register:${req.headers.get('x-forwarded-for') ?? 'unknown'}`,
      });
      if (rl) {
        recordMetric('registration_rate_limited', {
          route: '/agents/register',
          ip: req.headers.get('x-forwarded-for') ?? 'unknown',
        });
        return rl;
      }

      let bodyJson: unknown;
      try {
        const cloned = req.clone();
        bodyJson = await cloned.json();
      } catch {
        return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
      }

      const rawBody = bodyJson as Record<string, unknown>;
      const discountCode = typeof rawBody.discountCode === 'string' ? rawBody.discountCode : undefined;

      const validation = registrationParamsSchema.safeParse(bodyJson);
      if (!validation.success) {
        recordMetric('registration_validation_failed', { reason: 'schema' });
        return errorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid request',
          validation.error.flatten(),
        );
      }
      const params = validation.data;

      const hasPayment = Boolean(req.headers.get(X402_PAYMENT_HEADER));
      recordMetric('registration_started', {
        domain: `${params.preferredName}.${params.tld}`,
        hasPayment,
        emailEnabled: params.emailEnabled,
      });

      const svc = getIdentityService();

      try {
        await svc.validate(params);
        recordMetric('registration_validated', { domain: `${params.preferredName}.${params.tld}` });
      } catch (e) {
        if (e instanceof ValidationError) {
          recordMetric('registration_validation_failed', {
            domain: `${params.preferredName}.${params.tld}`,
            reason: e.code,
          });
          return errorResponse(400, e.code, e.message);
        }
        throw e;
      }

      const pricing = await svc.computePricing({
        tld: params.tld,
        registerBasename: params.registerBasename,
        registerEns: params.registerEns,
        emailEnabled: params.emailEnabled,
        preferredName: params.preferredName,
        basenameLabel: params.basenameLabel,
        ensLabel: params.ensLabel,
        years: params.years,
      });

      const years = params.years ?? 1;
      let totalAtomic = parseUsdc(pricing.totalUsdc);
      let treasuryFeeAtomic = parseUsdc(pricing.treasuryFeeUsdc);

      let appliedDiscountCode: string | undefined;
      let discountAtomic = 0n;
      if (discountCode) {
        try {
          const code = await discountsRepo.getByCode(discountCode);

          if (
            code &&
            code.isActive &&
            code.usedCount < code.usageLimit &&
            (!code.expiresAt || new Date(code.expiresAt) >= new Date())
          ) {
            appliedDiscountCode = code.code;
            discountAtomic = (SERVICE_FEE_USDC_ATOMIC * BigInt(years) * BigInt(code.discountPercent)) / 100n;
            totalAtomic -= discountAtomic;
            treasuryFeeAtomic -= discountAtomic;
          }
        } catch {
          // DB may not be available; skip discount.
        }
      }

      recordMetric('registration_pricing', {
        domain: `${params.preferredName}.${params.tld}`,
        totalAtomic: totalAtomic.toString(),
        treasuryFeeAtomic: treasuryFeeAtomic.toString(),
        discountCode: appliedDiscountCode ?? 'none',
        discountAtomic: discountAtomic.toString(),
        serviceFee: pricing.serviceFeeUsdc,
        emailFee: pricing.emailFeeUsdc,
        domainCost: pricing.domainCostUsdc,
        basenameCost: pricing.basenameCostUsdc,
        ensCost: pricing.ensCostUsdc,
      });

      return withX402(
        req,
        {
          amountAtomic: totalAtomic,
          treasuryFeeAtomic,
          description: `Register agent identity ${params.preferredName}.${params.tld}`,
          resource: req.nextUrl.toString(),
        },
        async (settlement, _body) => {
          const idempotencyKey = keccak256(
            toHex(
              `${settlement.payer}:${params.preferredName}:${params.tld}:${settlement.txHash ?? Date.now()}`,
            ),
          );

          const result = await svc.register(
            { ...params, wallet: settlement.payer },
            idempotencyKey,
            {
              paymentTxHash: settlement.txHash ?? null,
              paymentAmountUsdc: formatUnits(totalAtomic, USDC_DECIMALS),
            },
          );

          if (appliedDiscountCode) {
            try {
              const current = await discountsRepo.getByCode(appliedDiscountCode);
              if (current) await discountsRepo.incrementUse(current.id);
            } catch {
              // Non-fatal.
            }
          }

          return NextResponse.json(result, { status: 200 });
        },
      );
    },
    { route: '/agents/register' },
  );
}
