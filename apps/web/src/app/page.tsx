import { LandingNav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { Features } from '@/components/landing/features';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Frameworks } from '@/components/landing/frameworks';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <Hero />
      <Frameworks />
      <Features />
      <HowItWorks />
      <Pricing />
      <Footer />
    </main>
  );
}
