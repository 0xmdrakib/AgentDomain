import { NextRequest, NextResponse } from 'next/server';
import { getServerEnv } from './env';
import { errorResponse } from './api-helpers';
import { logger } from './logger';
import { recordMetric } from './metrics';

const log = logger.child({ component: 'turnstile' });

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

export function getTurnstileToken(req: NextRequest, body: unknown): string | null {
  const headerToken = req.headers.get('x-turnstile-token');
  if (headerToken) return headerToken;

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const token = record.turnstileToken ?? record['cf-turnstile-response'];
    if (typeof token === 'string' && token.length > 0) return token;
  }

  return null;
}

export async function requireTurnstile(
  req: NextRequest,
  token: string | null,
): Promise<NextResponse | null> {
  const env = getServerEnv();
  const required = env.NODE_ENV === 'production' && env.TURNSTILE_REQUIRED !== 'false';

  if (!env.TURNSTILE_SECRET_KEY) {
    if (!required) return null;
    recordMetric('bot_check_failed', { reason: 'turnstile_not_configured' });
    return errorResponse(
      503,
      'BOT_PROTECTION_NOT_CONFIGURED',
      'Registration bot protection is not configured',
    );
  }

  if (!token) {
    recordMetric('bot_check_failed', { reason: 'missing_token' });
    return errorResponse(403, 'BOT_CHECK_REQUIRED', 'Bot protection challenge required');
  }

  const remoteIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined;

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!res.ok) {
      recordMetric('bot_check_failed', { reason: `siteverify_http_${res.status}` });
      return errorResponse(403, 'BOT_CHECK_FAILED', 'Bot protection verification failed');
    }

    const data = (await res.json()) as TurnstileResponse;
    if (!data.success) {
      recordMetric('bot_check_failed', { reason: data['error-codes']?.join(',') ?? 'unknown' });
      return errorResponse(403, 'BOT_CHECK_FAILED', 'Bot protection verification failed');
    }

    recordMetric('bot_check_passed', { hostname: data.hostname, action: data.action });
    return null;
  } catch (e) {
    log.warn('turnstile verification failed', { err: String(e) });
    recordMetric('bot_check_failed', { reason: 'siteverify_unreachable' });
    return errorResponse(403, 'BOT_CHECK_FAILED', 'Bot protection verification failed');
  }
}
