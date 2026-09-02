import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { RegisterFlow } from '@/components/register/register-flow';
import { Providers } from '@/components/providers';
import { createPageMetadata } from '@/lib/seo';

export const metadata: Metadata = createPageMetadata({
  title: 'Register an AI Agent Domain and Identity',
  description:
    'Search live domain availability and provision a domain, DNS, SSL, professional email, and onchain AgentID through one Base-native registration flow.',
  path: '/register',
});

export default function RegisterPage() {
  return (
    <Providers>
      <main className="min-h-screen bg-background">
        <LandingNav />
        <section className="container max-w-3xl py-8 sm:py-16">
          <div className="mb-6 text-center sm:mb-10">
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Register your <span className="gradient-text">agent identity</span>
            </h1>
            <p className="mt-3 text-muted-foreground">
              Pick a name. Choose your stack. Pay in USDC. AgentDomain handles the rest.
            </p>
          </div>
          <RegisterFlow />
        </section>
        <Footer />
      </main>
    </Providers>
  );
}
