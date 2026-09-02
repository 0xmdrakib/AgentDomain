import type { MetadataRoute } from 'next';
import { STATIC_INDEXABLE_ROUTES, absoluteUrl } from '@/lib/seo';

const PRIORITY: Partial<Record<(typeof STATIC_INDEXABLE_ROUTES)[number], number>> = {
  '/': 1,
  '/register': 0.9,
  '/registry': 0.8,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_INDEXABLE_ROUTES.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: PRIORITY[path] ?? 0.7,
  }));
}
