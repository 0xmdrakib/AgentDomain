import { agentsRepo, emailRepo, sslRepo } from '@/db';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getCloudflareSaas } from './cloudflare-saas';
import { getSesEmail } from './ses';

const log = logger.child({ service: 'cleanup' });

export async function cleanupExpiredInfrastructure(): Promise<{
  expiredAgents: number;
  deletedOldMessages: number;
}> {
  const env = getServerEnv();
  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - env.MAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deletedMessages = await emailRepo.deleteMessagesOlderThan(retentionCutoff);

  const candidates = await agentsRepo.list({ limit: 200, offset: 0 });
  const expired = candidates.items
    .filter((agent) => agent.expiresAt && agent.expiresAt < now)
    .slice(0, 50);

  let expiredAgents = 0;
  for (const agent of expired) {
    if (agent.status === 'expired') continue;
    const ssl = await sslRepo.getByAgent(agent.id);
    try {
      if (ssl?.cloudflareCustomHostnameId) {
        await getCloudflareSaas().deleteHostname(ssl.cloudflareCustomHostnameId);
      }
    } catch (e) {
      log.warn('failed to delete cloudflare saas hostname during expiry', {
        agentId: agent.id,
        err: String(e),
      });
    }

    try {
      await getSesEmail().deleteIdentity(agent.domain);
    } catch (e) {
      log.warn('failed to delete ses identity during expiry', { agentId: agent.id, err: String(e) });
    }

    await emailRepo.deleteInbox(agent.id);
    await sslRepo.delete(agent.id);
    await agentsRepo.update(agent.id, { status: 'expired', sslStatus: 'expired', updatedAt: now });
    expiredAgents++;
  }

  return { expiredAgents, deletedOldMessages: deletedMessages };
}
