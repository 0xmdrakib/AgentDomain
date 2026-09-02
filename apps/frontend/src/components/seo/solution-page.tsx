/* eslint-disable @next/next/no-html-link-for-pages -- Public SEO pages use full navigation to remain server-only. */

import { ArrowRight, CheckCircle2, Terminal } from 'lucide-react';
import { PublicNav } from '@/components/landing/public-nav';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbJsonLd } from '@/lib/seo';
import type { SolutionPageDefinition } from '@/lib/solution-pages';

export function SolutionPage({ page }: { page: SolutionPageDefinition }) {
  return (
    <main className="min-h-screen bg-background">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'AgentDomain', path: '/' },
          { name: page.heading, path: page.path },
        ])}
      />
      <PublicNav />

      <section className="border-b border-border/70">
        <div className="container max-w-6xl py-14 sm:py-20">
          <p className="text-sm font-semibold text-primary">{page.eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-bold sm:text-5xl md:text-6xl">
            {page.heading}
          </h1>
          <div className="mt-6 max-w-3xl space-y-3 text-base leading-7 text-muted-foreground sm:text-lg">
            {page.introduction.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href="/register">
                Check a domain <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="https://docs.agentdomain.app">Read the API docs</a>
            </Button>
          </div>
        </div>
      </section>

      <section className="defer-offscreen border-b border-border/70 bg-card/35">
        <div className="container max-w-6xl py-8 sm:py-10">
          <div className="grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
            {page.flow.map((step, index) => (
              <div
                key={step.label}
                className="min-w-0 border-b border-border p-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
              >
                <span className="font-mono text-xs text-primary">0{index + 1}</span>
                <h2 className="mt-2 text-base font-semibold">{step.label}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="defer-offscreen container grid max-w-6xl gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_0.8fr] lg:gap-16">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">What this solves</h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {page.sections.map((section) => (
              <article key={section.title} className="py-6">
                <h3 className="flex items-start gap-3 text-lg font-semibold">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-primary" />
                  {section.title}
                </h3>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                  {section.body}
                </p>
              </article>
            ))}
          </div>
        </div>

        <aside className="self-start lg:sticky lg:top-24">
          <div className="overflow-hidden rounded-md border border-border bg-stone-950 text-stone-100 shadow-xl">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs text-stone-300">
              <Terminal className="h-4 w-4" />
              {page.codeTitle}
            </div>
            <pre className="mobile-scroll p-4 text-xs leading-6 sm:p-5">
              <code>{page.code}</code>
            </pre>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{page.codeCaption}</p>
        </aside>
      </section>

      <section className="defer-offscreen border-y border-border/70 bg-card/35">
        <div className="container max-w-6xl py-12 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">The boundary matters</h2>
          <p className="mt-4 max-w-4xl text-base leading-7 text-muted-foreground">
            {page.distinction}
          </p>
        </div>
      </section>

      <section className="defer-offscreen container max-w-6xl py-14 sm:py-20">
        <h2 className="text-2xl font-bold tracking-tight">Continue exploring</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {page.related.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="interactive-surface rounded-md border border-border bg-card p-5"
            >
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Open <ArrowRight className="h-4 w-4" />
              </span>
            </a>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
