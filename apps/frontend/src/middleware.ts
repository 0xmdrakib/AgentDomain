import { NextResponse, type NextRequest } from 'next/server';

const WEBSITE_HOST = 'agentdomain.app';
const WWW_HOST = 'www.agentdomain.app';
const API_HOST = 'api.agentdomain.app';
const WEBSITE_ORIGIN = `https://${WEBSITE_HOST}`;
const DOCS_ORIGIN = 'https://docs.agentdomain.app';
const API_ORIGIN = `https://${API_HOST}`;
const SAFE_REDIRECT_METHODS = new Set(['GET', 'HEAD']);
const NO_STORE = 'no-store, max-age=0';

function requestHost(value: string | null): string | null {
  if (!value || value.length > 253 || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`https://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDocsPath(pathname: string) {
  return pathname === '/docs' || pathname.startsWith('/docs/');
}

function isApiRoot(pathname: string) {
  return pathname === '/api' || pathname === '/api/';
}

function isVersionedApiPath(pathname: string) {
  return pathname === '/api/v1' || pathname.startsWith('/api/v1/');
}

function isApiNamespace(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function redirect(request: NextRequest, origin: string, pathname: string) {
  const destination = new URL(origin);
  destination.pathname = pathname;
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

function docsPath(pathname: string) {
  const suffix = pathname.slice('/docs'.length);
  return suffix || '/';
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: 'METHOD_NOT_ALLOWED', message: 'This route accepts GET and HEAD only.' },
    {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Cache-Control': NO_STORE,
      },
    },
  );
}

function apiNotFound(request: NextRequest) {
  if (request.method === 'HEAD') {
    return new NextResponse(null, {
      status: 404,
      headers: {
        'Cache-Control': NO_STORE,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }
  return NextResponse.json(
    { error: 'NOT_FOUND', message: 'This API route does not exist.' },
    { status: 404, headers: { 'Cache-Control': NO_STORE } },
  );
}

export function middleware(request: NextRequest) {
  const host = requestHost(request.headers.get('host'));
  const pathname = request.nextUrl.pathname;
  const safeRedirect = SAFE_REDIRECT_METHODS.has(request.method);

  if (host === WWW_HOST) {
    if (!safeRedirect) return methodNotAllowed();
    if (isDocsPath(pathname)) return redirect(request, DOCS_ORIGIN, docsPath(pathname));
    if (isApiNamespace(pathname)) return redirect(request, API_ORIGIN, pathname);
    return redirect(request, WEBSITE_ORIGIN, pathname);
  }

  if (host === API_HOST) {
    if (pathname === '/' || isApiRoot(pathname)) {
      return safeRedirect ? redirect(request, API_ORIGIN, '/api/v1') : methodNotAllowed();
    }
    return isVersionedApiPath(pathname) ? NextResponse.next() : apiNotFound(request);
  }

  if (isDocsPath(pathname)) {
    return safeRedirect ? redirect(request, DOCS_ORIGIN, docsPath(pathname)) : methodNotAllowed();
  }

  if (isApiRoot(pathname)) {
    return safeRedirect ? redirect(request, API_ORIGIN, '/api/v1') : methodNotAllowed();
  }

  if (isApiNamespace(pathname)) {
    if (host === WEBSITE_HOST && isVersionedApiPath(pathname)) return NextResponse.next();
    return apiNotFound(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/docs/:path*',
    {
      source: '/:path*',
      has: [{ type: 'host', value: 'www\\.agentdomain\\.app' }],
    },
    {
      source: '/:path*',
      has: [{ type: 'host', value: 'api\\.agentdomain\\.app' }],
    },
  ],
};
