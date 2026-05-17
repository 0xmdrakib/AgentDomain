import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: 'health' });

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  service: 'agentdomain-web';
  version: string;
  timestamp: string;
  checks: Record<string, CheckResult>;
}

/**
 * GET /api/health
 *
 * Liveness + dependency check. Returns 200 if the app is running and
 * critical dependencies (DB, RPC) are reachable. Returns 503 if any
 * critical dep is down.
 *
 * Suitable for Kubernetes/Railway readiness probes and Pingdom-style monitors.
 */
export async function GET() {
  const checks: Record<string, CheckResult> = {};

  // 1. Self-check (always passes)
  checks.app = { ok: true };

  // 2. Database
  checks.database = await checkDatabase();

  // 3. Base RPC
  checks.rpc = await checkRpc();

  // Determine overall status
  const failed = Object.values(checks).filter((c) => !c.ok);
  const status: HealthResponse['status'] =
    failed.length === 0 ? 'ok' : failed.length >= Object.keys(checks).length ? 'down' : 'degraded';

  const httpStatus = status === 'down' ? 503 : 200;

  const body: HealthResponse = {
    status,
    service: 'agentdomain-web',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: httpStatus });
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { platformRepo } = await import('@/db');
    await platformRepo.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    log.warn('database health check failed', { err: String(e) });
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}

async function checkRpc(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { getPublicClient } = await import('@/lib/chain');
    const client = getPublicClient();
    await client.getBlockNumber();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    log.warn('rpc health check failed', { err: String(e) });
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}
