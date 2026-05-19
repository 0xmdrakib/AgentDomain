import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { RENEWAL_TRIGGER_DAYS_BEFORE } from '@agentdomain/shared';
import { withErrorHandling, errorResponse, applyRateLimit } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { agentsRepo } from '@/db';

export const runtime = 'nodejs';

const VAULT_ABI = [
  {
    type: 'function',
    name: 'autoRenewEnabled',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOfToken',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'renewalFee',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'renewalDuration',
    inputs: [],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'renewalWindow',
    inputs: [],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRenewable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const FALLBACK_RENEWAL_FEE_ATOMIC = 12_000_000n;
const FALLBACK_RENEWAL_DURATION_SECONDS = 365 * 24 * 60 * 60;
const FALLBACK_RENEWAL_WINDOW_SECONDS = RENEWAL_TRIGGER_DAYS_BEFORE * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/v1/agents/:id/renewal/status
 *
 * Get the current renewal vault status for an agent.
 * Returns: vault balance, auto-renew status, expiry date, estimated years covered.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof Response) return auth;

      const { id } = await params;
      const rateLimitKey = `${id}:${auth.source}:${auth.address.toLowerCase()}`;
      const minuteLimit = await applyRateLimit(req, {
        key: `renewal-status:${rateLimitKey}:minute`,
        max: 30,
        windowSeconds: 60,
      });
      if (minuteLimit) return minuteLimit;
      const hourLimit = await applyRateLimit(req, {
        key: `renewal-status:${rateLimitKey}:hour`,
        max: 300,
        windowSeconds: 60 * 60,
      });
      if (hourLimit) return hourLimit;

      const agent = await agentsRepo.getById(id);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      // Allow both owner and payer to check status
      if (
        agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase() &&
        agent.walletAddress.toLowerCase() !== auth.address.toLowerCase()
      ) {
        return errorResponse(403, 'FORBIDDEN', 'Access denied');
      }

      if (!agent.agentIdNft) {
        const expiry = buildExpiryDetails(agent.expiresAt, FALLBACK_RENEWAL_WINDOW_SECONDS);
        return NextResponse.json({
          agentId: id,
          domain: agent.domain,
          tokenId: null,
          autoRenewEnabled: false,
          vaultBalanceUsdc: '0.00',
          vaultBalanceAtomic: '0',
          vaultBalance: '0.00',
          renewalFeeUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          renewalFeeAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          nextRenewalAmountUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          nextRenewalAmountAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          shortfallUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          shortfallAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          requiredAmount: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          hasEnoughBalanceForNextRenewal: false,
          isFunded: false,
          expiresAt: agent.expiresAt?.toISOString() ?? null,
          renewableFrom: expiry.renewableFrom,
          daysUntilExpiry: expiry.daysUntilExpiry,
          renewalWindowDays: RENEWAL_TRIGGER_DAYS_BEFORE,
          renewalDurationDays: 365,
          estimatedYearsCovered: 0,
          isRenewableNow: false,
          status: 'not_minted',
          message: 'AgentID NFT is not minted yet, so renewal vault status is unavailable.',
        });
      }

      const isMainnet = process.env.NEXT_PUBLIC_BASE_CHAIN_ID === '8453';
      const chain = isMainnet ? base : baseSepolia;
      const rpc = isMainnet
        ? process.env.NEXT_PUBLIC_BASE_RPC_URL
        : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;
      const vaultAddress = process.env.NEXT_PUBLIC_RENEWAL_VAULT_ADDRESS as `0x${string}`;

      if (!vaultAddress) {
        const expiry = buildExpiryDetails(agent.expiresAt, FALLBACK_RENEWAL_WINDOW_SECONDS);
        return NextResponse.json({
          agentId: id,
          domain: agent.domain,
          tokenId: String(agent.agentIdNft),
          autoRenewEnabled: false,
          vaultBalanceUsdc: '0.00',
          vaultBalanceAtomic: '0',
          vaultBalance: '0.00',
          renewalFeeUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          renewalFeeAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          nextRenewalAmountUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          nextRenewalAmountAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          shortfallUsdc: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          shortfallAtomic: FALLBACK_RENEWAL_FEE_ATOMIC.toString(),
          requiredAmount: formatUnits(FALLBACK_RENEWAL_FEE_ATOMIC, 6),
          hasEnoughBalanceForNextRenewal: false,
          isFunded: false,
          expiresAt: agent.expiresAt?.toISOString() ?? null,
          renewableFrom: expiry.renewableFrom,
          daysUntilExpiry: expiry.daysUntilExpiry,
          renewalWindowDays: RENEWAL_TRIGGER_DAYS_BEFORE,
          renewalDurationDays: 365,
          estimatedYearsCovered: 0,
          isRenewableNow: false,
          status: 'vault_unconfigured',
          message: 'Renewal vault contract address is not configured.',
        });
      }

      const publicClient = createPublicClient({ chain, transport: http(rpc) });
      const tokenId = BigInt(agent.agentIdNft);

      const [autoRenew, balance] = await Promise.all([
        publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'autoRenewEnabled',
          args: [tokenId],
        }),
        publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'balanceOfToken',
          args: [tokenId],
        }),
      ]);

      const balanceBigInt = balance as bigint;
      const [renewalCostPerYear, renewalDurationSeconds, renewalWindowSeconds, isRenewableNow] =
        await Promise.all([
          readBigIntWithFallback(
            () =>
              publicClient.readContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'renewalFee',
                args: [],
              }),
            FALLBACK_RENEWAL_FEE_ATOMIC,
          ).then((fee) => (fee > 0n ? fee : FALLBACK_RENEWAL_FEE_ATOMIC)),
          readBigIntWithFallback(
            () =>
              publicClient.readContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'renewalDuration',
                args: [],
              }),
            BigInt(FALLBACK_RENEWAL_DURATION_SECONDS),
          ),
          readBigIntWithFallback(
            () =>
              publicClient.readContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'renewalWindow',
                args: [],
              }),
            BigInt(FALLBACK_RENEWAL_WINDOW_SECONDS),
          ),
          readBooleanWithFallback(
            () =>
              publicClient.readContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'isRenewable',
                args: [tokenId],
              }),
            false,
          ),
        ]);

      const shortfallAtomic =
        balanceBigInt >= renewalCostPerYear ? 0n : renewalCostPerYear - balanceBigInt;
      const hasEnoughBalance = shortfallAtomic === 0n;
      const estimatedYears =
        renewalCostPerYear > 0n ? Number(balanceBigInt / renewalCostPerYear) : 0;
      const renewalWindowSecondsNumber = Number(renewalWindowSeconds);
      const renewalDurationSecondsNumber = Number(renewalDurationSeconds);
      const expiry = buildExpiryDetails(agent.expiresAt, renewalWindowSecondsNumber);
      const status = buildStatus({
        autoRenewEnabled: autoRenew as boolean,
        hasEnoughBalance,
        isRenewableNow,
        expiresAt: agent.expiresAt,
      });

      return NextResponse.json({
        agentId: id,
        domain: agent.domain,
        tokenId: String(agent.agentIdNft),
        autoRenewEnabled: autoRenew as boolean,
        vaultBalanceUsdc: formatUnits(balanceBigInt, 6),
        vaultBalanceAtomic: balanceBigInt.toString(),
        vaultBalance: formatUnits(balanceBigInt, 6),
        renewalFeeUsdc: formatUnits(renewalCostPerYear, 6),
        renewalFeeAtomic: renewalCostPerYear.toString(),
        nextRenewalAmountUsdc: formatUnits(renewalCostPerYear, 6),
        nextRenewalAmountAtomic: renewalCostPerYear.toString(),
        shortfallUsdc: formatUnits(shortfallAtomic, 6),
        shortfallAtomic: shortfallAtomic.toString(),
        requiredAmount: formatUnits(renewalCostPerYear, 6),
        hasEnoughBalanceForNextRenewal: hasEnoughBalance,
        isFunded: hasEnoughBalance,
        estimatedYearsCovered: estimatedYears,
        expiresAt: agent.expiresAt?.toISOString() ?? null,
        renewableFrom: expiry.renewableFrom,
        daysUntilExpiry: expiry.daysUntilExpiry,
        renewalWindowDays: Math.ceil(renewalWindowSecondsNumber / (24 * 60 * 60)),
        renewalDurationDays: Math.ceil(renewalDurationSecondsNumber / (24 * 60 * 60)),
        isRenewableNow,
        status,
        message: buildStatusMessage(status, shortfallAtomic, renewalCostPerYear, agent.expiresAt),
        ownerAddress: agent.ownerAddress,
      });
    },
    { route: '/agents/[id]/renewal/status:GET' },
  );
}

