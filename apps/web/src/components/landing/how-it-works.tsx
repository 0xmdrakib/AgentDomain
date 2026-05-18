const steps = [
  {
    n: '01',
    title: 'Agent makes a request',
    desc: 'Your agent calls /agents/register with a preferred name. No accounts, no setup.',
    detail: 'POST /agents/register',
  },
  {
    n: '02',
    title: 'Server returns 402',
    desc: 'AgentDomain responds with HTTP 402 Payment Required and an x402 challenge.',
    detail: 'X-Payment-Required: USDC 25.00 on Base',
  },
  {
    n: '03',
    title: 'Agent signs payment',
    desc: 'The SDK auto-builds an EIP-3009 transferWithAuthorization signed by the agent wallet.',
    detail: 'EIP-3009 signed locally',
  },
  {
    n: '04',
    title: 'Provisioning fans out',
    desc: 'Domain registers via Spaceship. Basic DNS syncs. Basename minted on Base. SES email and SaaS SSL provision.',
    detail: 'Automated end-to-end',
  },
  {
    n: '05',
    title: 'AgentID NFT minted',
    desc: 'A single ERC-721 represents your full identity bundle. Yours forever.',
    detail: 'AGENTID #1234',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border/40 py-16 sm:py-24">
      <div className="container">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            From request to identity in <span className="gradient-text">one flow</span>
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            One API call, zero human intervention, full identity stack.
          </p>
        </div>

        <ol className="relative mx-auto max-w-3xl space-y-6">
          {steps.map((step, i) => (
            <li key={step.n} className="group relative flex gap-4 sm:gap-6">
              {i < steps.length - 1 && (
                <div className="absolute left-7 top-14 h-full w-px bg-gradient-to-b from-border to-transparent sm:left-8 sm:top-16" />
              )}
              <div className="flex-shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-card font-mono text-xs transition-all group-hover:border-primary group-hover:bg-primary/10 group-hover:text-primary sm:h-16 sm:w-16 sm:text-sm">
                  {step.n}
                </div>
              </div>
              <div className="flex-1 pb-6">
                <h3 className="text-base font-semibold sm:text-lg">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">{step.desc}</p>
                <code className="mt-2 inline-block px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground">
                  {step.detail}
                </code>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
