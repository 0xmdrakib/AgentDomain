const frameworks = [
  { name: 'Coinbase AgentKit', plugin: '@agentdomain/agentkit-plugin' },
  { name: 'ElizaOS', plugin: '@agentdomain/eliza-plugin' },
  { name: 'OpenAI SDK', plugin: '@agentdomain/sdk' },
  { name: 'Anthropic SDK', plugin: '@agentdomain/sdk' },
];

export function Frameworks() {
  return (
    <section className="border-t border-border/40 bg-muted/20 py-16 sm:py-20">
      <div className="container">
        <p className="mb-8 text-center text-xs uppercase tracking-widest text-muted-foreground sm:mb-10 sm:text-sm">
          Works with supported agent stacks
        </p>
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {frameworks.map((f) => (
            <div
              key={f.name}
              className="rounded-lg border border-border/40 bg-card/30 px-4 py-5 text-center backdrop-blur transition-all hover:border-primary/40 hover:bg-card/60"
            >
              <div className="text-sm font-semibold">{f.name}</div>
              <div className="wrap-anywhere mt-1 text-[10px] font-mono text-muted-foreground">
                {f.plugin}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
