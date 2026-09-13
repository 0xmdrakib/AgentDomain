import {
  BaseError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  keccak256,
  maxUint256,
  parseAbi,
  stringToHex,
  type Address,
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { base } from 'viem/chains';
import { z } from 'zod';
import {
  AGENT_IDENTITY_REGISTRY_BASE,
  IdentityInspectionError,
  inspectAgentIdentity,
  type FoundAgentIdentity,
  type IdentityInspectionInput,
  type MissingAgentIdentity,
} from './identity-inspection.js';
import { encodeSetAutoRenewCalldata, validateBuilderCode } from './index.js';

export const AGENT_RENEWAL_VAULT_BASE = getAddress('0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a');
export const AGENT_RENEWAL_USDC_BASE = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

export const RENEWAL_WORKFLOW_ABI = parseAbi([
  'function balanceOfToken(uint256 tokenId) view returns (uint256)',
  'function autoRenewEnabled(uint256 tokenId) view returns (bool)',
  'function pendingRenewals(uint256 tokenId) view returns (uint256 amount,uint64 expiresAt,uint64 reservedAt)',
  'function renewalWindow() view returns (uint64)',
  'function renewalDuration() view returns (uint64)',
  'function renewalFee() view returns (uint256)',
  'function nft() view returns (address)',
  'function registry() view returns (address)',
  'function usdc() view returns (address)',
  'function lastRenewedAt(uint256 tokenId) view returns (uint64)',
  'function isRenewable(uint256 tokenId) view returns (bool)',
  'function renewalVault() view returns (address)',
  'event AutoRenewToggled(uint256 indexed tokenId,bool enabled)',
]);

export type RenewalWorkflowErrorCode =
  | 'INVALID_INPUT'
  | 'WRONG_CHAIN'
  | 'UNSAFE_SNAPSHOT'
  | 'UNAVAILABLE'
  | 'IDENTITY_NOT_FOUND'
  | 'OWNER_MISMATCH'
  | 'INCONSISTENT_STATE'
  | 'REVOKED'
  | 'EXPIRED_TOO_LONG'
  | 'PLAN_INVALID'
  | 'APPROVAL_REQUIRED'
  | 'STALE_PLAN';

export class RenewalWorkflowError extends Error {
  override readonly name = 'RenewalWorkflowError';
  constructor(
    readonly code: RenewalWorkflowErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RenewalPublicClient = Pick<
  PublicClient,
  'getChainId' | 'readContract' | 'multicall' | 'ccipRead'
> & {
  getBlock(args: { blockTag: 'safe' } | { blockNumber: bigint }): Promise<{
    number: bigint | null;
    hash: Hex | null;
    timestamp: bigint;
  }>;
  getTransactionReceipt?(args: {
    hash: Hex;
  }): Promise<
    Pick<
      Awaited<ReturnType<PublicClient['getTransactionReceipt']>>,
      'transactionHash' | 'blockHash' | 'blockNumber' | 'from' | 'to' | 'status' | 'logs'
    >
  >;
  getTransaction?(args: { hash: Hex }): Promise<{
    hash: Hex;
    blockHash: Hex | null;
    blockNumber: bigint | null;
    from: Address;
    to: Address | null;
    value: bigint;
    input: Hex;
    chainId?: number;
  }>;
};

export interface RenewalWorkflowOptions {
  publicClient?: RenewalPublicClient;
}

export interface FoundAgentRenewal {
  version: 1;
  status: 'found';
  chainId: 8453;
  vaultAddress: Address;
  identity: FoundAgentIdentity;
  vault: {
    availableAtomicUsdc: string;
    reservedAtomicUsdc: string;
    /** Minimum accepted keeper quote, never the actual registrar quote. Zero is unset. */
    minimumFeeAtomicUsdc: string;
    autoRenewEnabled: boolean;
    pendingRenewal: { amountAtomicUsdc: string; expiresAt: string; reservedAt: string } | null;
    renewalWindowSeconds: string;
    renewalDurationSeconds: string;
    lastRenewedAt: string;
    /** Native timing/flags predicate; does NOT include balance or actual quote checks. */
    isRenewable: boolean;
    nft: Address;
    registry: Address;
    usdc: Address;
  };
  checks: {
    identityConsistent: boolean;
    canonicalContracts: boolean;
    parametersConsistent: boolean;
    reservationConsistent: boolean;
    lifecycleConsistent: boolean;
    withinRenewalWindow: boolean;
    minimumFeeConfigured: boolean;
    availableCoversMinimum: boolean;
  };
  consistent: boolean;
  /** This observation does not prove an external registrar renewal completed. */
  renewalExecution: 'keeper_registrar_confirmation_required';
}

export interface MissingAgentRenewal {
  version: 1;
  status: 'not_found';
  chainId: 8453;
  vaultAddress: Address;
  identity: MissingAgentIdentity;
}
export type AgentRenewalInspection = FoundAgentRenewal | MissingAgentRenewal;

const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimalToken = /^[1-9][0-9]{0,77}$/;
const tokenSchema = z
  .string()
  .regex(decimalToken)
  .refine((value) => decimalToken.test(value) && BigInt(value) <= maxUint256);
const decimalUnsigned = /^(0|[1-9][0-9]{0,77})$/;
const unsignedSchema = z
  .string()
  .regex(decimalUnsigned)
  .refine((value) => decimalUnsigned.test(value) && BigInt(value) <= maxUint256);
const observedAnchorSchema = z
  .object({
    version: z.literal(1),
    status: z.literal('found'),
    chainId: z.literal(8453),
    vaultAddress: z.literal(AGENT_RENEWAL_VAULT_BASE),
    identity: z
      .object({
        version: z.literal(1),
        status: z.literal('found'),
        chainId: z.literal(8453),
        registryAddress: z.literal(AGENT_IDENTITY_REGISTRY_BASE),
        tokenId: tokenSchema,
        block: z
          .object({
            number: unsignedSchema,
            hash: hashSchema,
            timestamp: unsignedSchema,
            tag: z.literal('safe'),
          })
          .strict(),
      })
      .passthrough(),
  })
  .passthrough();
const changeInput = z
  .object({
    tokenId: tokenSchema,
    expectedOwner: z.string().refine((value) => isAddress(value)),
    enabled: z.boolean(),
    builderCode: z.string().regex(/^[a-z0-9_]{1,32}$/),
  })
  .strict();
export interface AutoRenewChangeInput {
  tokenId: string;
  expectedOwner: string;
  enabled: boolean;
  builderCode: string;
}

function fail(code: RenewalWorkflowErrorCode, message: string): never {
  throw new RenewalWorkflowError(code, message);
}

function clientFor(options: RenewalWorkflowOptions): RenewalPublicClient {
  const client =
    options.publicClient ??
    createPublicClient({
      chain: base,
      ccipRead: false,
      transport: http('https://mainnet.base.org', { timeout: 8_000, retryCount: 0 }),
    });
  if (client.ccipRead !== false)
    fail('INVALID_INPUT', 'The renewal RPC client must disable CCIP read.');
  return client;
}

function sanitized(error: unknown): never {
  if (error instanceof RenewalWorkflowError) throw error;
  if (error instanceof IdentityInspectionError)
    throw new RenewalWorkflowError(error.code, error.message);
  throw new RenewalWorkflowError(
    'UNAVAILABLE',
    'Base renewal inspection is unavailable. No renewal outcome was confirmed.',
  );
}

async function sameAnchor(client: RenewalPublicClient, identity: FoundAgentIdentity) {
  const checked = await client.getBlock({ blockNumber: BigInt(identity.block.number) });
  if (
    checked.number?.toString() !== identity.block.number ||
    checked.hash !== identity.block.hash ||
    checked.timestamp.toString() !== identity.block.timestamp
  ) {
    fail('UNSAFE_SNAPSHOT', 'The inspected renewal block changed. Inspect again.');
  }
  if ((await client.getChainId()) !== base.id)
    fail('WRONG_CHAIN', 'Renewal inspection requires Base mainnet.');
}

/** Read-only, hash-pinned identity plus canonical vault state; no quotes, API keys or metadata fetch. */
export async function inspectAgentRenewal(
  input: IdentityInspectionInput,
  options: RenewalWorkflowOptions = {},
): Promise<AgentRenewalInspection> {
  const client = clientFor(options);
  try {
    const identity = await inspectAgentIdentity(input, {
      publicClient: client,
    });
    if (identity.status === 'not_found')
      return {
        version: 1,
        status: 'not_found',
        chainId: 8453,
        vaultAddress: AGENT_RENEWAL_VAULT_BASE,
        identity,
      };
    const tokenId = BigInt(identity.tokenId);
    const vault = { address: AGENT_RENEWAL_VAULT_BASE, abi: RENEWAL_WORKFLOW_ABI } as const;
    const [
      available,
      enabled,
      pending,
      window,
      duration,
      minimum,
      nft,
      registry,
      usdc,
      last,
      renewable,
      configuredVault,
    ] = await client.multicall({
      blockHash: identity.block.hash,
      requireCanonical: true,
      allowFailure: false,
      multicallAddress: base.contracts.multicall3.address,
      batchSize: 4096,
      contracts: [
        { ...vault, functionName: 'balanceOfToken', args: [tokenId] },
        { ...vault, functionName: 'autoRenewEnabled', args: [tokenId] },
        { ...vault, functionName: 'pendingRenewals', args: [tokenId] },
        { ...vault, functionName: 'renewalWindow' },
        { ...vault, functionName: 'renewalDuration' },
        { ...vault, functionName: 'renewalFee' },
        { ...vault, functionName: 'nft' },
        { ...vault, functionName: 'registry' },
        { ...vault, functionName: 'usdc' },
        { ...vault, functionName: 'lastRenewedAt', args: [tokenId] },
        { ...vault, functionName: 'isRenewable', args: [tokenId] },
        {
          address: AGENT_IDENTITY_REGISTRY_BASE,
          abi: RENEWAL_WORKFLOW_ABI,
          functionName: 'renewalVault',
        },
      ],
    });
    const [amount, pendingExpiry, reservedAt] = pending;
    const at = BigInt(identity.block.timestamp),
      expiry = BigInt(identity.identity.expiresAt);
    const within = expiry <= at + window && at <= expiry + window;
    const checks = {
      identityConsistent: identity.consistent,
      canonicalContracts:
        getAddress(nft) === getAddress(AGENT_IDENTITY_REGISTRY_BASE) &&
        getAddress(registry) === getAddress(AGENT_IDENTITY_REGISTRY_BASE) &&
        getAddress(usdc) === AGENT_RENEWAL_USDC_BASE &&
        getAddress(configuredVault) === AGENT_RENEWAL_VAULT_BASE,
      parametersConsistent: duration > 0n && window > 0n && window <= duration,
      reservationConsistent:
        amount === 0n
          ? pendingExpiry === 0n && reservedAt === 0n
          : pendingExpiry === expiry &&
            reservedAt >= BigInt(identity.identity.createdAt) &&
            reservedAt <= at,
      lifecycleConsistent:
        last <= at &&
        renewable === (enabled && amount === 0n && !identity.identity.revoked && within),
      withinRenewalWindow: within,
      minimumFeeConfigured: minimum > 0n,
      availableCoversMinimum: minimum > 0n && available >= minimum,
    };
    await sameAnchor(client, identity);
    return {
      version: 1,
      status: 'found',
      chainId: 8453,
      vaultAddress: AGENT_RENEWAL_VAULT_BASE,
      identity,
      vault: {
        availableAtomicUsdc: available.toString(),
        reservedAtomicUsdc: amount.toString(),
        minimumFeeAtomicUsdc: minimum.toString(),
        autoRenewEnabled: enabled,
        pendingRenewal:
          amount === 0n
            ? null
            : {
                amountAtomicUsdc: amount.toString(),
                expiresAt: pendingExpiry.toString(),
                reservedAt: reservedAt.toString(),
              },
        renewalWindowSeconds: window.toString(),
        renewalDurationSeconds: duration.toString(),
        lastRenewedAt: last.toString(),
        isRenewable: renewable,
        nft: getAddress(nft),
        registry: getAddress(registry),
        usdc: getAddress(usdc),
      },
      checks,
      consistent:
        checks.identityConsistent &&
        checks.canonicalContracts &&
        checks.parametersConsistent &&
        checks.reservationConsistent &&
        checks.lifecycleConsistent,
      renewalExecution: 'keeper_registrar_confirmation_required',
    };
  } catch (error) {
    return sanitized(error);
  }
}

export interface AutoRenewChangePlan extends AutoRenewChangeInput {
  version: 1;
  kind: 'set_auto_renew';
  id: Hex;
  chainId: 8453;
  observation: FoundAgentRenewal;
  transaction: { to: Address; data: Hex; value: '0' };
  noChange: boolean;
  /** setAutoRenew does not cancel a keeper reservation or itself renew the domain. */
  warnings: readonly string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(record[key]))
        .join(',') +
      '}'
    );
  }
  const result = JSON.stringify(value);
  if (result === undefined) fail('PLAN_INVALID', 'The auto-renew plan is not a JSON value.');
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const planId = (value: unknown) => keccak256(stringToHex(canonical(value)));

function parseChange(input: AutoRenewChangeInput): AutoRenewChangeInput {
  const result = changeInput.safeParse(input);
  if (!result.success)
    fail(
      'INVALID_INPUT',
      'Supply a decimal token ID, expected owner, boolean enabled and builder code.',
    );
  validateBuilderCode(result.data.builderCode);
  return { ...result.data, expectedOwner: getAddress(result.data.expectedOwner) };
}

function permitted(
  input: AutoRenewChangeInput,
  result: AgentRenewalInspection,
): asserts result is FoundAgentRenewal {
  if (result.status !== 'found')
    fail('IDENTITY_NOT_FOUND', 'The AgentDomain identity was not found.');
  if (!result.consistent)
    fail(
      'INCONSISTENT_STATE',
      'Canonical identity or renewal records differ. No transaction was prepared.',
    );
  if (
    result.identity.nftOwner !== input.expectedOwner ||
    result.identity.checks.expectedOwnerMatches !== true
  )
    fail('OWNER_MISMATCH', 'Only the current canonical NFT owner can change auto-renew.');
  if (input.enabled && result.identity.identity.revoked)
    fail('REVOKED', 'A revoked identity cannot enable auto-renew through this workflow.');
  if (
    input.enabled &&
    BigInt(result.identity.block.timestamp) >
      BigInt(result.identity.identity.expiresAt) + BigInt(result.vault.renewalWindowSeconds)
  )
    fail('EXPIRED_TOO_LONG', 'The identity is past the vault renewal window.');
}

/** Prepare only a zero-value setAutoRenew transaction. No signing, spending, approval or keeper call. */
export async function prepareAutoRenewChange(
  input: AutoRenewChangeInput,
  options: RenewalWorkflowOptions = {},
): Promise<AutoRenewChangePlan> {
  const intent = parseChange(input);
  const observation = await inspectAgentRenewal(
    { tokenId: intent.tokenId, expectedOwner: intent.expectedOwner },
    options,
  );
  permitted(intent, observation);
  const body = {
    version: 1 as const,
    kind: 'set_auto_renew' as const,
    chainId: 8453 as const,
    ...intent,
    observation,
    transaction: {
      to: AGENT_RENEWAL_VAULT_BASE,
      data: encodeSetAutoRenewCalldata(BigInt(intent.tokenId), intent.enabled, intent.builderCode),
      value: '0' as const,
    },
    noChange: observation.vault.autoRenewEnabled === intent.enabled,
    warnings: [
      'This transaction changes the auto-renew flag only; it does not itself renew the domain or pay a USDC renewal charge. Network gas may apply.',
      intent.enabled
        ? "Enabling permits authorized keepers to use this token's funded vault balance for automatic renewals without a new wallet signature for each renewal. The actual registrar quote may exceed the configured minimum."
        : 'Disabling stops new reservations. It does not cancel an existing renewal reservation, which can still complete and charge the reserved funds.',
    ],
  };
  return freeze({ ...body, id: planId(body) });
}

function validatePlan(input: AutoRenewChangePlan): {
  intent: AutoRenewChangeInput;
  observedBlockNumber: bigint;
} {
  try {
    const parsed = z
      .object({
        version: z.literal(1),
        kind: z.literal('set_auto_renew'),
        chainId: z.literal(8453),
        id: hashSchema,
        tokenId: tokenSchema,
        expectedOwner: z.string(),
        enabled: z.boolean(),
        builderCode: z.string(),
        observation: observedAnchorSchema,
        transaction: z.object({ to: z.string(), data: z.string(), value: z.literal('0') }).strict(),
        noChange: z.boolean(),
        warnings: z.array(z.string()),
      })
      .strict()
      .parse(input);
    const { id, ...body } = parsed;
    const intent = parseChange({
      tokenId: parsed.tokenId,
      expectedOwner: parsed.expectedOwner,
      enabled: parsed.enabled,
      builderCode: parsed.builderCode,
    });
    if (
      id.toLowerCase() !== planId(body) ||
      parsed.observation.identity.tokenId !== intent.tokenId ||
      parsed.transaction.to !== AGENT_RENEWAL_VAULT_BASE ||
      parsed.transaction.data !==
        encodeSetAutoRenewCalldata(BigInt(intent.tokenId), intent.enabled, intent.builderCode)
    )
      fail('PLAN_INVALID', 'The auto-renew plan changed. Prepare a fresh plan.');
    return freeze({
      intent,
      observedBlockNumber: BigInt(parsed.observation.identity.block.number),
    });
  } catch {
    return fail('PLAN_INVALID', 'The auto-renew plan is invalid or changed. Prepare it again.');
  }
}

export interface ExecuteAutoRenewChangeOptions extends RenewalWorkflowOptions {
  walletClient: Pick<WalletClient, 'getChainId' | 'getAddresses' | 'sendTransaction'> &
    Partial<Pick<WalletClient, 'account'>>;
  /** Required host UI/user approval. Never map a model-supplied boolean to this callback. */
  approve(plan: Readonly<AutoRenewChangePlan>): Promise<boolean>;
}
export type AutoRenewChangeExecution =
  | { status: 'no_change'; planId: Hex; transactionHash: null; observation: FoundAgentRenewal }
  | { status: 'rejected'; planId: Hex; transactionHash: null }
  | { status: 'submitted'; planId: Hex; transactionHash: Hex }
  | { status: 'submission_unknown'; planId: Hex; transactionHash: null };

const executions = new WeakMap<object, Promise<AutoRenewChangeExecution>>();
async function walletOwner(
  wallet: ExecuteAutoRenewChangeOptions['walletClient'],
  owner: string,
): Promise<Account | Address> {
  if ((await wallet.getChainId()) !== base.id)
    fail('WRONG_CHAIN', 'The approving wallet must be on Base mainnet.');
  const addresses = await wallet.getAddresses();
  if (!addresses.some((address) => getAddress(address) === owner))
    fail('OWNER_MISMATCH', 'The current NFT owner wallet must approve this change.');
  if (wallet.account && getAddress(wallet.account.address) !== owner)
    fail('OWNER_MISMATCH', 'The configured wallet account is not the expected NFT owner.');
  return wallet.account ?? getAddress(owner);
}
function rejected(error: unknown) {
  const value =
    error instanceof BaseError
      ? error.walk((cause) =>
          Boolean(cause && typeof cause === 'object' && 'code' in cause && cause.code === 4001),
        )
      : error;
  return Boolean(value && typeof value === 'object' && 'code' in value && value.code === 4001);
}

/** One submission per plan object in this process; no retries, re-signing or persistent idempotency claim.
 * Settled no-change attempts are not submissions and must be freshly checked on explicit reuse. */
export function executeAutoRenewChange(
  plan: AutoRenewChangePlan,
  options: ExecuteAutoRenewChangeOptions,
): Promise<AutoRenewChangeExecution> {
  const { intent } = validatePlan(plan);
  const submittedPlanId = plan.id;
  if (!options || typeof options.approve !== 'function')
    fail('APPROVAL_REQUIRED', 'A host-provided human approval callback is required.');
  const existing = executions.get(plan);
  if (existing) return existing;
  // Cache before any wallet method can synchronously reenter this function.
  const execution = Promise.resolve()
    .then(async (): Promise<AutoRenewChangeExecution> => {
      await walletOwner(options.walletClient, intent.expectedOwner);
      const current = await prepareAutoRenewChange(intent, options);
      if (current.noChange)
        return {
          status: 'no_change',
          planId: submittedPlanId,
          transactionHash: null,
          observation: current.observation,
        };
      let approved: boolean;
      try {
        approved = await options.approve(current);
      } catch {
        return fail(
          'APPROVAL_REQUIRED',
          'Approval did not complete. No transaction was requested.',
        );
      }
      if (approved !== true)
        return { status: 'rejected', planId: submittedPlanId, transactionHash: null };
      await walletOwner(options.walletClient, intent.expectedOwner);
      const checked = await prepareAutoRenewChange(intent, options);
      if (checked.noChange)
        return {
          status: 'no_change',
          planId: submittedPlanId,
          transactionHash: null,
          observation: checked.observation,
        };
      if (
        canonical(checked.observation.vault.pendingRenewal) !==
        canonical(current.observation.vault.pendingRenewal)
      )
        return fail(
          'STALE_PLAN',
          'The pending reservation changed during approval. Review a new plan.',
        );
      // Reconstruct every transaction field from validated primitives, never caller JSON.
      const account = await walletOwner(options.walletClient, intent.expectedOwner);
      const transaction = {
        account,
        chain: base,
        to: AGENT_RENEWAL_VAULT_BASE,
        value: 0n,
        data: encodeSetAutoRenewCalldata(
          BigInt(intent.tokenId),
          intent.enabled,
          intent.builderCode,
        ),
      };
      try {
        const transactionHash = await options.walletClient.sendTransaction(transaction);
        if (!hashSchema.safeParse(transactionHash).success)
          return { status: 'submission_unknown', planId: submittedPlanId, transactionHash: null };
        return { status: 'submitted', planId: submittedPlanId, transactionHash };
      } catch (error) {
        // A transport error after wallet submission is not proof the transaction failed.
        return {
          status: rejected(error) ? 'rejected' : 'submission_unknown',
          planId: submittedPlanId,
          transactionHash: null,
        };
      }
    })
    .then((result) => {
      if (result.status === 'no_change' && executions.get(plan) === execution)
        executions.delete(plan);
      return result;
    })
    .catch((error) => sanitized(error));
  executions.set(plan, execution);
  return execution;
}

export interface AutoRenewChangeConfirmation {
  status: 'pending' | 'confirmed' | 'reverted' | 'unverified';
  action: 'set_auto_renew';
  transactionHash: Hex;
  code:
    | 'RECEIPT_PENDING'
    | 'NOT_SAFE_YET'
    | 'FLAG_CONFIRMED'
    | 'TRANSACTION_REVERTED'
    | 'TRANSACTION_MISMATCH'
    | 'READBACK_MISMATCH'
    | 'UNAVAILABLE';
  observation?: FoundAgentRenewal;
}

/** Single read-only confirmation attempt. Never waits/rebroadcasts or claims registrar renewal.
 * Binds the matching transaction after the plan's recorded observation and the current flag,
 * not cryptographic proof that a human approved this particular plan.
 * For a later safe head, ancestry remains an RPC trust assumption, not an SPV proof. */
export async function confirmAutoRenewChange(
  plan: AutoRenewChangePlan,
  transactionHash: Hex,
  options: RenewalWorkflowOptions = {},
): Promise<AutoRenewChangeConfirmation> {
  const { intent, observedBlockNumber } = validatePlan(plan);
  if (!hashSchema.safeParse(transactionHash).success)
    fail('INVALID_INPUT', 'Provide the exact Base transaction hash.');
  const client = clientFor(options);
  const result = (
    status: AutoRenewChangeConfirmation['status'],
    code: AutoRenewChangeConfirmation['code'],
    observation?: FoundAgentRenewal,
  ): AutoRenewChangeConfirmation => ({
    status,
    action: 'set_auto_renew',
    transactionHash,
    code,
    ...(observation ? { observation } : {}),
  });
  try {
    if (!client.getTransactionReceipt || !client.getTransaction)
      return result('unverified', 'UNAVAILABLE');
    if ((await client.getChainId()) !== base.id)
      return result('unverified', 'TRANSACTION_MISMATCH');
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    const transaction = await client.getTransaction({ hash: transactionHash });
    if (
      receipt.blockNumber <= observedBlockNumber ||
      receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
      transaction.hash.toLowerCase() !== transactionHash.toLowerCase() ||
      !hashSchema.safeParse(receipt.blockHash).success ||
      transaction.blockHash !== receipt.blockHash ||
      transaction.blockNumber !== receipt.blockNumber ||
      getAddress(receipt.from) !== intent.expectedOwner ||
      !receipt.to ||
      getAddress(receipt.to) !== AGENT_RENEWAL_VAULT_BASE ||
      getAddress(transaction.from) !== intent.expectedOwner ||
      !transaction.to ||
      getAddress(transaction.to) !== AGENT_RENEWAL_VAULT_BASE ||
      transaction.value !== 0n ||
      transaction.input.toLowerCase() !==
        encodeSetAutoRenewCalldata(
          BigInt(intent.tokenId),
          intent.enabled,
          intent.builderCode,
        ).toLowerCase() ||
      (transaction.chainId !== undefined && transaction.chainId !== base.id)
    )
      return result('unverified', 'TRANSACTION_MISMATCH');
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || block.number !== receipt.blockNumber)
      return result('pending', 'NOT_SAFE_YET');
    const safe = await client.getBlock({ blockTag: 'safe' });
    if (
      safe.number === null ||
      !hashSchema.safeParse(safe.hash).success ||
      safe.number < receipt.blockNumber ||
      (safe.number === receipt.blockNumber && safe.hash !== receipt.blockHash)
    )
      return result('pending', 'NOT_SAFE_YET');
    if (receipt.status === 'reverted') {
      const checked = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (
        checked.hash !== receipt.blockHash ||
        checked.number !== receipt.blockNumber ||
        (await client.getChainId()) !== base.id
      )
        return result('pending', 'NOT_SAFE_YET');
      return result('reverted', 'TRANSACTION_REVERTED');
    }
    if (receipt.status !== 'success') return result('unverified', 'UNAVAILABLE');
    const toggled = receipt.logs.some((log) => {
      if (
        getAddress(log.address) !== AGENT_RENEWAL_VAULT_BASE ||
        log.removed ||
        log.blockHash !== receipt.blockHash ||
        log.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
        log.blockNumber !== receipt.blockNumber
      )
        return false;
      try {
        const event = decodeEventLog({
          abi: RENEWAL_WORKFLOW_ABI,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        return (
          event.eventName === 'AutoRenewToggled' &&
          event.args.tokenId === BigInt(intent.tokenId) &&
          event.args.enabled === intent.enabled
        );
      } catch {
        return false;
      }
    });
    if (!toggled) return result('unverified', 'TRANSACTION_MISMATCH');
    const observation = await inspectAgentRenewal(
      { tokenId: intent.tokenId, expectedOwner: intent.expectedOwner },
      { publicClient: client },
    );
    if (observation.status !== 'found') return result('unverified', 'READBACK_MISMATCH');
    if (BigInt(observation.identity.block.number) < receipt.blockNumber)
      return result('pending', 'NOT_SAFE_YET');
    if (
      BigInt(observation.identity.block.number) === receipt.blockNumber &&
      observation.identity.block.hash !== receipt.blockHash
    )
      return result('pending', 'NOT_SAFE_YET');
    const finalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (
      finalBlock.hash !== receipt.blockHash ||
      finalBlock.number !== receipt.blockNumber ||
      (await client.getChainId()) !== base.id
    )
      return result('pending', 'NOT_SAFE_YET');
    if (
      !observation.consistent ||
      observation.identity.checks.expectedOwnerMatches !== true ||
      observation.vault.autoRenewEnabled !== intent.enabled
    )
      return result('unverified', 'READBACK_MISMATCH', observation);
    return result('confirmed', 'FLAG_CONFIRMED', observation);
  } catch (error) {
    const absent =
      error instanceof BaseError &&
      error.walk((cause) => cause instanceof TransactionReceiptNotFoundError) instanceof
        TransactionReceiptNotFoundError;
    return absent ? result('pending', 'RECEIPT_PENDING') : result('unverified', 'UNAVAILABLE');
  }
}
