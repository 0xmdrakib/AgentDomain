import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS
// ============================================================

export const agentStatusEnum = pgEnum('agent_status', ['pending', 'active', 'expired', 'revoked']);
export const registrationStatusEnum = pgEnum('registration_status', [
  'pending',
  'completed',
  'failed',
]);
export const renewalStatusEnum = pgEnum('renewal_status', [
  'scheduled',
  'in_progress',
  'completed',
  'failed',
]);
export const dnsRecordTypeEnum = pgEnum('dns_record_type', [
  'A',
  'AAAA',
  'ALIAS',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
]);
export const sslStatusEnum = pgEnum('ssl_status', [
  'pending',
  'provisioning',
  'active',
  'failed',
  'expired',
]);

// ============================================================
// AGENTS - the core identity table
// ============================================================

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
    ownerAddress: varchar('owner_address', { length: 42 }).notNull().default(''), // Web3 Owner
    agentIdNft: integer('agent_id_nft').notNull(), // ERC-721 token ID
    domain: varchar('domain', { length: 253 }).notNull(),
    basename: varchar('basename', { length: 255 }),
    ensName: varchar('ens_name', { length: 255 }),
    status: agentStatusEnum('status').notNull().default('pending'),
    metadataUri: varchar('metadata_uri', { length: 500 }),
    metadataJson: jsonb('metadata_json'),
    sslStatus: sslStatusEnum('ssl_status').notNull().default('pending'),
    dnsTarget: varchar('dns_target', { length: 500 }),
    framework: varchar('framework', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    walletIdx: index('agents_wallet_idx').on(t.walletAddress),
    ownerIdx: index('agents_owner_idx').on(t.ownerAddress),
    domainUniq: uniqueIndex('agents_domain_uniq').on(t.domain),
    nftUniq: uniqueIndex('agents_nft_uniq').on(t.agentIdNft),
    statusIdx: index('agents_status_idx').on(t.status),
    frameworkIdx: index('agents_framework_idx').on(t.framework),
  }),
);

// ============================================================
// REGISTRATIONS - audit log of every registration attempt
// ============================================================

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    txHash: varchar('tx_hash', { length: 66 }),
    payerAddress: varchar('payer_address', { length: 42 }).notNull(),
    paymentAmount: numeric('payment_amount', { precision: 18, scale: 6 }).notNull(),
    domainCost: numeric('domain_cost', { precision: 18, scale: 6 }).notNull(),
    basenameCost: numeric('basename_cost', { precision: 18, scale: 6 }).notNull().default('0'),
    ensCost: numeric('ens_cost', { precision: 18, scale: 6 }).notNull().default('0'),
    serviceFee: numeric('service_fee', { precision: 18, scale: 6 }).notNull(),
    status: registrationStatusEnum('status').notNull().default('pending'),
    registrarOrderId: varchar('registrar_order_id', { length: 100 }),
    errorMessage: text('error_message'),
    requestParams: jsonb('request_params'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('registrations_idempotency_uniq').on(t.idempotencyKey),
    agentIdx: index('registrations_agent_idx').on(t.agentId),
    statusIdx: index('registrations_status_idx').on(t.status),
  }),
);

// ============================================================
// DNS RECORDS - the DNS state for each agent's domain
// ============================================================

export const dnsRecords = pgTable(
  'dns_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    type: dnsRecordTypeEnum('type').notNull(),
    name: varchar('name', { length: 253 }).notNull(),
    value: text('value').notNull(),
    ttl: integer('ttl').notNull().default(3600),
    priority: integer('priority'),
    providerRecordId: varchar('provider_record_id', { length: 160 }),
    provider: varchar('provider', { length: 40 }).notNull().default('spaceship'),
    systemManaged: boolean('system_managed').notNull().default(false),
    purpose: varchar('purpose', { length: 80 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('dns_agent_idx').on(t.agentId),
  }),
);

// ============================================================
// SSL HOSTNAMES - Cloudflare for SaaS custom hostname state
// ============================================================

export const sslHostnames = pgTable(
  'ssl_hostnames',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    hostname: varchar('hostname', { length: 253 }).notNull(),
    cloudflareCustomHostnameId: varchar('cloudflare_custom_hostname_id', { length: 100 }).notNull(),
    hostnameStatus: varchar('hostname_status', { length: 50 }).notNull().default('pending'),
    sslStatus: varchar('ssl_status', { length: 50 }).notNull().default('pending'),
    validationRecords: jsonb('validation_records').$type<Record<string, unknown>[]>(),
    validationErrors: jsonb('validation_errors').$type<Record<string, unknown>[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
  },
  (t) => ({
    agentUniq: uniqueIndex('ssl_hostnames_agent_uniq').on(t.agentId),
    hostnameUniq: uniqueIndex('ssl_hostnames_hostname_uniq').on(t.hostname),
    statusIdx: index('ssl_hostnames_status_idx').on(t.hostnameStatus, t.sslStatus),
  }),
);

// ============================================================
// EMAIL INBOXES
// ============================================================

export const emailInboxes = pgTable(
  'email_inboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    emailAddress: varchar('email_address', { length: 255 }).notNull(),
    sesIdentityArn: varchar('ses_identity_arn', { length: 255 }),
    sesVerificationStatus: varchar('ses_verification_status', { length: 50 }).notNull().default('pending'),
    sesMailFromDomain: varchar('ses_mail_from_domain', { length: 255 }),
    dkimConfigured: boolean('dkim_configured').notNull().default(false),
    spfConfigured: boolean('spf_configured').notNull().default(false),
    dmarcConfigured: boolean('dmarc_configured').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: uniqueIndex('email_agent_uniq').on(t.agentId),
    emailUniq: uniqueIndex('email_address_uniq').on(t.emailAddress),
  }),
);

