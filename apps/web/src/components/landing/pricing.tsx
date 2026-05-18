import { Calculator, Check, Globe2, Layers3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const priceBlocks = [
  {
    icon: Globe2,
    title: 'Domain cost',
    price: 'Live registrar price',
    description:
      'Spaceship availability pricing is used when available. No domain markup is added.',
    items: ['.xyz usually low cost', '.com is supported', '.ai/.io vary by registry'],
  },
  {
    icon: Layers3,
    title: 'Onchain names',
    price: 'Optional add-ons',
    description:
      'Basename and ENS labels can be different from the domain if the matching name is taken.',
    items: [
      'Basename: rent + Base gas only',
      'ENS: rent + Ethereum L1 gas only',
      'AgentID NFT minted on Base',
    ],
  },
  {
    icon: Calculator,
    title: 'Platform fee',
    price: '$2 per registration',
    description:
      'Covers orchestration, DNS setup, IPFS metadata, monitoring, and checkout infrastructure.',
    items: ['No monthly plan required', 'USDC payment on Base', 'Final quote before signing'],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border/40 py-16 sm:py-24">
      <div className="container">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Live Pricing of all domains
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            The checkout calculates the real total from the selected TLD, live registrar data,
            Basename availability, ENS L1 rent, and current gas.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3 sm:gap-6">
          {priceBlocks.map((block) => {
            const Icon = block.icon;
            return (
              <Card key={block.title} className="border-border/40 bg-card/50">
                <CardContent className="p-5 sm:p-8">
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{block.title}</h3>
                  <div className="mt-3 font-mono text-xl font-bold">{block.price}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {block.description}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {block.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center sm:p-6">
          <div>
            <div className="text-lg font-semibold">See the exact amount before signing</div>
            <p className="mt-2 text-sm text-muted-foreground">
              No charge happens until the wallet signs the x402 USDC payment for the displayed
              quote.
            </p>
          </div>
          <Link href="/register">
            <Button variant="gradient" size="lg">
              Open live quote
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
