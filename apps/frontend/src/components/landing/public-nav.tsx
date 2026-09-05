/* eslint-disable @next/next/no-html-link-for-pages -- Public pages use full navigation to avoid shipping router JavaScript. */

import { Menu, X } from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';
import { Button } from '@/components/ui/button';

const links = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/registry', label: 'Registry' },
  { href: 'https://docs.agentdomain.app', label: 'Docs' },
] as const;

export function PublicNav() {
  return (
    <header
      style={{ top: 'var(--registration-banner-height, 0px)' }}
      className="agentdomain-sticky-header sticky z-40 w-full border-b border-border/80 bg-background/98 shadow-[0_12px_35px_-30px_rgba(20,21,18,0.45)] backdrop-blur-[12px] md:bg-background/82 md:backdrop-blur-xl"
    >
      <div className="container relative flex h-16 items-center justify-between gap-3">
        <a href="/" className="flex min-w-0 items-center gap-2" aria-label="AgentDomain home">
          <BrandMark priority />
          <span className="truncate text-base font-bold tracking-tight sm:text-lg">
            AgentDomain
          </span>
        </a>

        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Primary navigation">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <a href="/dashboard">Dashboard</a>
          </Button>
          <Button asChild size="sm">
            <a href="/register">Register</a>
          </Button>
        </div>

        <details className="group static md:hidden">
          <summary className="touch-target flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground shadow-sm transition hover:border-primary/45 hover:bg-accent hover:text-foreground marker:content-none">
            <Menu className="h-5 w-5 group-open:hidden" aria-hidden />
            <X className="hidden h-5 w-5 group-open:block" aria-hidden />
            <span className="sr-only group-open:hidden">Open navigation</span>
            <span className="sr-only hidden group-open:inline">Close navigation</span>
          </summary>
          <div className="safe-x absolute left-0 right-0 top-full z-50 border-b border-border/90 bg-card p-4 shadow-[0_22px_48px_-34px_rgba(20,21,18,0.5)]">
            <nav className="grid gap-1 text-sm" aria-label="Mobile navigation">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="touch-target flex items-center rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="mt-4 grid gap-3 border-t border-border/40 pt-4">
              <Button asChild variant="secondary" className="w-full">
                <a href="/dashboard">Dashboard</a>
              </Button>
              <Button asChild className="w-full">
                <a href="/register">Register</a>
              </Button>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
