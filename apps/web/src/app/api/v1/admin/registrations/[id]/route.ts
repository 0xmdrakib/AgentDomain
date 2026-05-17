import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { agentsRepo, dnsRepo, emailRepo, registrationsRepo, sslRepo } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const registration = await registrationsRepo.getById(id);
    if (!registration) return errorResponse(404, 'NOT_FOUND', 'Registration not found');

    const agent = registration.agentId ? await agentsRepo.getById(registration.agentId) : null;
    const dnsRecords = agent ? await dnsRepo.list(agent.id) : [];
    const ssl = agent ? await sslRepo.getByAgent(agent.id) : null;
    const inbox = agent ? await emailRepo.getInboxByAgent(agent.id) : null;
    const messages = agent
      ? (await emailRepo.listMessages(agent.id, { limit: 50, offset: 0 })).items
      : [];

    return NextResponse.json({
      registration,
      agent,
      dnsRecords,
      ssl,
      email: inbox ? { inbox, messages } : null,
      caseSummary: buildCaseSummary(registration, agent, ssl, inbox, messages.length),
    });
  }, { route: '/admin/registrations/detail' });
}

function buildCaseSummary(
  registration: Awaited<ReturnType<typeof registrationsRepo.getById>> extends infer T ? NonNullable<T> : never,
  agent: Awaited<ReturnType<typeof agentsRepo.getById>>,
  ssl: Awaited<ReturnType<typeof sslRepo.getByAgent>>,
  inbox: Awaited<ReturnType<typeof emailRepo.getInboxByAgent>>,
  messageCount: number,
) {
  const paymentSettled = Boolean(registration.paymentTxHash || registration.txHash);
  const identityComplete = registration.status === 'completed' && !!agent && agent.status === 'active';
  const partial =
    registration.status === 'failed' &&
    (paymentSettled || !!agent || !!ssl || !!inbox || messageCount > 0);

  return {
    paymentSettled,
    identityComplete,
    partial,
    paymentTxHash: registration.paymentTxHash ?? registration.txHash,
    agentReady: !!agent,
    sslReady: ssl?.sslStatus === 'active',
    emailReady: !!inbox,
    messageCount,
    currentState: registration.progress?.overall ?? registration.status,
  };
}
