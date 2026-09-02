import { z } from 'zod';
import { dnsRecordObjectSchema, type DnsRecordData } from '@agentdomain/shared';

const nullableText = z.string().nullable();
const isoDate = z.string().datetime({ offset: true });
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  });

export const publicAgentSchema = z
  .object({
    id: z.string().uuid(),
    domain: z.string(),
    basename: nullableText,
    ensName: nullableText,
    ownerAddress: address,
    agentIdNft: z.number().int().nonnegative(),
    status: z.enum(['pending', 'active', 'expired', 'revoked']),
    framework: nullableText,
    sslStatus: z.enum(['pending', 'provisioning', 'active', 'failed', 'expired']),
    createdAt: isoDate,
    expiresAt: isoDate.nullable(),
    displayName: z.string(),
    description: nullableText,
    capabilities: z.array(z.string()),
  })
  .strict();

export const publicAgentResponseSchema = z
  .object({
    agent: publicAgentSchema,
    seo: z
      .object({
        description: nullableText,
        canonical: httpsUrl,
        indexable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const publicRegistrySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().uuid(),
          domain: z.string(),
          basename: nullableText,
          ensName: nullableText,
          walletAddress: address,
          framework: nullableText,
          description: nullableText,
          capabilities: z.array(z.string()),
          x402Endpoint: nullableText,
          supportTier: nullableText,
          createdAt: isoDate,
        })
        .strict(),
    ),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

export const emailInboxViewSchema = z
  .object({
    id: z.string(),
    agentId: z.string().uuid(),
    emailAddress: z.string(),
    verificationStatus: z.string(),
    dkimConfigured: z.boolean(),
    spfConfigured: z.boolean(),
    dmarcConfigured: z.boolean(),
    createdAt: isoDate,
  })
  .strict();

export interface EmailAddressView {
  id: string;
  agentId: string;
  emailAddress: string;
  kind: 'primary' | 'alias';
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
}

const dnsDataSchema: z.ZodType<DnsRecordData> = z.union([
  z.object({ address: z.string() }).strict(),
  z.object({ target: z.string() }).strict(),
  z
    .object({
      flag: z.union([z.literal(0), z.literal(128)]),
      tag: z.enum(['issue', 'issuewild', 'iodef']),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      priority: z.number(),
      target: z.string(),
      params: z.array(z.object({ key: z.string(), value: z.string().optional() }).strict()),
    })
    .strict(),
  z.object({ priority: z.number(), exchange: z.string() }).strict(),
  z.object({ nameserver: z.string() }).strict(),
  z.object({ pointer: z.string() }).strict(),
  z
    .object({ priority: z.number(), weight: z.number(), port: z.number(), target: z.string() })
    .strict(),
  z
    .object({
      usage: z.number(),
      selector: z.number(),
      matchingType: z.number(),
      associationData: z.string(),
    })
    .strict(),
  z.object({ text: z.string() }).strict(),
]);

export const dnsRecordViewSchema = dnsRecordObjectSchema
  .extend({
    id: z.string(),
    value: z.string(),
    data: dnsDataSchema.nullable().optional(),
    ttl: z.number(),
    systemManaged: z.boolean().optional(),
    purpose: nullableText.optional(),
  })
  .strict();

export const managementViewSchema = z
  .object({
    agent: z
      .object({
        id: z.string().uuid(),
        walletAddress: address,
        metadataUri: z
          .string()
          .refine((value) => {
            try {
              const url = new URL(value);
              return ['https:', 'ipfs:'].includes(url.protocol) && !url.username && !url.password;
            } catch {
              return false;
            }
          })
          .nullable(),
      })
      .strict(),
    dns: z.array(dnsRecordViewSchema),
    inbox: emailInboxViewSchema.nullable(),
    publicConfig: z
      .object({
        usdc: address,
        renewalVault: address.nullable(),
        metadataGateway: httpsUrl,
        builderCode: nullableText,
      })
      .strict(),
  })
  .strict();

export type PublicAgentView = z.infer<typeof publicAgentSchema>;
export type PublicAgentResponse = z.infer<typeof publicAgentResponseSchema>;
export type PublicRegistry = z.infer<typeof publicRegistrySchema>;
export type EmailInboxView = z.infer<typeof emailInboxViewSchema>;
export type ManagementView = z.infer<typeof managementViewSchema>;
export type DnsRecordView = z.infer<typeof dnsRecordViewSchema>;
