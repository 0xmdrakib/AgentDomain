import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  getAddress,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';

/** Canonical deployment recorded in contracts/deployments/base-mainnet.json. */
export const AGENT_IDENTITY_REGISTRY_BASE = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15' as const;

export const IDENTITY_INSPECTION_ABI = parseAbi([
  'error TokenDoesNotExist(uint256 tokenId)',
  'function getTokenIdByDomain(string domain) view returns (uint256)',
  'function getIdentity(uint256 tokenId) view returns ((address owner, string domain, string basename, string ensName, string metadataUri, uint64 createdAt, uint64 expiresAt, bool revoked) identity)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isActive(uint256 tokenId) view returns (bool)',
]);

export type IdentityInspectionInput = (
  { domain: string; tokenId?: never } | { tokenId: string; domain?: never }
) & { expectedOwner?: string };

export type IdentityInspectionErrorCode =
  'INVALID_INPUT' | 'WRONG_CHAIN' | 'UNSAFE_SNAPSHOT' | 'UNAVAILABLE';

export class IdentityInspectionError extends Error {
  override readonly name = 'IdentityInspectionError';
  constructor(
    readonly code: IdentityInspectionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface InspectionSnapshot {
  version: 1;
  chainId: 8453;
  registryAddress: typeof AGENT_IDENTITY_REGISTRY_BASE;
  input: IdentityInspectionInput;
  block: { number: string; hash: Hex; timestamp: string; tag: 'safe' };
}

export interface FoundAgentIdentity extends InspectionSnapshot {
  status: 'found';
  tokenId: string;
  identity: {
    owner: Address;
    domain: string;
    basename: string;
    ensName: string;
    metadataUri: string;
    createdAt: string;
    expiresAt: string;
    revoked: boolean;
  };
  nftOwner: Address;
  metadataUri: string;
  lifecycle: 'active' | 'expired' | 'revoked';
  checks: {
    ownerConsistent: boolean;
    domainConsistent: boolean;
    metadataConsistent: boolean;
    lifecycleConsistent: boolean;
    expectedOwnerMatches: boolean | null;
  };
  /** Internal consistency only; not a verdict about the optional expected owner. */
  consistent: boolean;
}

export interface MissingAgentIdentity extends InspectionSnapshot {
  status: 'not_found';
  tokenId: string | null;
}

export type IdentityInspectionResult = FoundAgentIdentity | MissingAgentIdentity;

export type IdentityInspectionPublicClient = Pick<
  PublicClient,
  'getChainId' | 'readContract' | 'multicall' | 'ccipRead'
> & {
  getBlock(args: { blockTag: 'safe' } | { blockNumber: bigint }): Promise<{
    number: bigint | null;
    hash: Hex | null;
    timestamp: bigint;
  }>;
};

export interface IdentityInspectionOptions {
  /** A trusted Base RPC client with ccipRead: false; no wallet or signing capability is used. */
  publicClient?: IdentityInspectionPublicClient;
}

function invalidInput(message: string): never {
  throw new IdentityInspectionError('INVALID_INPUT', message);
}

function normalizeInput(input: IdentityInspectionInput): IdentityInspectionInput {
  if (!input || typeof input !== 'object') invalidInput('Provide a domain or token ID.');
  const hasDomain = input.domain !== undefined;
  const hasToken = input.tokenId !== undefined;
  if (hasDomain === hasToken) invalidInput('Provide exactly one domain or token ID.');
  let expectedOwner: Address | undefined;
  if (input.expectedOwner !== undefined) {
    if (typeof input.expectedOwner !== 'string' || !isAddress(input.expectedOwner.trim())) {
      invalidInput('Expected owner must be a valid Ethereum address.');
    }
    expectedOwner = getAddress(input.expectedOwner.trim());
  }
  const owner = expectedOwner ? { expectedOwner } : {};
  if (hasDomain) {
    if (typeof input.domain !== 'string') invalidInput('Domain must be a string.');
    const domain = input.domain.trim().toLowerCase();
    if (domain.length > 253) invalidInput('Domain cannot exceed 253 characters.');
    const labels = domain.split('.');
    if (
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ) {
      invalidInput('Enter a full ASCII domain without a URL, path, or trailing dot.');
    }
    return { domain, ...owner };
  }
  if (typeof input.tokenId !== 'string') invalidInput('Token ID must be a decimal string.');
  const tokenId = input.tokenId.trim();
  if (!/^[1-9][0-9]{0,77}$/.test(tokenId) || BigInt(tokenId) > maxUint256) {
    invalidInput('Token ID must be a positive uint256 decimal without leading zeros.');
  }
  return { tokenId, ...owner };
}

function isMissingToken(error: unknown, tokenId: bigint): boolean {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return (
    revert instanceof ContractFunctionRevertedError &&
    revert.data?.errorName === 'TokenDoesNotExist' &&
    revert.data.args?.[0] === tokenId
  );
}

/**
 * Inspect the canonical AgentDomain ERC-721 identity at one RPC-reported safe block.
 * This is an RPC-backed observation, not a consensus proof, DNS-control check, KYC,
 * or agent-behavior endorsement. Linked names and metadata availability are not verified.
 * The default public RPC is rate limited; production callers should inject a trusted client.
 */
export async function inspectAgentIdentity(
  input: IdentityInspectionInput,
  options: IdentityInspectionOptions = {},
): Promise<IdentityInspectionResult> {
  const normalized = normalizeInput(input);
  const client =
    options.publicClient ??
    createPublicClient({
      chain: base,
      ccipRead: false,
      transport: http('https://mainnet.base.org', { timeout: 8_000, retryCount: 0 }),
    });
  if (client.ccipRead !== false) {
    invalidInput('The inspection RPC client must disable CCIP read (ccipRead: false).');
  }
  try {
    if ((await client.getChainId()) !== base.id) {
      throw new IdentityInspectionError(
        'WRONG_CHAIN',
        'Identity inspection requires Base mainnet.',
      );
    }
    const block = await client.getBlock({ blockTag: 'safe' });
    if (block.number === null || !block.hash) {
      throw new IdentityInspectionError('UNSAFE_SNAPSHOT', 'The RPC did not return a safe block.');
    }
    const snapshot: InspectionSnapshot = {
      version: 1,
      chainId: base.id,
      registryAddress: AGENT_IDENTITY_REGISTRY_BASE,
      input: normalized,
      block: {
        number: block.number.toString(),
        hash: block.hash,
        timestamp: block.timestamp.toString(),
        tag: 'safe',
      },
    };
    const contract = {
      address: AGENT_IDENTITY_REGISTRY_BASE,
      abi: IDENTITY_INSPECTION_ABI,
    } as const;
    const anchor = { blockHash: block.hash, requireCanonical: true } as const;
    const atBlock = { ...contract, ...anchor };
    // Resolve safe once; never mix moving tags or silently fall back to latest.
    async function finish(result: IdentityInspectionResult): Promise<IdentityInspectionResult> {
      const checked = await client.getBlock({ blockNumber: BigInt(snapshot.block.number) });
      if (
        checked.number !== block.number ||
        checked.hash !== snapshot.block.hash ||
        checked.timestamp !== block.timestamp
      ) {
        throw new IdentityInspectionError(
          'UNSAFE_SNAPSHOT',
          'The inspected block changed. Run a fresh inspection.',
        );
      }
      if ((await client.getChainId()) !== base.id) {
        throw new IdentityInspectionError(
          'WRONG_CHAIN',
          'The RPC network changed during inspection.',
        );
      }
      return result;
    }
    const tokenId =
      normalized.domain !== undefined
        ? await client.readContract({
            ...atBlock,
            functionName: 'getTokenIdByDomain',
            args: [normalized.domain],
          })
        : BigInt(normalized.tokenId);
    if (tokenId === 0n) return await finish({ ...snapshot, status: 'not_found', tokenId: null });
    const identity = await client
      .readContract({ ...atBlock, functionName: 'getIdentity', args: [tokenId] })
      .catch((error: unknown) => {
        // Only this exact decoded revert establishes absence; transport failures do not.
        if (isMissingToken(error, tokenId)) return null;
        throw error;
      });
    if (!identity) {
      if (normalized.domain !== undefined) {
        throw new IdentityInspectionError(
          'UNAVAILABLE',
          'The registry returned conflicting records.',
        );
      }
      return await finish({ ...snapshot, status: 'not_found', tokenId: tokenId.toString() });
    }
    const [nftOwner, metadataUri, mappedTokenId, active] = await client.multicall({
      ...anchor,
      allowFailure: false,
      batchSize: 4096,
      multicallAddress: base.contracts.multicall3.address,
      contracts: [
        { ...contract, functionName: 'ownerOf', args: [tokenId] },
        { ...contract, functionName: 'tokenURI', args: [tokenId] },
        { ...contract, functionName: 'getTokenIdByDomain', args: [identity.domain] },
        { ...contract, functionName: 'isActive', args: [tokenId] },
      ],
    });
    const owner = getAddress(identity.owner);
    const canonicalNftOwner = getAddress(nftOwner);
    const lifecycle = identity.revoked
      ? 'revoked'
      : block.timestamp >= identity.expiresAt
        ? 'expired'
        : 'active';
    const checks = {
      ownerConsistent: owner !== zeroAddress && owner === canonicalNftOwner,
      domainConsistent:
        mappedTokenId === tokenId &&
        (normalized.domain === undefined || normalized.domain === identity.domain),
      metadataConsistent: metadataUri === identity.metadataUri,
      lifecycleConsistent:
        active === (lifecycle === 'active') &&
        identity.createdAt <= block.timestamp &&
        identity.expiresAt >= identity.createdAt,
      expectedOwnerMatches: normalized.expectedOwner
        ? canonicalNftOwner === normalized.expectedOwner
        : null,
    };
    return await finish({
      ...snapshot,
      status: 'found',
      tokenId: tokenId.toString(),
      identity: {
        ...identity,
        owner,
        createdAt: identity.createdAt.toString(),
        expiresAt: identity.expiresAt.toString(),
      },
      nftOwner: canonicalNftOwner,
      metadataUri,
      lifecycle,
      checks,
      consistent:
        checks.ownerConsistent &&
        checks.domainConsistent &&
        checks.metadataConsistent &&
        checks.lifecycleConsistent,
    });
  } catch (error) {
    if (error instanceof IdentityInspectionError) throw error;
    // Provider errors may contain credential-bearing RPC URLs; do not expose them.
    throw new IdentityInspectionError(
      'UNAVAILABLE',
      'Base RPC inspection is unavailable. No identity verdict was produced.',
    );
  }
}
