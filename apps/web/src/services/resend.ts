import { Resend } from 'resend';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Resend integration for agent email infrastructure.
 *
 * Each agent that opts into email gets:
 *   - A verified Resend domain (we add the agent's domain to our Resend account)
 *   - DNS records for SPF/DKIM/DMARC (returned to caller for installation)
 *   - An inbox alias (agent@<domain>) routed via inbound webhooks
 */

const log = logger.child({ service: 'resend' });

export interface ResendDomainSetup {
  domainId: string;
  status: 'pending' | 'verified' | 'failed';
  dnsRecords: { type: string; name: string; value: string; ttl?: number }[];
}

export class ResendService {
  private readonly client: Resend;

  constructor() {
    const env = getServerEnv();
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    this.client = new Resend(env.RESEND_API_KEY);
  }

  /**
   * Add a domain to our Resend account so we can send/receive email on its behalf.
   * Returns DNS records that need to be added to the agent's zone.
   */
  async addDomain(domain: string): Promise<ResendDomainSetup> {
    const result = await this.client.domains.create({ name: domain });
    if (result.error) {
      throw new Error(`Resend addDomain failed: ${result.error.message}`);
    }
    const data = result.data!;
    log.info('domain added to resend', { domain, id: data.id });

    const records = (data.records ?? []).map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
      ttl: 3600,
    }));

    return {
      domainId: data.id,
      status: data.status as ResendDomainSetup['status'],
      dnsRecords: records,
    };
  }

  async verifyDomain(domainId: string): Promise<{ verified: boolean }> {
    const result = await this.client.domains.verify(domainId);
    if (result.error) {
      throw new Error(`Resend verifyDomain failed: ${result.error.message}`);
    }
    return { verified: result.data?.id != null };
  }

  /**
   * Send an email from an agent's address.
   */
  async sendEmail(opts: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ id: string }> {
    // Resend's send() accepts either {text|html} or {react}; we always provide
    // text or html, never react. Build the payload without `undefined` keys to
    // satisfy the strict union.
    const payload: Record<string, unknown> = {
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
    };
    if (opts.text != null) payload.text = opts.text;
    if (opts.html != null) payload.html = opts.html;
    if (opts.replyTo != null) payload.replyTo = opts.replyTo;
    if (payload.text == null && payload.html == null) {
      throw new Error('sendEmail requires either text or html');
    }

    const result = await this.client.emails.send(payload as unknown as Parameters<typeof this.client.emails.send>[0]);
    if (result.error) {
      throw new Error(`Resend sendEmail failed: ${result.error.message}`);
    }
    return { id: result.data!.id };
  }

  async deleteDomain(domainId: string): Promise<void> {
    const result = await this.client.domains.remove(domainId);
    if (result.error) {
      throw new Error(`Resend deleteDomain failed: ${result.error.message}`);
    }
  }
}

let _instance: ResendService | null = null;
export function getResend(): ResendService {
  if (!_instance) _instance = new ResendService();
  return _instance;
}
