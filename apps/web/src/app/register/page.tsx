import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { RegisterFlow } from '@/components/register/register-flow';

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <section className="container py-16 max-w-3xl">
        <div className="mb-10 text-center">
          <h1 className="text-balance text-4xl md:text-5xl font-bold tracking-tight">
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
