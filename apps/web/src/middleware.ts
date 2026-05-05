import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge middleware: applies security headers to every response.
 *
 * Runs at the edge (no Node.js APIs) so this stays cheap and fast.
 *
 * Headers applied:
 *   - X-Frame-Options: clickjacking protection
 *   - X-Content-Type-Options: MIME sniffing protection
 *   - Referrer-Policy: don't leak URLs to third parties
 *   - Permissions-Policy: disable browser APIs we don't use
 *   - Strict-Transport-Security: enforce HTTPS for 2 years
 *   - Content-Security-Policy: prevent XSS, restrict resource origins
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // ===== Always-on security headers =====
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );

  // HSTS only on production HTTPS
  if (process.env.NODE_ENV === 'production') {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  // ===== CSP =====
  // Tight on UI routes, slightly looser on API routes (no HTML rendering anyway).
  const isApi = pathname.startsWith('/api/');

  if (!isApi) {
    const csp = [
      "default-src 'self'",
      // Next.js + wagmi need 'unsafe-inline' for some scripts; eval needed by wagmi/walletconnect.
      // Tighten with nonce-based CSP after stabilization.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: wss: data:",
      "frame-src 'self' https://verify.walletconnect.com https://*.walletconnect.org https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');
    res.headers.set('Content-Security-Policy', csp);
  }

  // ===== CORS for API routes =====
  if (isApi) {
    // Allow same-origin always. For external agents calling the API:
    //   - public endpoints (search, availability, registry): allow any origin
    //   - authenticated endpoints: require explicit allowlist (Production)
    const origin = req.headers.get('origin');
    const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const isPublicEndpoint =
      pathname.includes('/agents/search') ||
      pathname.includes('/agents/quote') ||
      pathname.includes('/domains/availability') ||
      pathname === '/api/health';

    if (isPublicEndpoint) {
      res.headers.set('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
      res.headers.set('Vary', 'Origin');
    }

    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Payment, X-Idempotency-Key, X-Api-Key, X-Turnstile-Token',
    );
    res.headers.set('Access-Control-Max-Age', '86400');

    // Preflight short-circuit
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: res.headers });
    }
  }

  return res;
}

export const config = {
  // Apply to everything except Next internals + static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};
