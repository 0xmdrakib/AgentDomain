import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SolutionPage } from '@/components/seo/solution-page';
import { createPageMetadata } from '@/lib/seo';
import { getIntegrationPage, integrationSlugs } from '@/lib/solution-pages';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return integrationSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = getIntegrationPage((await params).slug);
  if (!page) return {};
  return createPageMetadata({
    title: page.title,
    description: page.description,
    path: page.path,
  });
}

export default async function IntegrationPage({ params }: PageProps) {
  const page = getIntegrationPage((await params).slug);
  if (!page) notFound();
  return <SolutionPage page={page} />;
}
