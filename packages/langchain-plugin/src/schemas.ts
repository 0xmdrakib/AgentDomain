import { z } from 'zod';

const domain = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .describe('Full ASCII DNS domain, not a URL. Provide either domain or tokenId.');
const tokenId = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,77}$/)
  .describe('Positive uint256 decimal string without leading zeros. Never a JSON number.');
const expectedOwner = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .describe('Optional expected owner address. This is a comparison, not authentication.');

// Keep an object schema for model-provider compatibility. The SDK enforces the
// exclusive query, DNS labels, uint256 range, and address checksum before RPC.
export const identityInspectionSchema = z
  .object({
    domain: domain.optional(),
    tokenId: tokenId.optional(),
    expectedOwner: expectedOwner.optional(),
  })
  .strict();

export const agentLookupSchema = z.object({ agentId: z.string().uuid() }).strict();
export const registrationStatusSchema = z.object({ registrationId: z.string().uuid() }).strict();

export const autoRenewChangeSchema = z
  .object({
    tokenId,
    expectedOwner: expectedOwner.describe('Owner that must match the fresh onchain observation.'),
    enabled: z.boolean().describe('Requested auto-renew setting, not approval to execute.'),
    builderCode: z
      .string()
      .regex(/^[a-z0-9_]{1,32}$/)
      .describe('Public ERC-8021 attribution code; not a credential.'),
  })
  .strict();
