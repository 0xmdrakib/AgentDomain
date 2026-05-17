import {
  DeleteIdentityCommand,
  GetIdentityDkimAttributesCommand,
  GetIdentityVerificationAttributesCommand,
  SendEmailCommand,
  SESClient,
  VerifyDomainDkimCommand,
  VerifyDomainIdentityCommand,
} from '@aws-sdk/client-ses';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { ManagedDnsRecord } from './dns';

const log = logger.child({ service: 'ses' });

export interface SesDomainSetup {
  identityArn: string;
  verificationStatus: string;
  records: ManagedDnsRecord[];
}

export class SesEmailService {
  private readonly client: SESClient;
  private readonly region: string;

  constructor() {
    const env = getServerEnv();
    this.region = env.AWS_SES_REGION || env.AWS_REGION;
    this.client = new SESClient({ region: this.region });
  }

  async setupDomain(domain: string): Promise<SesDomainSetup> {
    const identity = await this.client.send(new VerifyDomainIdentityCommand({ Domain: domain }));
    const dkim = await this.client.send(new VerifyDomainDkimCommand({ Domain: domain }));
    const verificationStatus = await this.getVerificationStatus(domain);
    const identityArn = `arn:aws:ses:${this.region}:*:identity/${domain}`;
    const tokens = dkim.DkimTokens ?? [];

    const records: ManagedDnsRecord[] = [
      {
        type: 'TXT' as const,
        name: `_amazonses.${domain}`,
        value: identity.VerificationToken ?? '',
        ttl: 3600,
        priority: null,
        providerRecordId: null,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'ses_domain_verification',
      },
      {
        type: 'MX' as const,
        name: '@',
        value: `inbound-smtp.${this.region}.amazonaws.com`,
        ttl: 3600,
        priority: 10,
        providerRecordId: null,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'ses_inbound',
      },
      {
        type: 'TXT' as const,
        name: '@',
        value: 'v=spf1 include:amazonses.com ~all',
        ttl: 3600,
        priority: null,
        providerRecordId: null,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'ses_spf',
      },
      {
        type: 'TXT' as const,
        name: `_dmarc`,
        value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
        ttl: 3600,
        priority: null,
        providerRecordId: null,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'ses_dmarc',
      },
      ...tokens.map((token) => ({
        type: 'CNAME' as const,
        name: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
        ttl: 3600,
        priority: null,
        providerRecordId: null,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'ses_dkim',
      })),
    ].filter((record) => record.value);

    log.info('ses domain setup prepared', { domain, dkimTokens: tokens.length });
    return { identityArn, verificationStatus, records };
  }

  async getVerificationStatus(domain: string): Promise<string> {
    const res = await this.client.send(
      new GetIdentityVerificationAttributesCommand({ Identities: [domain] }),
    );
    return res.VerificationAttributes?.[domain]?.VerificationStatus ?? 'Pending';
  }

  async getDkimVerified(domain: string): Promise<boolean> {
    const res = await this.client.send(new GetIdentityDkimAttributesCommand({ Identities: [domain] }));
    return res.DkimAttributes?.[domain]?.DkimVerificationStatus === 'Success';
  }

  async sendTextEmail(opts: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    replyTo?: string;
  }): Promise<{ id: string }> {
    const env = getServerEnv();
    const result = await this.client.send(
      new SendEmailCommand({
        Source: opts.from,
        Destination: { ToAddresses: opts.to },
        Message: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: opts.text, Charset: 'UTF-8' } },
        },
        ReplyToAddresses: opts.replyTo ? [opts.replyTo] : undefined,
        ConfigurationSetName: env.AWS_SES_CONFIGURATION_SET,
      }),
    );
    if (!result.MessageId) throw new Error('SES sendEmail returned no MessageId');
    return { id: result.MessageId };
  }

  async deleteIdentity(domain: string): Promise<void> {
    await this.client.send(new DeleteIdentityCommand({ Identity: domain }));
  }
}

let _instance: SesEmailService | null = null;
export function getSesEmail(): SesEmailService {
  if (!_instance) _instance = new SesEmailService();
  return _instance;
}
