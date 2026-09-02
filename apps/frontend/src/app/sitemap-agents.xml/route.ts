import { getPublicBackend } from '@/lib/backend-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const upstream = await getPublicBackend().sitemap();
    const body = await upstream.text();
    return new Response(body, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch {
    return new Response('Sitemap temporarily unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
}
