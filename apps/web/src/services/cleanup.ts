import { eq, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, emailInboxes, emailMessages, sslHostnames } from '@/db/schema';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getCloudflareSaas } from './cloudflare-saas';
import { getSesEmail } from './ses';

const log = logger.child({ service: 'cleanup' });

export async function cleanupExpiredInfrastructure(): Promise<{
  expiredAgents: number;
  deletedOldMessages: number;
}> {
  const db = getDb();
  const env = getServerEnv();
  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - env.MAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deletedMessages = await db
    .delete(emailMessages)
    .where(lt(emailMessages.receivedAt, retentionCutoff))
    .returning({ id: emailMessages.id });

  const candidates = await db
    .select({ agent: agents, ssl: sslHostnames })
    .from(agents)
    .leftJoin(sslHostnames, eq(sslHostnames.agentId, agents.id))
    .limit(200);
  const expired = candidates
    .filter((row) => row.agent.expiresAt && row.agent.expiresAt < now)
    .slice(0, 50);

  let expiredAgents = 0;
  for (const row of expired) {
    if (row.agent.status === 'expired') continue;
    try {
      if (row.ssl?.cloudflareCustomHostnameId) {
        await getCloudflareSaas().deleteHostname(row.ssl.cloudflareCustomHostnameId);
      }
    } catch (e) {
      log.warn('failed to delete cloudflare saas hostname during expiry', {
        agentId: row.agent.id,
        err: String(e),
      });
    }

    try {
      await getSesEmail().deleteIdentity(row.agent.domain);
    } catch (e) {
      log.warn('failed to delete ses identity during expiry', { agentId: row.agent.id, err: String(e) });
    }

    await db.delete(emailInboxes).where(eq(emailInboxes.agentId, row.agent.id));
    await db.delete(sslHostnames).where(eq(sslHostnames.agentId, row.agent.id));
    await db
      .update(agents)
      .set({ status: 'expired', sslStatus: 'expired', updatedAt: now })
      .where(eq(agents.id, row.agent.id));
    expiredAgents++;
  }

  return { expiredAgents, deletedOldMessages: deletedMessages.length };
}
