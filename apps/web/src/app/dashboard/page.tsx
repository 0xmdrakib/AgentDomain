import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <DashboardClient />
      <Footer />
    </main>
  );
}
