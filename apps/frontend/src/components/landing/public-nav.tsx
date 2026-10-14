/* eslint-disable @next/next/no-html-link-for-pages -- Public pages use full navigation to avoid shipping router JavaScript. */

import {
  BadgeCheck,
  BookOpen,
  CircleDollarSign,
  Headset,
  LayoutDashboard,
  LibraryBig,
  Menu,
  PanelsTopLeft,
  UserRoundPlus,
  Workflow,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';
import { Button } from '@/components/ui/button';

const links = [
  { href: '/#features', label: 'Features', icon: PanelsTopLeft },
  { href: '/#how-it-works', label: 'How it works', icon: Workflow },
  { href: '/#pricing', label: 'Pricing', icon: CircleDollarSign },
  { href: '/registry', label: 'Registry', icon: LibraryBig },
  { href: '/verify', label: 'Identity Check', icon: BadgeCheck },
  { href: 'mailto:contact@agentdomain.app', label: 'Support', icon: Headset },
  { href: 'https://docs.agentdomain.app', label: 'Docs', icon: BookOpen },
] as const;

export function PublicNav() {
  return (
    <header
      style={{ top: 0 }}
      className="agentdomain-sticky-header sticky z-40 w-full border-b border-border/80 bg-background/98 shadow-[0_12px_35px_-30px_rgba(20,21,18,0.45)] backdrop-blur-[12px] md:bg-background/82 md:backdrop-blur-xl"
    >
      <div className="container relative flex h-16 items-center justify-between gap-3">
        <a href="/" className="flex min-w-0 items-center gap-2" aria-label="AgentDomain home">
          <BrandMark priority />
          <span className="truncate text-base font-bold tracking-tight sm:text-lg">
            AgentDomain
          </span>
        </a>

        <nav
          className="hidden items-center gap-4 text-sm xl:flex 2xl:gap-6"
          aria-label="Primary navigation"
        >
          {links.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 xl:flex">
          <Button asChild variant="ghost" size="sm">
            <a href="/dashboard">
              <LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Dashboard
            </a>
          </Button>
          <Button asChild size="sm">
            <a href="/register">
              <UserRoundPlus className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Register
            </a>
          </Button>
        </div>

        <details className="group static xl:hidden">
          <summary className="flex h-10 w-10 shrink-0 cursor-pointer list-none items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground shadow-sm transition hover:border-primary/45 hover:bg-accent hover:text-foreground marker:content-none">
            <Menu className="h-5 w-5 group-open:hidden" aria-hidden />
            <X className="hidden h-5 w-5 group-open:block" aria-hidden />
            <span className="sr-only group-open:hidden">Open navigation</span>
            <span className="sr-only hidden group-open:inline">Close navigation</span>
          </summary>
          <div className="safe-x absolute left-0 right-0 top-full z-50 border-b border-border/90 bg-card p-4 shadow-[0_22px_48px_-34px_rgba(20,21,18,0.5)]">
            <nav className="grid gap-1 text-sm" aria-label="Mobile navigation">
              {links.map(({ href, label, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  className="touch-target flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-4 grid gap-3 border-t border-border/40 pt-4">
              <Button asChild variant="secondary" className="w-full">
                <a href="/dashboard">
                  <LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  Dashboard
                </a>
              </Button>
              <Button asChild className="w-full">
                <a href="/register">
                  <UserRoundPlus className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  Register
                </a>
              </Button>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
