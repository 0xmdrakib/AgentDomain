import { Calculator, Check, Gauge, Globe2, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ENTERPRISE_PLAN_OFFERS } from '@agentdomain/shared';
import { EnterprisePlanSelector } from './enterprise-plan-selector';
import Link from 'next/link';

const priceBlocks = [
  {
    icon: Globe2,
    title: 'Domain & onchain names',
    price: 'Live registrar price',
    description: 'Live registrar price with no extra domain markup.',
    items: ['Live registrar price', 'Optional Basename on Base', 'Optional ENS on Ethereum'],
  },
  {
    icon: Gauge,
    title: 'Included email',
    price: '3,000 emails/month',
    description: 'Every registered agent includes a professional send-and-receive inbox.',
    items: [
      'Combined sent + received usage',
      '30-day message retention',
      'Programmable through API keys',
    ],
  },
  {
    icon: Calculator,
    title: 'Platform fee',
    price: '$3.90 per agent per year',
    description:
      'Covers the managed setup behind a complete agent identity: email, SSL, AgentID NFT minting, DNS orchestration, monitoring, and checkout infrastructure.',
    items: [
      'Email inbox and setup included',
      'SSL certification included',
      'AgentID NFT minted onchain',
    ],
  },
];

const planBlocks = [
  {
    icon: Calculator,
    title: 'Starter',
    price: '$59/year',
    description: 'Higher limits for active agents and production apps.',
    items: [
      '25,000 sent + received/month',
      '5 API keys',
      '50 DNS records',
      '5 email aliases',
      'Registry privacy',
      '30-day retention',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Pro',
    price: '$120/year',
    description: 'For production agents with larger communication workloads.',
    items: [
      '50,000 sent + received/month',
      '10 API keys',
      '100 DNS records',
      '10 email aliases',
      'Priority support',
      '30-day retention',
    ],
  },
];

const enterprisePlanOptions = ENTERPRISE_PLAN_OFFERS.map((offer) => ({
  sku: offer.sku,
  monthlyEmails: offer.monthlyEmails,
  yearlyPriceUsdc: Number(offer.yearlyPriceUsdcAtomic / 1_000_000n),
}));

export function Pricing() {
  return (
    <section
      id="pricing"
      className="defer-offscreen border-t border-border/50 bg-background/10 py-16 sm:py-24"
    >
      <div className="container">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Live pricing for every domain
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            The checkout calculates the real total from the selected TLD, live registrar data,
            Basename availability, ENS L1 rent, current gas, and selected per-agent Premium Plan.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl auto-rows-fr grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
          {priceBlocks.map((block) => {
            const Icon = block.icon;
            return (
              <Card
                key={block.title}
                className="interactive-surface premium-surface h-full border-border/60"
              >
                <CardContent className="flex h-full flex-col p-5 sm:p-6">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-primary shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{block.title}</h3>
                  <div className="mt-3 font-mono text-xl font-bold">{block.price}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {block.description}
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {block.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-700" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mx-auto mt-12 max-w-5xl sm:mt-14">
          <div className="mb-5 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">Premium Plans</h3>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Starter, Pro and Enterprise unlock higher limits and private registry visibility per
                agent.
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto grid max-w-5xl auto-rows-fr grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
          {planBlocks.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card
                key={plan.title}
                className="interactive-surface premium-surface h-full border-border/60"
              >
                <CardContent className="flex h-full flex-col p-5 sm:p-6">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-primary shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{plan.title}</h3>
                  <div className="mt-3 font-mono text-xl font-bold">{plan.price}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.description}</p>
                  <ul className="mt-5 space-y-2.5">
                    {plan.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-700" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
          <Card className="interactive-surface premium-surface h-full border-border/60">
            <CardContent className="flex h-full flex-col p-5 sm:p-6">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-primary shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">Enterprise</h3>
              <EnterprisePlanSelector offers={enterprisePlanOptions} />
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Self-serve fleet-grade capacity billed annually through x402.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  'Combined sent + received usage',
                  '25 API keys',
                  '200 DNS records',
                  '20 email aliases',
                  'Enterprise support and registry priority',
                  '30-day retention',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-700" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="premium-surface premium-elevated mx-auto mt-10 flex max-w-3xl flex-col items-center gap-4 rounded-lg border border-primary/20 p-5 text-center sm:p-6">
          <div>
            <div className="text-lg font-semibold">See the exact amount before signing</div>
            <p className="mt-2 text-sm text-muted-foreground">
              No charge happens until the wallet signs the x402 USDC payment for the displayed
              quote.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/register">Open live quote</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
