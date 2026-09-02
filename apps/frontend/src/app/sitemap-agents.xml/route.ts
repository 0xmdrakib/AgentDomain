import { getPublicBackend } from '@/lib/backend-client';
import { PublicBackendError } from '@/lib/backend-transport';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const body = await getPublicBackend().sitemap();
    return new Response(body, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    const reference = error instanceof PublicBackendError ? error.reference : undefined;
    return new Response('Sitemap temporarily unavailable', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex',
        ...(reference ? { 'X-Request-Reference': reference } : {}),
      },
    });
  }
}
