/**
 * Slim copy of the relevant subset of the web app's Drizzle schema.
 * In production we'd extract this into a shared package; for now duplication
 * is fine and avoids cross-package coupling.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const agentStatusEnum = pgEnum('agent_status', ['pending', 'active', 'expired', 'revoked']);
export const renewalStatusEnum = pgEnum('renewal_status', [
  'scheduled',
  'in_progress',
  'completed',
  'failed',
]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey(),
  walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
  agentIdNft: integer('agent_id_nft').notNull(),
  domain: varchar('domain', { length: 253 }).notNull(),
  status: agentStatusEnum('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const renewals = pgTable('renewals', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
  status: renewalStatusEnum('status').notNull().default('scheduled'),
  txHash: varchar('tx_hash', { length: 66 }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
