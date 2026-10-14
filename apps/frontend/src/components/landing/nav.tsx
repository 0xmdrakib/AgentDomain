'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/wallet/auth-button';
import {
  BadgeCheck,
  BookOpen,
  CircleDollarSign,
  Headset,
  LayoutDashboard,
  LibraryBig,
  Menu,
  PanelsTopLeft,
  Workflow,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';

const WALLET_DIALOG_OPEN_ATTR = 'data-agentdomain-wallet-dialog-open';
const WALLET_DIALOG_SELECTOR =
  '[data-agentdomain-wallet-dialog="true"], [data-agentdomain-wallet-menu="true"]';

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (isWalletDialogTarget(event.target)) return;
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
    <header
      style={{ top: 0 }}
      className="agentdomain-sticky-header sticky z-40 w-full border-b border-border/80 bg-background/98 shadow-[0_12px_35px_-30px_rgba(20,21,18,0.45)] backdrop-blur-[12px] md:bg-background/82 md:backdrop-blur-xl"
    >
      <div
        ref={menuRef}
        className="container relative flex h-16 items-center justify-between gap-3"
      >
        <Link href="/" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(false)}>
          <BrandMark priority />
          <span className="truncate text-base font-bold tracking-tight sm:text-lg">
            AgentDomain
          </span>
        </Link>
        <nav
          className="hidden items-center gap-4 text-sm xl:flex 2xl:gap-6"
          aria-label="Primary navigation"
        >
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
        <div className="hidden shrink-0 items-center gap-2 xl:flex">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Dashboard
            </Button>
          </Link>
          <AuthButton />
        </div>
        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground shadow-sm transition hover:border-primary/45 hover:bg-accent hover:text-foreground xl:hidden"
          onClick={() => setOpen((next) => !next)}
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {open && (
          <div
            data-agentdomain-mobile-nav="true"
            className="safe-x absolute left-0 right-0 top-full z-50 border-b border-border/90 bg-card p-4 shadow-[0_22px_48px_-34px_rgba(20,21,18,0.5)] xl:hidden"
          >
            <nav className="grid gap-1 text-sm" aria-label="Mobile navigation">
              <NavLinks onNavigate={() => setOpen(false)} mobile />
            </nav>
            <div className="mt-4 grid gap-3 border-t border-border/40 pt-4">
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                <Button variant="secondary" className="w-full">
                  <LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
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

function isWalletDialogTarget(target: EventTarget | null): boolean {
  if (document.body.hasAttribute(WALLET_DIALOG_OPEN_ATTR)) return true;
  return target instanceof Element && Boolean(target.closest(WALLET_DIALOG_SELECTOR));
}

function NavLinks({ onNavigate, mobile }: { onNavigate: () => void; mobile?: boolean }) {
  const linkClass = mobile
    ? 'touch-target flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground'
    : 'inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors';

  return (
    <>
      <Link href="/#features" className={linkClass} onClick={onNavigate}>
        <PanelsTopLeft className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Features
      </Link>
      <Link href="/#how-it-works" className={linkClass} onClick={onNavigate}>
        <Workflow className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        How it works
      </Link>
      <Link href="/#pricing" className={linkClass} onClick={onNavigate}>
        <CircleDollarSign className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Pricing
      </Link>
      <Link href="/registry" className={linkClass} onClick={onNavigate}>
        <LibraryBig className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Registry
      </Link>
      <Link href="/verify" className={linkClass} onClick={onNavigate}>
        <BadgeCheck className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Identity Check
      </Link>
      <a href="mailto:contact@agentdomain.app" className={linkClass} onClick={onNavigate}>
        <Headset className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Support
      </a>
      <Link href="https://docs.agentdomain.app" className={linkClass} onClick={onNavigate}>
        <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Docs
      </Link>
    </>
  );
}
