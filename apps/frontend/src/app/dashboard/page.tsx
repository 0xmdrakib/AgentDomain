import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { Providers } from '@/components/providers';
import { createPageMetadata } from '@/lib/seo';

export const metadata: Metadata = createPageMetadata({
  title: 'Agent Dashboard',
  description: 'Manage AgentDomain identities, infrastructure, usage, and renewals.',
  path: '/dashboard',
  index: false,
});

export default function DashboardPage() {
  return (
    <Providers>
      <main className="min-h-screen bg-background">
        <LandingNav />
        <DashboardClient />
        <Footer />
      </main>
    </Providers>
  );
}
