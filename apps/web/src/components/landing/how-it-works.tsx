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
    <section id="how-it-works" className="py-24 border-t border-border/40">
      <div className="container">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-balance text-4xl md:text-5xl font-bold tracking-tight">
            From request to identity in <span className="gradient-text">one flow</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            One API call, zero human intervention, full identity stack.
          </p>
        </div>

        <ol className="relative max-w-3xl mx-auto space-y-6">
          {steps.map((step, i) => (
            <li key={step.n} className="relative flex gap-6 group">
              {i < steps.length - 1 && (
                <div className="absolute left-8 top-16 h-full w-px bg-gradient-to-b from-border to-transparent" />
              )}
              <div className="flex-shrink-0">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/60 bg-card font-mono text-sm transition-all group-hover:border-primary group-hover:bg-primary/10 group-hover:text-primary">
                  {step.n}
                </div>
              </div>
              <div className="pb-6 flex-1">
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-muted-foreground">{step.desc}</p>
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
