import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { registrationsRepo } from '@/db';
import { getIdentityService } from '@/services/identity';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/registrations/retry' });

/**
 * POST /api/v1/admin/registrations/{id}/retry
 *
 * Retry a failed registration using the same stored parameters.
 * Admin-only, so we skip x402 payment flow (assumes admin has already handled payment resolution).
 * Re-runs IdentityService.register() with the original request params.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;

      const reg = await registrationsRepo.getById(id);

      if (!reg) return errorResponse(404, 'NOT_FOUND', 'Registration not found');
      if (reg.status !== 'failed') {
        return errorResponse(
          400,
          'NOT_RETRYABLE',
          `Registration status is '${reg.status}'; only 'failed' rows are retryable`,
        );
      }

      const requestParams = reg.requestParams as Record<string, unknown> | null;
      if (
        !requestParams ||
        typeof requestParams.preferredName !== 'string' ||
        typeof requestParams.wallet !== 'string'
      ) {
        return errorResponse(
          400,
          'MISSING_PARAMS',
          'Original request parameters missing preferredName or wallet from registration record',
        );
      }

      const svc = getIdentityService();
      const idempotencyKey = `admin-retry:${id}:${Date.now()}`;

      const registrationParams = requestParams as unknown as Parameters<typeof svc.register>[0];

      // Before retry, validate availability
      try {
        await svc.validate(registrationParams);
      } catch (e) {
        return errorResponse(
          400,
          'VALIDATION',
          e instanceof Error ? e.message : 'Validation failed',
        );
      }

      const result = await svc.register(registrationParams, idempotencyKey);

      log.info('admin retry completed', {
        originalRegistrationId: id,
        newDomain: result.domain,
        tokenId: result.nftTokenId,
        admin: auth.address,
      });

      return NextResponse.json({
        ok: true,
        registrationId: id,
        result,
      });
    },
    { route: '/admin/registrations/retry' },
  );
}
