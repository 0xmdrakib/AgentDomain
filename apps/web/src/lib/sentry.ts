/**
 * Sentry initialization helpers.
 *
 * We avoid auto-instrumenting Next.js with the heavy @sentry/nextjs config files
 * because they slow down builds and pull in too much runtime overhead. Instead
 * we lazily initialize Sentry on the server only, and expose simple capture
 * helpers used from our error boundary.
 *
 * If SENTRY_DSN is not set, all helpers become no-ops. Safe to call from any code.
 */

let _initialized = false;
let _sentry: typeof import('@sentry/nextjs') | null = null;

async function getSentry() {
  if (_initialized) return _sentry;
  _initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV ?? 'development',
      integrations: [],
    });
    _sentry = Sentry;
    return Sentry;
  } catch (e) {
    console.warn('Sentry init failed:', e);
    return null;
  }
}

export async function captureException(err: unknown, context?: Record<string, unknown>) {
  const Sentry = await getSentry();
  if (!Sentry) return;
  Sentry.captureException(err, { extra: context });
}

export async function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  const Sentry = await getSentry();
  if (!Sentry) return;
  Sentry.captureMessage(message, level);
}

export async function setUser(user: { id?: string; address?: string } | null) {
  const Sentry = await getSentry();
  if (!Sentry) return;
  Sentry.setUser(user);
}
