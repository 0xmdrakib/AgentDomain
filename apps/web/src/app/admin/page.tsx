import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { AdminDashboardClient } from '@/components/admin/admin-dashboard-client';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <AdminDashboardClient />
      <Footer />
    </main>
  );
}
