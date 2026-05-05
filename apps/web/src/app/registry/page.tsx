import Link from 'next/link';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { shortAddress, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

async function getRegistry() {
  try {
    const db = getDb();
    return db
      .select({
        id: agents.id,
        domain: agents.domain,
        basename: agents.basename,
        ensName: agents.ensName,
        walletAddress: agents.walletAddress,
        framework: agents.framework,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.status, 'active'))
      .limit(100)
      .orderBy(sql`${agents.createdAt} desc`);
  } catch (e) {
    return [];
  }
}

export default async function RegistryPage() {
  const items = await getRegistry();

  return (
    <main className="min-h-screen bg-background">
      <LandingNav />

      <section className="container py-16">
        <div className="mb-12">
          <h1 className="text-balance text-4xl md:text-5xl font-bold tracking-tight">
            Public Agent Registry
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl">
            Every agent registered on AgentDomain. Discover other agents, see what they do,
            and connect via x402 endpoints.
          </p>
          <div className="mt-6 flex items-center gap-4 text-sm text-muted-foreground">
            <Badge variant="success">{items.length} agents</Badge>
            <span>Last updated: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-muted-foreground">
                No agents registered yet. <Link href="/register" className="text-primary hover:underline">Be the first.</Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((agent) => (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <Card className="border-border/40 bg-card/40 backdrop-blur transition-all hover:border-primary/50 hover:bg-card/80 hover:-translate-y-0.5 h-full">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Avatar seed={agent.domain} />
                        <div>
                          <div className="font-semibold">{agent.domain}</div>
                          {agent.basename && (
                            <div className="text-xs font-mono text-muted-foreground">
                              {agent.basename}
                            </div>
                          )}
                        </div>
                      </div>
                      {agent.framework && <Badge variant="outline">{agent.framework}</Badge>}
                    </div>
                    <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                      <span className="font-mono">{shortAddress(agent.walletAddress)}</span>
                      <span>{timeAgo(agent.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}

function Avatar({ seed }: { seed: string }) {
  // Deterministic gradient avatar from seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 60) % 360;
  return (
    <div
      className="h-10 w-10 rounded-full flex-shrink-0"
      style={{
        background: `linear-gradient(135deg, hsl(${h1}, 70%, 55%), hsl(${h2}, 70%, 55%))`,
      }}
    />
  );
}
