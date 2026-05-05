import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Sparkles } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-pattern opacity-50" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-gradient-to-r from-blue-500/20 via-violet-500/20 to-fuchsia-500/20 blur-3xl" />

      <div className="container relative py-24 md:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <Badge
            variant="outline"
            className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 backdrop-blur"
          >
            <Sparkles className="h-3 w-3 text-violet-400" />
            <span className="text-xs">Powered by Base, x402, and Coinbase Developer Platform</span>
          </Badge>

          <h1 className="text-balance text-5xl md:text-7xl font-bold tracking-tight">
            Identity infrastructure for the <span className="gradient-text">agent economy</span>
          </h1>

          <p className="mt-6 text-balance text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            The autonomous identity stack for AI agents.{' '}
            <span className="text-foreground font-medium">
              Domain + Basename + DNS + Email + SSL
            </span>{' '}
            in one transaction on Base. Pay in USDC, no human required.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button variant="gradient" size="xl" className="group">
                Register an agent
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline" size="xl">
                Read the docs
              </Button>
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-3 gap-4 max-w-md mx-auto text-left">
            <CodePreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function CodePreview() {
  return (
    <div className="col-span-3">
      <div className="rounded-xl border border-border/60 bg-black/40 backdrop-blur p-1 shadow-2xl shadow-violet-500/10">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 font-mono text-xs text-muted-foreground">register.ts</span>
        </div>
        <pre className="overflow-x-auto p-4 text-left font-mono text-xs leading-relaxed">
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
