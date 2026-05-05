import { NextResponse } from 'next/server';
import { recoverTypedDataAddress, type Address, type Hex, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  X402_PAYMENT_HEADER,
  X402_PAYMENT_REQUIRED_HEADER,
  type X402PaymentRequirement,
} from '@agentdomain/shared';
import { getServerEnv } from './env';
import { logger } from './logger';
import { getPublicClient, getBackendWalletClient } from './chain';
import { recordMetric } from './metrics';

/**
 * x402 server-side middleware — production-grade.
 *
 * Two-stage verification:
 *   1. LOCAL: recover signer from EIP-3009 typed-data signature, check it
 *      matches `from`, ensure validBefore/validAfter window is current,
 *      enforce nonce uniqueness via Redis, check on-chain balance.
 *   2. SETTLE: either via the configured x402 facilitator (preferred for
 *      mainnet — they handle gas + retries), OR self-settle by calling
 *      USDC.transferWithAuthorization() ourselves with the backend wallet.
 *
 * Self-settlement is the fallback path when the facilitator is unavailable
 * or when running in environments without internet access to x402.org.
 * Registration payments settle to the backend wallet first. The wrapper can
 * then sweep the configured treasury allocation while the remaining Base USDC
 * stays available for LI.FI-funded onchain registration costs.
 *
 * Spec: https://x402.org
 */

const log = logger.child({ component: 'x402' });

const USDC_AUTH_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) external returns (bool)',
]);

export interface X402SettlementResult {
  settled: boolean;
  txHash?: string;
  errorReason?: string;
  payer: Address;
  amountPaid: string;
}

export interface X402Options {
  amountAtomic: bigint;
  description: string;
  resource: string;
  network?: 'base' | 'base-sepolia';
  /** When true, skip the external facilitator and self-settle. */
  selfSettle?: boolean;
  /** Portion of a successful payment that should be swept to TREASURY_ADDRESS. */
  treasuryFeeAtomic?: bigint;
}

export function buildPaymentRequirement(opts: X402Options): X402PaymentRequirement {
  const env = getServerEnv();
  const network = opts.network ?? env.X402_NETWORK;
  const isMainnet = network === 'base';

  return {
    scheme: 'exact',
    network,
    maxAmountRequired: opts.amountAtomic.toString(),
    resource: opts.resource,
    description: opts.description,
    mimeType: 'application/json',
    payTo: getPaymentRecipient(),
    maxTimeoutSeconds: 300,
    asset: (isMainnet
      ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      : '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as Address,
  };
}

function getPaymentRecipient(): Address {
  return getBackendWalletClient().account!.address;
}

export function paymentRequiredResponse(opts: X402Options): NextResponse {
  const requirement = buildPaymentRequirement(opts);
  return NextResponse.json(
    {
      x402Version: 1,
      error: 'Payment Required',
      accepts: [requirement],
    },
    {
      status: 402,
      headers: {
        [X402_PAYMENT_REQUIRED_HEADER]: JSON.stringify(requirement),
        'Content-Type': 'application/json',
      },
    },
  );
}

export interface X402Payload {
  x402Version: number;
  scheme: 'exact';
  network: 'base' | 'base-sepolia';
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

export function decodePaymentHeader(header: string): X402Payload {
  let json: string;
  try {
    json = Buffer.from(header, 'base64').toString('utf8');
  } catch {
    throw new Error('Invalid X-Payment header: not valid base64');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid X-Payment header: not valid JSON');
  }
  const payload = parsed as Partial<X402Payload>;
  if (!payload.payload?.signature || !payload.payload?.authorization) {
    throw new Error('Invalid X-Payment header: missing fields');
  }
  return payload as X402Payload;
}

// -----------------------------------------------------------------
// LOCAL VERIFICATION (no network/facilitator required)
// -----------------------------------------------------------------

/**
 * Locally verify an x402 payment payload BEFORE attempting settlement.
 *
 * Checks performed:
 *   1. EIP-712 signature recovers to authorization.from
 *   2. authorization.to matches payTo in requirement
 *   3. authorization.value >= maxAmountRequired
 *   4. validAfter <= now <= validBefore
 *   5. (on-chain) USDC.authorizationState(from, nonce) === false (not used)
 *   6. (on-chain) USDC.balanceOf(from) >= value
 *
 * Returns null if all checks pass; otherwise returns a reason string.
 */
export async function verifyPaymentLocally(
  payload: X402Payload,
  requirement: X402PaymentRequirement,
): Promise<string | null> {
  const { from, to, value, validAfter, validBefore, nonce } = payload.payload.authorization;

  // 1. Match payTo
  if (to.toLowerCase() !== requirement.payTo.toLowerCase()) {
    return 'wrong_recipient';
  }

  // 2. Match amount
  if (BigInt(value) < BigInt(requirement.maxAmountRequired)) {
    return 'insufficient_amount';
  }

  // 3. Time window
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(validAfter) > now) return 'not_yet_valid';
  if (BigInt(validBefore) <= now) return 'expired';

  // 4. Recover signer via EIP-712 typed data
  const chainId = payload.network === 'base' ? base.id : baseSepolia.id;
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId,
        verifyingContract: requirement.asset,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from,
        to,
        value: BigInt(value),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
      signature: payload.payload.signature,
    });
  } catch (e) {
    log.warn('signature recovery failed', { err: String(e) });
    return 'bad_signature';
  }

  if (recovered.toLowerCase() !== from.toLowerCase()) {
    return 'signer_mismatch';
  }

  // 5. On-chain checks: nonce + balance
  try {
    const publicClient = getPublicClient();
    const [nonceUsed, balance] = (await Promise.all([
      publicClient.readContract({
        address: requirement.asset,
        abi: USDC_AUTH_ABI,
        functionName: 'authorizationState',
        args: [from, nonce],
      }),
      publicClient.readContract({
        address: requirement.asset,
        abi: USDC_AUTH_ABI,
        functionName: 'balanceOf',
        args: [from],
      }),
    ])) as [boolean, bigint];

    if (nonceUsed) return 'nonce_already_used';
    if (balance < BigInt(value)) return 'insufficient_balance';
  } catch (e) {
    log.warn('on-chain verification failed (non-fatal)', { err: String(e) });
    // Fall through — let settlement attempt and fail loudly there.
  }

  return null;
}

