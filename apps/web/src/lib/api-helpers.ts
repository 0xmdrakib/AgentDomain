import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { rateLimit } from './rate-limit';
import { logger } from './logger';
import { captureException } from './sentry';

const log = logger.child({ component: 'api' });

/**
 * Standard error response shape.
 */
export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: code, code, message, details }, { status });
}

/**
 * Validate a request body against a Zod schema. Returns the parsed value or a 400 response.
 */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', flattenZodError(result.error));
  }
  return result.data;
}

export function parseQuery<T extends ZodSchema>(
  req: NextRequest,
  schema: T,
): import('zod').infer<T> | NextResponse {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query', flattenZodError(result.error));
  }
  return result.data;
}

function flattenZodError(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = [];
    out[path].push(issue.message);
  }
  return out;
}

/**
 * Apply rate limiting to a request. Returns null if allowed, NextResponse if rejected.
 */
export async function applyRateLimit(
  req: NextRequest,
  config: { key?: string; max: number; windowSeconds: number },
): Promise<NextResponse | null> {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const key = config.key ?? `${req.nextUrl.pathname}:${ip}`;
  const result = await rateLimit(key, config.max, config.windowSeconds);
  if (!result.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.resetAt),
          'Retry-After': String(Math.max(1, result.resetAt - Math.floor(Date.now() / 1000))),
        },
      },
    );
  }
  return null;
}

/**
 * Wrap a handler with consistent error logging and JSON response on uncaught errors.
 * Reports to Sentry asynchronously without blocking the response.
 */
export async function withErrorHandling(
  handler: () => Promise<Response>,
  context: { route: string },
): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    log.error(`Unhandled error in ${context.route}`, {
      err: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    // Fire-and-forget Sentry capture
    captureException(e, { route: context.route }).catch(() => {});
    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'Internal server error',
      process.env.NODE_ENV === 'development' && e instanceof Error ? e.message : undefined,
    );
  }
}
