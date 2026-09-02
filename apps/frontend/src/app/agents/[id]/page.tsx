import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getPublicBackend } from '@/lib/backend-client';
import { createPageMetadata } from '@/lib/seo';
import { Providers } from '@/components/providers';
import { AgentDetailClient } from '@/components/agents/agent-detail-client';

export const dynamic = 'force-dynamic';
interface PageProps {
  params: Promise<{ id: string }>;
}
const getAgentData = cache((id: string) => getPublicBackend().agent(id));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await getAgentData(id);
  if (!data)
    return createPageMetadata({
      title: 'Identity Not Found',
      description: 'The requested AgentDomain identity could not be found.',
      path: `/agents/${encodeURIComponent(id)}`,
      index: false,
    });
  return createPageMetadata({
    title: `${data.agent.domain} Agent Identity`,
    description:
      data.seo.description ?? `Public identity record for ${data.agent.domain} on AgentDomain.`,
    path: `/agents/${encodeURIComponent(data.agent.id)}`,
    canonical: data.seo.canonical,
    index: data.seo.indexable,
  });
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getAgentData(id);
  if (!data) notFound();
  return (
    <Providers>
      <AgentDetailClient agent={data.agent} />
    </Providers>
  );
}
