import { z } from 'zod';
import { AGENT_IDENTITY_REGISTRY_BASE, AGENT_RENEWAL_VAULT_BASE } from '@agentdomain/sdk';

const decimal = z.string().regex(/^\d+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const block = z
  .object({
    number: decimal,
    timestamp: decimal,
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    tag: z.literal('safe'),
  })
  .passthrough();
const snapshot = z.object({
  version: z.literal(1),
  chainId: z.literal(8453),
  registryAddress: address.refine(
    (value) => value.toLowerCase() === AGENT_IDENTITY_REGISTRY_BASE.toLowerCase(),
  ),
  input: z
    .object({
      domain: z.string().optional(),
      tokenId: decimal.optional(),
      expectedOwner: address.optional(),
    })
    .refine((value) => (value.domain !== undefined) !== (value.tokenId !== undefined)),
  block,
});
const foundIdentity = snapshot
  .extend({
    status: z.literal('found'),
    tokenId: decimal,
    identity: z
      .object({
        owner: address,
        domain: z.string(),
        basename: z.string(),
        ensName: z.string(),
        metadataUri: z.string(),
        createdAt: decimal,
        expiresAt: decimal,
        revoked: z.boolean(),
      })
      .passthrough(),
    nftOwner: address,
    metadataUri: z.string(),
    lifecycle: z.enum(['active', 'expired', 'revoked']),
    checks: z
      .object({
        ownerConsistent: z.boolean(),
        domainConsistent: z.boolean(),
        metadataConsistent: z.boolean(),
        lifecycleConsistent: z.boolean(),
        expectedOwnerMatches: z.boolean().nullable(),
      })
      .passthrough(),
    consistent: z.boolean(),
  })
  .passthrough();
const missingIdentity = snapshot
  .extend({ status: z.literal('not_found'), tokenId: decimal.nullable() })
  .passthrough();
export const identityCheckResponseSchema = z.discriminatedUnion('status', [
  foundIdentity,
  missingIdentity,
]);

const renewal = z.object({
  version: z.literal(1),
  chainId: z.literal(8453),
  vaultAddress: address.refine(
    (value) => value.toLowerCase() === AGENT_RENEWAL_VAULT_BASE.toLowerCase(),
  ),
});
export const renewalCheckResponseSchema = z.discriminatedUnion('status', [
  renewal.extend({ status: z.literal('not_found'), identity: missingIdentity }).passthrough(),
  renewal
    .extend({
      status: z.literal('found'),
      identity: foundIdentity,
      vault: z
        .object({
          availableAtomicUsdc: decimal,
          reservedAtomicUsdc: decimal,
          minimumFeeAtomicUsdc: decimal,
          autoRenewEnabled: z.boolean(),
          pendingRenewal: z
            .object({ amountAtomicUsdc: decimal, expiresAt: decimal, reservedAt: decimal })
            .passthrough()
            .nullable(),
          renewalWindowSeconds: decimal,
          renewalDurationSeconds: decimal,
          lastRenewedAt: decimal,
          isRenewable: z.boolean(),
          nft: address,
          registry: address,
          usdc: address,
        })
        .passthrough(),
      checks: z
        .object({
          identityConsistent: z.boolean(),
          canonicalContracts: z.boolean(),
          parametersConsistent: z.boolean(),
          reservationConsistent: z.boolean(),
          lifecycleConsistent: z.boolean(),
          withinRenewalWindow: z.boolean(),
          minimumFeeConfigured: z.boolean(),
          availableCoversMinimum: z.boolean(),
        })
        .passthrough(),
      consistent: z.boolean(),
      renewalExecution: z.literal('keeper_registrar_confirmation_required'),
    })
    .passthrough(),
]);
