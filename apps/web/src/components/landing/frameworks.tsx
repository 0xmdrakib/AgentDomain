const frameworks = [
  { name: 'Coinbase AgentKit', plugin: '@agentdomain/agentkit-plugin' },
  { name: 'ElizaOS', plugin: '@agentdomain/eliza-plugin' },
  { name: 'OpenAI SDK', plugin: '@agentdomain/sdk' },
  { name: 'Anthropic SDK', plugin: '@agentdomain/sdk' },
];

export function Frameworks() {
  return (
    <section className="border-t border-border/50 bg-muted/10 py-16 sm:py-20">
      <div className="container">
        <p className="mb-8 text-center text-xs uppercase tracking-widest text-muted-foreground sm:mb-10 sm:text-sm">
          Works with supported agent stacks
        </p>
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {frameworks.map((f) => (
            <div
              key={f.name}
              className="interactive-surface premium-surface rounded-lg border px-4 py-5 text-center"
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
