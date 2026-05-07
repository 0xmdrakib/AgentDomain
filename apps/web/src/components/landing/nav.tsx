'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/wallet/auth-button';
import { useSiwe } from '@/hooks/use-siwe';
import { useAccount } from 'wagmi';

function isAdmin(address: string | undefined): boolean {
  if (!address) return false;
  const list = (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(address.toLowerCase());
}

export function LandingNav() {
  const { session } = useSiwe();
  const { address } = useAccount();
  const showAdmin = isAdmin(address) || session.isAdmin;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-bold tracking-tight">AgentDomain</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm">
          <Link
            href="/#features"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Features
          </Link>
          <Link
            href="/#how-it-works"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            How it works
          </Link>
          <Link
            href="/#pricing"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/registry"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Registry
          </Link>
          <Link
            href="/docs"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </Link>
          {showAdmin && (
            <Link
              href="/admin"
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              Dashboard
            </Button>
          </Link>
          <AuthButton />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="relative h-7 w-7">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500" />
      <div className="absolute inset-[3px] rounded-full bg-background" />
      <div className="absolute inset-[6px] rounded-full bg-gradient-to-br from-blue-500 to-violet-500" />
    </div>
  );
}