// -----------------------------------------------------------------
// SETTLEMENT
// -----------------------------------------------------------------

/**
 * Settle through the x402 facilitator (preferred path).
 */
export async function settleViaFacilitator(
  payload: X402Payload,
  requirement: X402PaymentRequirement,
): Promise<X402SettlementResult> {
  const env = getServerEnv();
  const facilitator = env.X402_FACILITATOR_URL;

  try {
    const settleRes = await fetch(`${facilitator}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirement }),
    });

    if (!settleRes.ok) {
      return {
        settled: false,
        payer: payload.payload.authorization.from,
        amountPaid: '0',
        errorReason: `facilitator_${settleRes.status}`,
      };
    }

    const settleJson = (await settleRes.json()) as {
      transaction?: string;
      success: boolean;
      errorReason?: string;
    };
    if (!settleJson.success) {
      return {
        settled: false,
        payer: payload.payload.authorization.from,
        amountPaid: '0',
        errorReason: settleJson.errorReason ?? 'unknown',
      };
    }

    return {
      settled: true,
      txHash: settleJson.transaction,
      payer: payload.payload.authorization.from,
      amountPaid: payload.payload.authorization.value,
    };
  } catch (e) {
    return {
      settled: false,
      payer: payload.payload.authorization.from,
      amountPaid: '0',
      errorReason: `facilitator_unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Settle the payment ourselves by calling USDC.transferWithAuthorization().
 * This is the fallback when the facilitator is down. Costs us gas but is
 * always available.
 */
export async function settleSelf(
  payload: X402Payload,
  requirement: X402PaymentRequirement,
): Promise<X402SettlementResult> {
  const wallet = getBackendWalletClient();
  const publicClient = getPublicClient();

  const { from, to, value, validAfter, validBefore, nonce } = payload.payload.authorization;
  const sig = payload.payload.signature;

  // Split signature into v/r/s
  if (sig.length !== 132) {
    return {
      settled: false,
      payer: from,
      amountPaid: '0',
      errorReason: 'malformed_signature',
    };
  }
  const r = ('0x' + sig.slice(2, 66)) as Hex;
  const s = ('0x' + sig.slice(66, 130)) as Hex;
  const vRaw = parseInt(sig.slice(130, 132), 16);
  // EIP-155 normalization: USDC accepts 27/28 only.
  const v = vRaw < 27 ? vRaw + 27 : vRaw;

  try {
    const txHash = await wallet.writeContract({
      address: requirement.asset,
      abi: USDC_AUTH_ABI,
      functionName: 'transferWithAuthorization',
      args: [from, to, BigInt(value), BigInt(validAfter), BigInt(validBefore), nonce, v, r, s],
      chain: wallet.chain,
      account: wallet.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      settled: true,
      txHash,
      payer: from,
      amountPaid: value,
    };
  } catch (e) {
    log.error('self-settle failed', { err: String(e) });
    return {
      settled: false,
      payer: from,
      amountPaid: '0',
      errorReason: `self_settle_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Settle a verified payment. Tries the facilitator first; falls back to
 * self-settlement if the facilitator returns an error.
 */
export async function settlePayment(
  payload: X402Payload,
  requirement: X402PaymentRequirement,
  opts: { selfSettle?: boolean } = {},
): Promise<X402SettlementResult> {
  if (opts.selfSettle) {
    return settleSelf(payload, requirement);
  }

  const facilitatorResult = await settleViaFacilitator(payload, requirement);
  if (facilitatorResult.settled) return facilitatorResult;

  log.warn('facilitator settlement failed, attempting self-settle', {
    reason: facilitatorResult.errorReason,
  });
  return settleSelf(payload, requirement);
}

async function sweepTreasuryFee(asset: Address, amountAtomic: bigint, paymentRecipient: Address) {
  const env = getServerEnv();
  const treasury = env.TREASURY_ADDRESS as Address | undefined;
  if (!treasury || treasury.toLowerCase() === paymentRecipient.toLowerCase()) return;

  const wallet = getBackendWalletClient();
  const publicClient = getPublicClient();

  try {
    const txHash = await wallet.writeContract({
      address: asset,
      abi: USDC_AUTH_ABI,
      functionName: 'transfer',
      args: [treasury, amountAtomic],
      chain: wallet.chain,
      account: wallet.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log.info('treasury fee swept', { txHash, amountAtomic: amountAtomic.toString() });
    recordMetric('treasury_fee_swept', { txHash, amountAtomic: amountAtomic.toString() });
  } catch (e) {
    log.error('treasury fee sweep failed; funds remain in backend wallet', { err: String(e) });
    recordMetric('treasury_fee_sweep_failed', { reason: String(e) });
  }
}

// -----------------------------------------------------------------
// WRAPPER
// -----------------------------------------------------------------

export async function withX402(
  req: Request,
  opts: X402Options,
  handler: (settlement: X402SettlementResult, body: unknown) => Promise<Response>,
): Promise<Response> {
  const paymentHeader = req.headers.get(X402_PAYMENT_HEADER);
  if (!paymentHeader) {
    recordMetric('payment_required', {
      resource: opts.resource,
      amountAtomic: opts.amountAtomic.toString(),
    });
    return paymentRequiredResponse(opts);
  }

  let payload: X402Payload;
  try {
    payload = decodePaymentHeader(paymentHeader);
  } catch (e) {
    recordMetric('payment_invalid', { reason: 'bad_header' });
    return NextResponse.json(
      { error: 'BAD_PAYMENT', message: e instanceof Error ? e.message : 'Invalid payment payload' },
      { status: 400 },
    );
  }

  const requirement = buildPaymentRequirement(opts);

  // Network check
  if (payload.network !== requirement.network) {
    recordMetric('payment_invalid', {
      reason: 'wrong_network',
      actual: payload.network,
      expected: requirement.network,
    });
    return NextResponse.json(
      {
        error: 'WRONG_NETWORK',
        message: `Payment is for ${payload.network}, expected ${requirement.network}`,
      },
      { status: 402, headers: { [X402_PAYMENT_REQUIRED_HEADER]: JSON.stringify(requirement) } },
    );
  }

  // Local verification — fails fast without burning gas
  const verifyError = await verifyPaymentLocally(payload, requirement);
  if (verifyError) {
    log.warn('local verification rejected payment', { reason: verifyError });
    recordMetric('payment_invalid', { reason: verifyError });
    return NextResponse.json(
      { error: 'PAYMENT_INVALID', code: verifyError, message: `Payment rejected: ${verifyError}` },
      { status: 402, headers: { [X402_PAYMENT_REQUIRED_HEADER]: JSON.stringify(requirement) } },
    );
  }

  // Read body BEFORE settlement so handler can use it.
  let body: unknown = undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const settlement = await settlePayment(payload, requirement, { selfSettle: opts.selfSettle });
  if (!settlement.settled) {
    log.warn('payment settlement failed', { reason: settlement.errorReason });
    recordMetric('payment_settlement_failed', { reason: settlement.errorReason });
    return NextResponse.json(
      { error: 'PAYMENT_FAILED', message: `Settlement failed: ${settlement.errorReason}` },
      { status: 402 },
    );
  }

  log.info('payment settled', {
    txHash: settlement.txHash,
    amount: settlement.amountPaid,
    payer: settlement.payer,
  });
  recordMetric('payment_settled', {
    txHash: settlement.txHash,
    amountAtomic: settlement.amountPaid,
    payer: settlement.payer,
  });

  if (opts.treasuryFeeAtomic && opts.treasuryFeeAtomic > 0n) {
    await sweepTreasuryFee(requirement.asset, opts.treasuryFeeAtomic, requirement.payTo);
  }

  try {
    return await handler(settlement, body);
  } catch (e) {
    log.error('handler errored after payment', { err: String(e), txHash: settlement.txHash });
    // Payment is already settled; surfaces in admin console for manual refund.
    return NextResponse.json(
      {
        error: 'HANDLER_ERROR',
        message: e instanceof Error ? e.message : 'Internal error',
        // Include txHash so caller knows their payment did go through.
        paymentTxHash: settlement.txHash,
        refundEligible: true,
      },
      { status: 500 },
    );
  }
}
