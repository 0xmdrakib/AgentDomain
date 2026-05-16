import { z } from 'zod';
import type { Address } from 'viem';

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
  emailEnabled: z.boolean().default(false),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
  dnsTarget: z.string().optional(),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      imageUri: z.string().optional(),
      framework: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      x402Endpoint: z.string().optional(),
      socials: z.record(z.string()).optional(),
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
