import { NextRequest, NextResponse } from 'next/server';
import { keccak256, toHex } from 'viem';
import { eq, and } from 'drizzle-orm';
import { registrationParamsSchema, parseUsdc } from '@agentdomain/shared';
import { withX402 } from '@/lib/x402';
import { withErrorHandling, applyRateLimit, errorResponse } from '@/lib/api-helpers';
import { getIdentityService, ValidationError } from '@/services/identity';
import { recordMetric } from '@/lib/metrics';
import { X402_PAYMENT_HEADER } from '@agentdomain/shared';

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
 *   5. Payment settles to backend wallet; domain recovery + service fees sweep to treasury.
 *   6. Provision: LI.FI funding -> ENS -> Spaceship -> Cloudflare -> Resend -> Basenames -> Mint -> DB.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      // Rate limit
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

      // Parse a "preview" of the body to compute price / validate before requesting payment.
      let bodyJson: unknown;
      try {
        const cloned = req.clone();
        bodyJson = await cloned.json();
      } catch {
        return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
      }

      // Extract discount code before schema strips it
      const rawBody = bodyJson as Record<string, unknown>;
      const discountCode =
        typeof rawBody.discountCode === 'string' ? rawBody.discountCode : undefined;

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

      // Pre-validate (reserved name, domain availability, etc.)
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
        preferredName: params.preferredName,
        basenameLabel: params.basenameLabel,
        ensLabel: params.ensLabel,
        years: params.years,
      });
      let totalAtomic = parseUsdc(pricing.totalUsdc);
      const treasuryFeeAtomic = parseUsdc(pricing.treasuryFeeUsdc);

      // Validate and apply discount code
      let appliedDiscountCode: string | undefined;
      let appliedDiscountId: string | undefined;
      if (discountCode) {
        try {
          const { getDb } = await import('@/db');
          const { discountCodes: dc } = await import('@/db/schema');
          const db = getDb();
          const [code] = await db
            .select()
            .from(dc)
            .where(and(eq(dc.code, discountCode.toUpperCase()), eq(dc.isActive, true)))
            .limit(1);

          if (
            code &&
            code.usedCount < code.usageLimit &&
            (!code.expiresAt || new Date(code.expiresAt) >= new Date())
          ) {
            appliedDiscountCode = code.code;
            appliedDiscountId = code.id;
            const { SERVICE_FEE_USDC_ATOMIC } = await import('@agentdomain/shared/constants');
            const discountAtomic = (SERVICE_FEE_USDC_ATOMIC * BigInt(code.discountPercent)) / 100n;
            totalAtomic = totalAtomic - discountAtomic;
          }
        } catch {
          // DB may not be available; skip discount
        }
      }

      // x402 payment flow
      return withX402(
        req,
        {
          amountAtomic: totalAtomic,
          treasuryFeeAtomic,
          description: `Register agent identity ${params.preferredName}.${params.tld}`,
          resource: req.nextUrl.toString(),
        },
        async (settlement, _body) => {
          // Build idempotency key from payer + name + nonce so retries are safe.
          const idempotencyKey = keccak256(
            toHex(
              `${settlement.payer}:${params.preferredName}:${params.tld}:${settlement.txHash ?? Date.now()}`,
            ),
          );

          const result = await svc.register(
            { ...params, wallet: settlement.payer },
            idempotencyKey,
          );

          // Mark discount code as used
          if (appliedDiscountCode) {
            try {
              const { getDb } = await import('@/db');
              const { discountCodes: dc } = await import('@/db/schema');
              const db = getDb();
              const [current] = await db
                .select()
                .from(dc)
                .where(eq(dc.code, appliedDiscountCode))
                .limit(1);
              if (current) {
                await db
                  .update(dc)
                  .set({ usedCount: current.usedCount + 1 })
                  .where(eq(dc.id, current.id));
              }
            } catch {
              // Non-fatal — discount can be applied next time
            }
          }

          return NextResponse.json(result, { status: 200 });
        },
      );
    },
    { route: '/agents/register' },
  );
}
