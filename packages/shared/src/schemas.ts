import { z } from 'zod';
import { SERVICE_PLAN_KEYS } from './constants.js';
import type { Address } from 'viem';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalMetadataString = (maxLength: number) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(maxLength).optional());

const optionalMetadataUrl = (maxLength: number) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().url().max(maxLength).optional());

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((v) => v as Address);

export const domainLabelSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    'Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens',
  );

export const emailUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers, dot, underscore, plus, or hyphen',
  )
  .refine((value) => !value.includes('..'), 'Email username cannot contain consecutive dots');

export const tldSchema = z.enum([
  'xyz',
  'com',
  'ai',
  'org',
  'io',
  'net',
  'co',
  'app',
]);

export const registrationParamsSchema = z.object({
  preferredName: domainLabelSchema,
  tld: tldSchema,
  registerBasename: z.boolean().default(true),
  basenameLabel: domainLabelSchema.optional(),
  registerEns: z.boolean().default(false),
  ensLabel: domainLabelSchema.optional(),
  ownerAddress: addressSchema.optional(),
  emailEnabled: z.boolean().default(true),
  emailUsername: emailUsernameSchema.default('agent'),
  premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
  dnsTarget: z.string().optional(),
  metadata: z
    .object({
      name: optionalMetadataString(120),
      description: optionalMetadataString(1000),
      imageUri: optionalMetadataUrl(2048),
      framework: optionalMetadataString(80),
      capabilities: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
      x402Endpoint: optionalMetadataUrl(2048),
      socials: z.record(z.string().trim().max(2048)).optional(),
    })
    .optional(),
  wallet: addressSchema,
  turnstileToken: z.string().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  framework: z.string().optional(),
  capability: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const dnsRecordSchema = z.object({
  type: z.enum(['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']),
  name: z.string().min(1).max(253),
  value: z.string().min(1).max(4096),
  ttl: z.number().int().min(60).max(3600).default(3600).optional(),
  priority: z.number().int().min(0).optional(),
});
