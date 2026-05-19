'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/wallet/auth-button';
import { useSiwe } from '@/hooks/use-siwe';
import { useAccount } from 'wagmi';
import { Menu, X } from 'lucide-react';

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
  const showAdmin = isAdmin(address) || Boolean(session.isAdmin);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 shadow-[0_12px_45px_-35px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <div ref={menuRef} className="container relative flex h-16 items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(false)}>
          <Logo />
          <span className="truncate text-base font-bold tracking-tight sm:text-lg">AgentDomain</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm md:flex">
          <NavLinks showAdmin={showAdmin} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              Dashboard
            </Button>
          </Link>
          <AuthButton />
        </div>
        <button
          type="button"
          className="touch-target inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground shadow-sm shadow-black/20 transition hover:border-primary/50 hover:bg-accent hover:text-foreground md:hidden"
          onClick={() => setOpen((next) => !next)}
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {open && (
          <div className="safe-x premium-surface absolute left-0 right-0 top-full z-50 border-b p-4 shadow-2xl shadow-black/35 md:hidden">
            <nav className="grid gap-1 text-sm">
              <NavLinks showAdmin={showAdmin} onNavigate={() => setOpen(false)} mobile />
            </nav>
            <div className="mt-4 grid gap-3 border-t border-border/40 pt-4">
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                <Button variant="secondary" className="w-full">
                  Dashboard
                </Button>
              </Link>
              <AuthButton className="w-full justify-center" />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function NavLinks({
  showAdmin,
  onNavigate,
  mobile,
}: {
  showAdmin: boolean;
  onNavigate: () => void;
  mobile?: boolean;
}) {
  const linkClass = mobile
    ? 'touch-target flex items-center rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground'
    : 'text-muted-foreground hover:text-foreground transition-colors';

  return (
    <>
      <Link href="/#features" className={linkClass} onClick={onNavigate}>
        Features
      </Link>
      <Link href="/#how-it-works" className={linkClass} onClick={onNavigate}>
        How it works
      </Link>
      <Link href="/#pricing" className={linkClass} onClick={onNavigate}>
        Pricing
      </Link>
      <Link href="/registry" className={linkClass} onClick={onNavigate}>
        Registry
      </Link>
      <Link href="/docs" className={linkClass} onClick={onNavigate}>
        Docs
      </Link>
      {showAdmin && (
        <Link
          href="/admin"
          className={
            mobile
              ? 'touch-target flex items-center rounded-md px-3 py-2 font-medium text-primary transition-colors hover:bg-primary/10'
              : 'font-medium text-primary hover:text-primary/80 transition-colors'
          }
          onClick={onNavigate}
        >
          Admin
        </Link>
      )}
    </>
  );
}

function Logo() {
  return (
    <div className="relative h-7 w-7">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-emerald-400 shadow-lg shadow-cyan-500/20" />
      <div className="absolute inset-[3px] rounded-full bg-background" />
      <div className="absolute inset-[6px] rounded-full bg-gradient-to-br from-cyan-400 to-blue-500" />
    </div>
  );
}