async function readBigIntWithFallback(
  read: () => Promise<unknown>,
  fallback: bigint,
): Promise<bigint> {
  try {
    const value = await read();
    return typeof value === 'bigint' ? value : fallback;
  } catch {
    return fallback;
  }
}

async function readBooleanWithFallback(
  read: () => Promise<unknown>,
  fallback: boolean,
): Promise<boolean> {
  try {
    const value = await read();
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
}

function buildExpiryDetails(expiresAt: Date | null | undefined, renewalWindowSeconds: number) {
  if (!expiresAt) {
    return { daysUntilExpiry: null, renewableFrom: null };
  }
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS);
  const renewableFrom = new Date(expiresAt.getTime() - renewalWindowSeconds * 1000).toISOString();
  return { daysUntilExpiry, renewableFrom };
}

function buildStatus(opts: {
  autoRenewEnabled: boolean;
  hasEnoughBalance: boolean;
  isRenewableNow: boolean;
  expiresAt: Date | null | undefined;
}) {
  if (!opts.autoRenewEnabled) return 'auto_renew_off';
  if (!opts.hasEnoughBalance) return 'needs_funding';
  if (opts.isRenewableNow) return 'ready_to_renew';
  if (opts.expiresAt && opts.expiresAt.getTime() < Date.now()) return 'expired';
  return 'funded';
}

function buildStatusMessage(
  status: string,
  shortfallAtomic: bigint,
  renewalCostPerYear: bigint,
  expiresAt: Date | null | undefined,
) {
  if (status === 'expired') return 'This identity is expired. Admin support may be required.';
  if (status === 'auto_renew_off') return 'Auto-renew is off. Enable it before the renewal window.';
  if (status === 'needs_funding') {
    return `Deposit $${formatUnits(shortfallAtomic, 6)} more USDC to cover the next renewal.`;
  }
  if (status === 'ready_to_renew') {
    return `Ready for renewal. The keeper can use $${formatUnits(
      renewalCostPerYear,
      6,
    )} from the vault.`;
  }
  if (expiresAt) return 'Vault has enough USDC for the next renewal.';
  return 'Vault is funded, but expiry date is not available.';
}
