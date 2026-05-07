import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createPublicClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { withErrorHandling, errorResponse, parseBody } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { RENEWAL_VAULT_ABI } from '@/lib/abis';

export const runtime = 'nodejs';

const withdrawSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Invalid USDC amount'),
});

const BALANCE_ABI = [
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
 * POST /api/v1/agents/:id/renewal/withdraw
 *
 * Returns the unsigned withdrawal transaction for the owner to sign with their own wallet.
 * The vault contract requires msg.sender == NFT owner, so only the owner can execute.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof Response) return auth;

      const { id } = await params;
      const parsed = await parseBody(req, withdrawSchema);
      if (parsed instanceof Response) return parsed;

      const db = getDb();
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!agent.agentIdNft) {
        return errorResponse(400, 'NO_NFT', 'Agent does not have an NFT token');
      }

      // STRICT: Only the owner can withdraw
      if (agent.ownerAddress.toLowerCase() !== auth.address.toLowerCase()) {
        return errorResponse(403, 'FORBIDDEN', 'Only the domain owner can withdraw from the vault');
      }

      const isMainnet = process.env.NEXT_PUBLIC_BASE_CHAIN_ID === '8453';
      const chain = isMainnet ? base : baseSepolia;
      const rpc = isMainnet
        ? process.env.NEXT_PUBLIC_BASE_RPC_URL
        : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

      const vaultAddress = process.env.NEXT_PUBLIC_RENEWAL_VAULT_ADDRESS as `0x${string}`;
      if (!vaultAddress) {
        return errorResponse(500, 'CONFIG_ERROR', 'Vault address not configured');
      }

      const publicClient = createPublicClient({ chain, transport: http(rpc) });
      const amountAtomic = parseUnits(parsed.amount, 6);
      const tokenId = BigInt(agent.agentIdNft);

      // Check vault balance
      const currentBalance = await publicClient.readContract({
        address: vaultAddress,
        abi: BALANCE_ABI,
        functionName: 'balanceOfToken',
        args: [tokenId],
      });

      if ((currentBalance as bigint) < amountAtomic) {
        return errorResponse(
          400,
          'INSUFFICIENT_BALANCE',
          `Vault balance ($${((currentBalance as bigint) / 1_000_000n).toString()}) is less than requested withdrawal ($${parsed.amount})`,
        );
      }

      // Lock renewal funds when within 30 days of expiry
      if (agent.expiresAt) {
        const daysUntilExpiry = Math.floor(
          (agent.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );

        if (daysUntilExpiry <= 30) {
          let renewalCostAtomic = 12_000_000n;
          try {
            const fee = await publicClient.readContract({
              address: vaultAddress,
              abi: BALANCE_ABI,
              functionName: 'renewalFee',
              args: [],
            });
            if (fee && fee > 0n) renewalCostAtomic = fee as bigint;
          } catch {
            /* fallback */
          }

          const balanceAfterWithdraw = (currentBalance as bigint) - amountAtomic;
          if (balanceAfterWithdraw < renewalCostAtomic) {
            const lockedAmount = Number(renewalCostAtomic) / 1_000_000;
            return errorResponse(
              400,
              'FUNDS_LOCKED',
              `Cannot withdraw: $${lockedAmount.toFixed(2)} is locked for upcoming renewal (domain expires in ${daysUntilExpiry} days). ` +
                `You can withdraw up to $${(Number(currentBalance as bigint) / 1_000_000 - lockedAmount).toFixed(2)}.`,
            );
          }
        }
      }

      // Build unsigned transaction for owner's wallet to sign
      const calldata = encodeFunctionData({
        abi: RENEWAL_VAULT_ABI,
        functionName: 'withdraw',
        args: [tokenId, amountAtomic],
      });

      return NextResponse.json({
        chainId: chain.id,
        to: vaultAddress,
        data: calldata,
        value: '0',
        functionName: 'withdraw',
        args: {
          tokenId: tokenId.toString(),
          amount: parsed.amount,
        },
      });
    },
    { route: '/agents/[id]/renewal/withdraw:POST' },
  );
}
