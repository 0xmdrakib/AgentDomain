const frameworks = [
  { name: 'Coinbase AgentKit', plugin: '@agentdomain/agentkit-plugin' },
  { name: 'ElizaOS', plugin: '@agentdomain/eliza-plugin' },
  { name: 'OpenAI SDK', plugin: '@agentdomain/sdk' },
  { name: 'Anthropic SDK', plugin: '@agentdomain/sdk' },
];

export function Frameworks() {
  return (
    <section className="py-20 border-t border-border/40 bg-muted/20">
      <div className="container">
        <p className="text-center text-sm text-muted-foreground uppercase tracking-widest mb-10">
          Works with supported agent stacks
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {frameworks.map((f) => (
            <div
              key={f.name}
              className="rounded-lg border border-border/40 bg-card/30 backdrop-blur px-4 py-5 text-center transition-all hover:border-primary/40 hover:bg-card/60"
            >
              <div className="font-semibold text-sm">{f.name}</div>
              <div className="mt-1 text-[10px] font-mono text-muted-foreground truncate">
                {f.plugin}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
