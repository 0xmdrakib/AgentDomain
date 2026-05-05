/**
 * SSL Provisioner Service
 *
 * Polls active agent domains that need first-time SSL provisioning or renewal,
 * completes ACME DNS-01 challenges through Cloudflare, and stores the resulting
 * certificate material encrypted in Postgres.
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sleep } from '@agentdomain/shared';
import { logger } from './logger';
import { CloudflareDnsClient } from './cloudflare';
import { agents, sslCertificates, type AgentRow, type SslCertificateRow } from './schema';
import { loadSharedEnv } from './load-env';

loadSharedEnv();

type AcmeModule = typeof import('acme-client');
type AcmeClientAutoOptions = import('acme-client').ClientAutoOptions;
type AcmeChallengeCreateFn = AcmeClientAutoOptions['challengeCreateFn'];
type AcmeAuthorization = Parameters<AcmeChallengeCreateFn>[0];
type AcmeChallenge = Parameters<AcmeChallengeCreateFn>[1];

const require = createRequire(import.meta.url);
const acme = require('acme-client') as AcmeModule;

const DAY_MS = 24 * 60 * 60 * 1000;
const schema = { agents, sslCertificates };

function createDb(sqlClient: ReturnType<typeof postgres>) {
  return drizzle(sqlClient, { schema });
}

type Db = ReturnType<typeof createDb>;

async function main() {
  const env = parseEnv();
  logger.info('ssl-provisioner starting', {
    tickIntervalSeconds: env.SSL_PROVISIONER_TICK_INTERVAL_SECONDS,
    directoryUrl: env.ACME_DIRECTORY_URL,
  });

  await safeTick(env);
  setInterval(() => {
    safeTick(env).catch((e) => {
      logger.error('ssl tick failed', { err: e instanceof Error ? e.message : String(e) });
    });
  }, env.SSL_PROVISIONER_TICK_INTERVAL_SECONDS * 1000);
}

async function safeTick(env: Env): Promise<void> {
  try {
    await runTick(env);
  } catch (e) {
    logger.error('ssl tick failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

export async function runTick(env = parseEnv()): Promise<void> {
  const sqlClient = postgres(env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 10 });
  const db = createDb(sqlClient);
  const cf = new CloudflareDnsClient(env.CLOUDFLARE_API_TOKEN);

  try {
    const now = new Date();
    const renewWindow = new Date(now.getTime() + env.SSL_RENEW_BEFORE_DAYS * DAY_MS);
    const candidates = await db
      .select({ agent: agents, cert: sslCertificates })
      .from(agents)
      .leftJoin(sslCertificates, eq(sslCertificates.agentId, agents.id))
      .where(
        and(
          eq(agents.status, 'active'),
          or(
            eq(agents.sslStatus, 'pending'),
            eq(agents.sslStatus, 'provisioning'),
            eq(agents.sslStatus, 'failed'),
            isNull(sslCertificates.id),
            lt(sslCertificates.renewAfter, now),
            lt(sslCertificates.notAfter, renewWindow),
          ),
        ),
      )
      .limit(env.SSL_PROVISIONER_BATCH_SIZE);

    logger.info('found SSL candidates', { count: candidates.length });

    for (const candidate of candidates) {
      await provisionAgent(db, cf, env, candidate.agent, candidate.cert);
    }
  } finally {
    await sqlClient.end();
  }
}

async function provisionAgent(
  db: Db,
  cf: CloudflareDnsClient,
  env: Env,
  agent: AgentRow,
  existingCert: SslCertificateRow | null,
): Promise<void> {
  const hadUsableCert = Boolean(existingCert?.notAfter && existingCert.notAfter > new Date());

  if (!hadUsableCert) {
    await db
      .update(agents)
      .set({ sslStatus: 'provisioning', updatedAt: new Date() })
      .where(eq(agents.id, agent.id));
  }

  try {
    logger.info('provisioning SSL certificate', { agentId: agent.id, domain: agent.domain });
    const zone = await cf.getZoneByName(agent.domain);
    if (!zone) throw new Error(`Cloudflare zone not found for ${agent.domain}`);

    const issuedAt = new Date();
    const result = await issueCertificate(cf, env, zone.id, agent.domain);
    const leafPem = acme.crypto.splitPemChain(result.certificatePem)[0] ?? result.certificatePem;
    const info = acme.crypto.readCertificateInfo(leafPem);
    const renewAfter = new Date(info.notAfter.getTime() - env.SSL_RENEW_BEFORE_DAYS * DAY_MS);
    const encryptedCertificate = encryptString(result.certificatePem, env.sslEncryptionKey);
    const encryptedPrivateKey = encryptString(result.privateKeyPem, env.sslEncryptionKey);

    await db
      .insert(sslCertificates)
      .values({
        agentId: agent.id,
        domains: result.domains,
        certificatePemEncrypted: encryptedCertificate,
        privateKeyPemEncrypted: encryptedPrivateKey,
        provider: 'letsencrypt',
        directoryUrl: env.ACME_DIRECTORY_URL,
        notBefore: info.notBefore,
        notAfter: info.notAfter,
        renewAfter,
        issuedAt,
        lastProvisionedAt: issuedAt,
        lastError: null,
        updatedAt: issuedAt,
      })
      .onConflictDoUpdate({
        target: sslCertificates.agentId,
        set: {
          domains: result.domains,
          certificatePemEncrypted: encryptedCertificate,
          privateKeyPemEncrypted: encryptedPrivateKey,
          provider: 'letsencrypt',
          directoryUrl: env.ACME_DIRECTORY_URL,
          notBefore: info.notBefore,
          notAfter: info.notAfter,
          renewAfter,
          issuedAt,
          lastProvisionedAt: issuedAt,
          lastError: null,
          updatedAt: issuedAt,
        },
      });

    await db
      .update(agents)
      .set({ sslStatus: 'active', updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    logger.info('SSL certificate provisioned', {
      agentId: agent.id,
      domain: agent.domain,
      notAfter: info.notAfter.toISOString(),
      renewAfter: renewAfter.toISOString(),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logger.error('SSL provisioning failed', { agentId: agent.id, domain: agent.domain, err });

    await db
      .update(sslCertificates)
      .set({ lastError: err, updatedAt: new Date() })
      .where(eq(sslCertificates.agentId, agent.id));

    await db
      .update(agents)
      .set({ sslStatus: hadUsableCert ? 'active' : 'failed', updatedAt: new Date() })
      .where(eq(agents.id, agent.id));
  }
}

async function issueCertificate(
  cf: CloudflareDnsClient,
  env: Env,
  zoneId: string,
  domain: string,
): Promise<{ certificatePem: string; privateKeyPem: string; domains: string[] }> {
  const domains = buildCertificateDomains(domain);
  const accountKey = normalizePem(env.ACME_ACCOUNT_PRIVATE_KEY);
  const client = new acme.Client({
    directoryUrl: env.ACME_DIRECTORY_URL,
    accountKey,
  });
  const [privateKey, csr] = await acme.crypto.createCsr({
    commonName: domain,
    altNames: domains,
  });

  const certificatePem = await client.auto({
    csr,
    email: env.ACME_CONTACT_EMAIL,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    preferredChain: env.ACME_PREFERRED_CHAIN,
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      await presentDnsChallenge(cf, env, zoneId, authz, challenge, keyAuthorization);
    },
    challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
      await cleanupDnsChallenge(cf, zoneId, authz, challenge, keyAuthorization);
    },
  });

  return {
    certificatePem,
    privateKeyPem: privateKey.toString('utf8'),
    domains,
  };
}

async function presentDnsChallenge(
  cf: CloudflareDnsClient,
  env: Env,
  zoneId: string,
  authz: AcmeAuthorization,
  challenge: AcmeChallenge,
  keyAuthorization: string,
): Promise<void> {
  if (challenge.type !== 'dns-01') {
    throw new Error(`Unsupported ACME challenge type: ${challenge.type}`);
  }

  await cf.presentAcmeDnsChallenge({
    zoneId,
    identifier: authz.identifier.value,
    keyAuthorization,
    ttl: 60,
  });
  await sleep(env.SSL_DNS_PROPAGATION_SECONDS * 1000);
}

async function cleanupDnsChallenge(
  cf: CloudflareDnsClient,
  zoneId: string,
  authz: AcmeAuthorization,
  challenge: AcmeChallenge,
  keyAuthorization: string,
): Promise<void> {
  if (challenge.type !== 'dns-01') return;

  await cf.cleanupAcmeDnsChallenge({
    zoneId,
    identifier: authz.identifier.value,
    keyAuthorization,
  });
}

function buildCertificateDomains(domain: string): string[] {
  const wwwDomain = domain.startsWith('www.') ? domain : `www.${domain}`;
  return Array.from(new Set([domain, wwwDomain]));
}

function normalizePem(value: string): string {
  return `${value.replace(/\\n/g, '\n').trim()}\n`;
}

function encryptString(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function encryptionKeyFromEnv(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');

  const maybeBase64 = trimmed.startsWith('base64:') ? trimmed.slice('base64:'.length) : trimmed;
  const decoded = Buffer.from(maybeBase64, 'base64');
  if (decoded.length === 32) return decoded;

  return createHash('sha256').update(trimmed).digest();
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseEnv(): Env {
  const directoryUrl =
    process.env.ACME_DIRECTORY_URL ??
    (process.env.NODE_ENV === 'production'
      ? acme.directory.letsencrypt.production
      : acme.directory.letsencrypt.staging);

  const required = {
    DATABASE_URL: process.env.DATABASE_URL,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    ACME_ACCOUNT_PRIVATE_KEY: process.env.ACME_ACCOUNT_PRIVATE_KEY,
    ACME_CONTACT_EMAIL: process.env.ACME_CONTACT_EMAIL,
    SSL_CERT_ENCRYPTION_KEY: process.env.SSL_CERT_ENCRYPTION_KEY,
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`${key} required`);
  }

  return {
    DATABASE_URL: required.DATABASE_URL!,
    CLOUDFLARE_API_TOKEN: required.CLOUDFLARE_API_TOKEN!,
    ACME_ACCOUNT_PRIVATE_KEY: required.ACME_ACCOUNT_PRIVATE_KEY!,
    ACME_CONTACT_EMAIL: required.ACME_CONTACT_EMAIL!,
    ACME_DIRECTORY_URL: directoryUrl,
    ACME_PREFERRED_CHAIN: process.env.ACME_PREFERRED_CHAIN,
    SSL_CERT_ENCRYPTION_KEY: required.SSL_CERT_ENCRYPTION_KEY!,
    sslEncryptionKey: encryptionKeyFromEnv(required.SSL_CERT_ENCRYPTION_KEY!),
    SSL_RENEW_BEFORE_DAYS: parsePositiveInt('SSL_RENEW_BEFORE_DAYS', 30),
    SSL_DNS_PROPAGATION_SECONDS: parsePositiveInt('SSL_DNS_PROPAGATION_SECONDS', 30),
    SSL_PROVISIONER_BATCH_SIZE: parsePositiveInt('SSL_PROVISIONER_BATCH_SIZE', 10),
    SSL_PROVISIONER_TICK_INTERVAL_SECONDS: parsePositiveInt(
      'SSL_PROVISIONER_TICK_INTERVAL_SECONDS',
      300,
    ),
  };
}

interface Env {
  DATABASE_URL: string;
  CLOUDFLARE_API_TOKEN: string;
  ACME_ACCOUNT_PRIVATE_KEY: string;
  ACME_CONTACT_EMAIL: string;
  ACME_DIRECTORY_URL: string;
  ACME_PREFERRED_CHAIN?: string;
  SSL_CERT_ENCRYPTION_KEY: string;
  sslEncryptionKey: Buffer;
  SSL_RENEW_BEFORE_DAYS: number;
  SSL_DNS_PROPAGATION_SECONDS: number;
  SSL_PROVISIONER_BATCH_SIZE: number;
  SSL_PROVISIONER_TICK_INTERVAL_SECONDS: number;
}

main().catch((e) => {
  logger.error('fatal', { err: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
