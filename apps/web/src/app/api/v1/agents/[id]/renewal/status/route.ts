import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { createPublicClient, http, formatUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';

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
] as const;

/**
 * GET /api/v1/agents/:id/renewal/status
 *
 * Get the current renewal vault status for an agent.
 * Returns: vault balance, auto-renew status, expiry date, estimated years covered.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof Response) return auth;

      const { id } = await params;

      const db = getDb();
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      // Allow both owner and payer to check status
      if (
        agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase() &&
        agent.walletAddress.toLowerCase() !== auth.address.toLowerCase()
      ) {
        return errorResponse(403, 'FORBIDDEN', 'Access denied');
      }

      if (!agent.agentIdNft) {
        return NextResponse.json({
          autoRenewEnabled: false,
          vaultBalanceUsdc: '0.00',
          vaultBalanceAtomic: '0',
          expiresAt: agent.expiresAt?.toISOString() ?? null,
          estimatedYearsCovered: 0,
        });
      }

      const isMainnet = process.env.NEXT_PUBLIC_BASE_CHAIN_ID === '8453';
      const chain = isMainnet ? base : baseSepolia;
      const rpc = isMainnet
        ? process.env.NEXT_PUBLIC_BASE_RPC_URL
        : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;
      const vaultAddress = process.env.NEXT_PUBLIC_RENEWAL_VAULT_ADDRESS as `0x${string}`;

      if (!vaultAddress) {
        return NextResponse.json({
          autoRenewEnabled: false,
          vaultBalanceUsdc: '0.00',
          vaultBalanceAtomic: '0',
          expiresAt: agent.expiresAt?.toISOString() ?? null,
          estimatedYearsCovered: 0,
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
      // Read actual on-chain renewal fee instead of hardcoded $12
      let renewalCostPerYear = 12_000_000n;
      try {
        const fee = await publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'renewalFee',
          args: [],
        });
        if (fee && fee > 0n) renewalCostPerYear = fee as bigint;
      } catch {
        // fallback
      }
      const estimatedYears =
        renewalCostPerYear > 0n ? Number(balanceBigInt / renewalCostPerYear) : 0;

      return NextResponse.json({
        autoRenewEnabled: autoRenew as boolean,
        vaultBalanceUsdc: formatUnits(balanceBigInt, 6),
        vaultBalanceAtomic: balanceBigInt.toString(),
        expiresAt: agent.expiresAt?.toISOString() ?? null,
        estimatedYearsCovered: estimatedYears,
        domain: agent.domain,
        ownerAddress: agent.ownerAddress,
      });
    },
    { route: '/agents/[id]/renewal/status:GET' },
  );
}
