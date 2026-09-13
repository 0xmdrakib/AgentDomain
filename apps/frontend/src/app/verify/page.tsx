import { PublicNav } from '@/components/landing/public-nav';
import { Footer } from '@/components/landing/footer';
import { IdentityVerifier } from '@/components/verify/identity-verifier';
import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: 'Identity Check',
  description: 'Inspect AgentDomain identity records and ownership at a fixed safe block on Base.',
  path: '/verify',
});

export default function VerifyPage() {
  return (
    <div className="min-h-screen">
      <PublicNav />
      <main className="container max-w-6xl py-10 [letter-spacing:0] sm:py-14">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <h1 className="max-w-full text-2xl font-semibold [overflow-wrap:anywhere] sm:text-3xl">
            AgentDomain Identity Check
          </h1>
          <span className="inline-flex shrink-0 items-center gap-2 py-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 bg-blue-600" aria-hidden />
            Base / 8453
          </span>
        </header>
        <IdentityVerifier />
      </main>
      <Footer />
    </div>
  );
}