// ============================================================
// EMAIL MESSAGES (incoming)
// ============================================================

export const emailMessages = pgTable(
  'email_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboxId: uuid('inbox_id')
      .notNull()
      .references(() => emailInboxes.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 10 }).notNull().default('inbound'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    fromAddress: varchar('from_address', { length: 255 }).notNull(),
    toAddress: varchar('to_address', { length: 255 }),
    subject: text('subject'),
    text: text('text'),
    verificationCodes: jsonb('verification_codes').$type<string[]>(),
    spamVerdict: varchar('spam_verdict', { length: 20 }),
    virusVerdict: varchar('virus_verdict', { length: 20 }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    read: boolean('read').notNull().default(false),
  },
  (t) => ({
    inboxIdx: index('email_msg_inbox_idx').on(t.inboxId),
    receivedIdx: index('email_msg_received_idx').on(t.receivedAt),
    providerMessageUniq: uniqueIndex('email_msg_provider_message_uniq').on(t.providerMessageId),
  }),
);

export const emailBlocklist = pgTable(
  'email_blocklist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboxId: uuid('inbox_id')
      .notNull()
      .references(() => emailInboxes.id, { onDelete: 'cascade' }),
    value: varchar('value', { length: 255 }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inboxIdx: index('email_blocklist_inbox_idx').on(t.inboxId),
    valueUniq: uniqueIndex('email_blocklist_inbox_value_uniq').on(t.inboxId, t.value),
  }),
);

// ============================================================
// RENEWALS - scheduled renewal jobs
// ============================================================

export const renewals = pgTable(
  'renewals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
    status: renewalStatusEnum('status').notNull().default('scheduled'),
    txHash: varchar('tx_hash', { length: 66 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    agentIdx: index('renewals_agent_idx').on(t.agentId),
    scheduledIdx: index('renewals_scheduled_idx').on(t.scheduledFor),
    statusIdx: index('renewals_status_idx').on(t.status),
  }),
);

// ============================================================
// REPUTATION EVENTS (v2 - schema-ready)
// ============================================================

export const reputationEvents = pgTable(
  'reputation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    scoreDelta: integer('score_delta').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('rep_agent_idx').on(t.agentId),
    typeIdx: index('rep_type_idx').on(t.eventType),
  }),
);

// ============================================================
// DISCOUNT CODES
// ============================================================

export const discountCodes = pgTable(
  'discount_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull(),
    usageLimit: integer('usage_limit').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    discountPercent: integer('discount_percent').notNull().default(90),
    appliesTo: varchar('applies_to', { length: 50 }).notNull().default('service_fee'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: varchar('created_by', { length: 42 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    codeUniq: uniqueIndex('discount_codes_code_uniq').on(t.code),
  }),
);

// ============================================================
// API KEYS (for human dashboard users)
// ============================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
    email: varchar('email', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    walletUniq: uniqueIndex('users_wallet_uniq').on(t.walletAddress),
  }),
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyHash: varchar('key_hash', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('apikeys_user_idx').on(t.userId),
    keyUniq: uniqueIndex('apikeys_hash_uniq').on(t.keyHash),
  }),
);

// ============================================================
// RELATIONS
// ============================================================

export const agentsRelations = relations(agents, ({ many, one }) => ({
  registrations: many(registrations),
  dnsRecords: many(dnsRecords),
  sslHostname: one(sslHostnames, {
    fields: [agents.id],
    references: [sslHostnames.agentId],
  }),
  emailInbox: one(emailInboxes, { fields: [agents.id], references: [emailInboxes.agentId] }),
  renewals: many(renewals),
  reputationEvents: many(reputationEvents),
}));

export const registrationsRelations = relations(registrations, ({ one }) => ({
  agent: one(agents, { fields: [registrations.agentId], references: [agents.id] }),
}));

export const dnsRecordsRelations = relations(dnsRecords, ({ one }) => ({
  agent: one(agents, { fields: [dnsRecords.agentId], references: [agents.id] }),
}));

export const sslHostnamesRelations = relations(sslHostnames, ({ one }) => ({
  agent: one(agents, { fields: [sslHostnames.agentId], references: [agents.id] }),
}));

export const emailInboxesRelations = relations(emailInboxes, ({ one, many }) => ({
  agent: one(agents, { fields: [emailInboxes.agentId], references: [agents.id] }),
  messages: many(emailMessages),
  blocklist: many(emailBlocklist),
}));

export const emailMessagesRelations = relations(emailMessages, ({ one }) => ({
  inbox: one(emailInboxes, { fields: [emailMessages.inboxId], references: [emailInboxes.id] }),
}));

export const emailBlocklistRelations = relations(emailBlocklist, ({ one }) => ({
  inbox: one(emailInboxes, { fields: [emailBlocklist.inboxId], references: [emailInboxes.id] }),
}));

export const renewalsRelations = relations(renewals, ({ one }) => ({
  agent: one(agents, { fields: [renewals.agentId], references: [agents.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

// Types
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Registration = typeof registrations.$inferSelect;
export type NewRegistration = typeof registrations.$inferInsert;
export type DnsRecordRow = typeof dnsRecords.$inferSelect;
export type NewDnsRecord = typeof dnsRecords.$inferInsert;
export type SslHostnameRow = typeof sslHostnames.$inferSelect;
export type EmailInboxRow = typeof emailInboxes.$inferSelect;
export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type Renewal = typeof renewals.$inferSelect;
export type DiscountCode = typeof discountCodes.$inferSelect;
