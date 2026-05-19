import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Sparkles } from 'lucide-react';

export function Hero() {
  return (
    <section className="premium-shell relative overflow-hidden border-b border-border/50">
      <div className="absolute inset-0 grid-pattern opacity-70" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <div className="container relative py-16 sm:py-20 md:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <Badge
            variant="outline"
            className="mb-5 inline-flex max-w-full items-center gap-2 border-primary/25 bg-primary/10 px-3 py-1.5 text-left text-primary shadow-sm shadow-primary/10 sm:mb-6 sm:px-4"
          >
            <Sparkles className="h-3 w-3 text-violet-400" />
            <span className="wrap-anywhere text-xs">
              Powered by Base, x402, and Coinbase Developer Platform
            </span>
          </Badge>

          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl md:text-7xl">
            Identity infrastructure for the <span className="gradient-text">agent economy</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:mt-6 sm:text-lg md:text-xl">
            The autonomous identity stack for AI agents.{' '}
            <span className="text-foreground font-medium">
              Domain + Basename + DNS + Email + SSL
            </span>{' '}
            in one transaction on Base. Pay in USDC, no human required.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/register" className="w-full sm:w-auto">
              <Button variant="gradient" size="xl" className="group w-full sm:w-auto">
                Register an agent
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/docs" className="w-full sm:w-auto">
              <Button variant="outline" size="xl" className="w-full sm:w-auto">
                Read the docs
              </Button>
            </Link>
          </div>

          <div className="mx-auto mt-10 grid max-w-md grid-cols-1 gap-4 text-left sm:mt-12 sm:grid-cols-3">
            <CodePreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function CodePreview() {
  return (
    <div className="sm:col-span-3">
      <div className="code-surface overflow-hidden rounded-lg border p-1 backdrop-blur">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 font-mono text-xs text-muted-foreground">register.ts</span>
        </div>
        <pre className="mobile-scroll p-3 text-left font-mono text-[10px] leading-relaxed sm:p-4 sm:text-xs">
          <code>
            <span className="text-violet-400">import</span>{' '}
            <span className="text-blue-300">{'{ AgentDomain }'}</span>{' '}
            <span className="text-violet-400">from</span>{' '}
            <span className="text-emerald-300">{`'@agentdomain/sdk'`}</span>;{'\n\n'}
            <span className="text-violet-400">const</span> ad ={' '}
            <span className="text-violet-400">new</span>{' '}
            <span className="text-blue-300">AgentDomain</span>({'{ '}walletClient, publicClient
            {' }'});
            {'\n\n'}
            <span className="text-violet-400">const</span> identity ={' '}
            <span className="text-violet-400">await</span> ad.
            <span className="text-blue-300">register</span>({'{'}
            {'\n  '}preferredName: <span className="text-emerald-300">{`'example'`}</span>,
            {'\n  '}tld: <span className="text-emerald-300">{`'com'`}</span>,{'\n  '}
            registerBasename: <span className="text-amber-300">true</span>,{'\n  '}
            registerEns: <span className="text-amber-300">true</span>,{'\n  '}
            years: <span className="text-amber-300">1</span>,{'\n  '}
            autoRenew: <span className="text-amber-300">true</span>,{'\n  '}
            emailEnabled: <span className="text-amber-300">true</span>,{'\n'}
            {'}'});{'\n\n'}
            <span className="text-muted-foreground">{`// → example.com · example.base.eth · example.eth · agent@example.com`}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}
