import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { errorResponse, withErrorHandling } from '@/lib/api-helpers';
import { getServerEnv } from '@/lib/env';
import { processSesInbound, type SesInboundPayload } from '@/services/email-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const authError = authorize(req);
      if (authError) return authError;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
      }

      const result = await processSesInbound(extractSesPayload(body));
      return NextResponse.json({ ok: true, ...result }, { status: result.stored ? 200 : 202 });
    },
    { route: '/webhooks/ses/inbound:POST' },
  );
}

function authorize(req: NextRequest): NextResponse | null {
  const secret = getServerEnv().AWS_SES_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null;
    return errorResponse(503, 'WEBHOOK_SECRET_NOT_CONFIGURED', 'AWS SES webhook secret is not configured');
  }
  const auth = req.headers.get('authorization');
  const provided = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!provided || !safeEqual(provided, secret)) {
    return errorResponse(401, 'UNAUTHORIZED_WEBHOOK', 'Invalid webhook secret');
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function extractSesPayload(body: unknown): SesInboundPayload {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  if (typeof record.Message === 'string') {
    try {
      return JSON.parse(record.Message) as SesInboundPayload;
    } catch {
      return {};
    }
  }
  return record as SesInboundPayload;
}
