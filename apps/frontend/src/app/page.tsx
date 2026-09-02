import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicNav } from '@/components/landing/public-nav';
import { Hero } from '@/components/landing/hero';
import { Features } from '@/components/landing/features';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Frameworks } from '@/components/landing/frameworks';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';
import { getPublicBackend } from '@/lib/backend-client';
import { CustomDomainAgentPage } from '@/components/agents/custom-domain-agent-page';
import { getCustomDomainHost } from '@/lib/custom-domain';
import { JsonLd } from '@/components/seo/json-ld';
import { createPageMetadata, DEFAULT_DESCRIPTION, homepageJsonLd } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const getAgentForHost = cache((host: string) => getPublicBackend().domain(host));

export async function generateMetadata(): Promise<Metadata> {
  const customHost = getCustomDomainHost(await headers());
  if (!customHost) {
    return createPageMetadata({
      title: 'Identity Infrastructure for AI Agents',
      description: DEFAULT_DESCRIPTION,
      path: '/',
    });
  }

  const data = await getAgentForHost(customHost);
  if (!data) {
    return createPageMetadata({
      title: 'Identity Not Found',
      description: 'No active AgentDomain identity is published at this hostname.',
      path: '/',
      canonical: `https://${customHost}`,
      index: false,
    });
  }

  const { agent, seo } = data;
  return createPageMetadata({
    title: agent.domain,
    description:
      seo.description ??
      `Public internet identity for ${agent.domain}, secured and published through AgentDomain.`,
    path: '/',
    canonical: seo.canonical,
    index: seo.indexable,
  });
}

export default async function HomePage() {
  const customHost = getCustomDomainHost(await headers());
  if (customHost) {
    const data = await getAgentForHost(customHost);
    if (!data) notFound();
    return <CustomDomainAgentPage agent={data.agent} requestedHost={customHost} />;
  }

  return (
    <main className="min-h-screen bg-background">
      <JsonLd data={homepageJsonLd()} />
      <PublicNav />
      <Hero />
      <Frameworks />
      <Features />
      <HowItWorks />
      <Pricing />
      <Footer />
    </main>
  );
}
