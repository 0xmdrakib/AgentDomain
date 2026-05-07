import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const agentStatusEnum = pgEnum('agent_status', ['pending', 'active', 'expired', 'revoked']);
export const sslStatusEnum = pgEnum('ssl_status', [
  'pending',
  'provisioning',
  'active',
  'failed',
  'expired',
]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey(),
  agentIdNft: integer('agent_id_nft').notNull(),
  domain: varchar('domain', { length: 253 }).notNull(),
  status: agentStatusEnum('status').notNull(),
  sslStatus: sslStatusEnum('ssl_status').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const sslCertificates = pgTable(
  'ssl_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull(),
    domains: jsonb('domains').$type<string[]>().notNull(),
    certificatePemEncrypted: text('certificate_pem_encrypted').notNull(),
    privateKeyPemEncrypted: text('private_key_pem_encrypted').notNull(),
    provider: varchar('provider', { length: 50 }).notNull().default('letsencrypt'),
    directoryUrl: text('directory_url').notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
    notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
    renewAfter: timestamp('renew_after', { withTimezone: true }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    lastProvisionedAt: timestamp('last_provisioned_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentUniq: uniqueIndex('ssl_certificates_agent_uniq').on(t.agentId),
    renewAfterIdx: index('ssl_certificates_renew_after_idx').on(t.renewAfter),
    notAfterIdx: index('ssl_certificates_not_after_idx').on(t.notAfter),
  }),
);

export type AgentRow = typeof agents.$inferSelect;
export type SslCertificateRow = typeof sslCertificates.$inferSelect;
