import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { RegisterFlow } from '@/components/register/register-flow';

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <section className="container max-w-3xl py-10 sm:py-16">
        <div className="mb-8 text-center sm:mb-10">
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
  );
}
