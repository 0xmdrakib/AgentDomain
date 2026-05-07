import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { withErrorHandling, errorResponse, parseBody } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const fundSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Invalid USDC amount'),
  /** EIP-3009 signed authorization from the payer, allowing this amount to be debited */
  signature: z.string().optional(),
  authorization: z
    .object({
      from: z.string(),
      to: z.string(),
      value: z.string(),
      validAfter: z.string(),
      validBefore: z.string(),
      nonce: z.string(),
    })
    .optional(),
});

const VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'autoRenewEnabled',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAutoRenew',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'enabled', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOfToken',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const USDC_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferWithAuthorization',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * POST /api/v1/agents/:id/renewal/fund
 *
 * Fund the RenewalVault for a specific agent.
 * The caller provides an EIP-3009 signature to authorize USDC transfer
 * from their wallet to the backend, which then deposits into the vault.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof Response) return auth;

      const { id } = await params;
      const parsed = await parseBody(req, fundSchema);
      if (parsed instanceof Response) return parsed;

      if (!parsed.signature || !parsed.authorization) {
        return errorResponse(
          400,
          'MISSING_SIGNATURE',
          'EIP-3009 signature is required to fund the vault',
        );
      }

      const db = getDb();
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!agent.agentIdNft) {
        return errorResponse(400, 'NO_NFT', 'Agent does not have an NFT token');
      }

      const isMainnet = process.env.NEXT_PUBLIC_BASE_CHAIN_ID === '8453';
      const chain = isMainnet ? base : baseSepolia;
      const rpc = isMainnet
        ? process.env.NEXT_PUBLIC_BASE_RPC_URL
        : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

      if (!process.env.BACKEND_PRIVATE_KEY) {
        return errorResponse(500, 'CONFIG_ERROR', 'Backend wallet not configured');
      }

      const vaultAddress = process.env.NEXT_PUBLIC_RENEWAL_VAULT_ADDRESS as `0x${string}`;
      const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`;

      if (!vaultAddress || !usdcAddress) {
        return errorResponse(500, 'CONFIG_ERROR', 'Contract addresses not configured');
      }

      const account = privateKeyToAccount(process.env.BACKEND_PRIVATE_KEY as `0x${string}`);
      const publicClient = createPublicClient({ chain, transport: http(rpc) });
      const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

      const amountAtomic = parseUnits(parsed.amount, 6);
      const tokenId = BigInt(agent.agentIdNft);
      const backendAddress = account.address;

      // Step 1: Demultiplex the compact EIP-3009 signature (r, s, v)
      const sig = parsed.signature as Hex;
      if (sig.length !== 132) {
        return errorResponse(400, 'BAD_SIG', 'Invalid EIP-3009 signature length');
      }
      const r = sig.slice(0, 66) as Hex;
      const s = sig.slice(66, 130) as Hex;
      const v = parseInt(sig.slice(130), 16);

      const authData = parsed.authorization;
      const from = authData.from as `0x${string}`;
      const value = BigInt(authData.value);
      const validAfter = BigInt(authData.validAfter);
      const validBefore = BigInt(authData.validBefore);
      const nonce = authData.nonce as Hex;

      // Verify the payer matches the authorizee
      if (value < amountAtomic) {
        return errorResponse(
          400,
          'BAD_AMOUNT',
          'Authorization value is less than requested deposit amount',
        );
      }

      // Step 2: Execute transferWithAuthorization (pulls USDC from user to backend)
      try {
        const transferTx = await walletClient.writeContract({
          address: usdcAddress,
          abi: USDC_ABI,
          functionName: 'transferWithAuthorization',
          args: [from, backendAddress, amountAtomic, validAfter, validBefore, nonce, v, r, s],
          chain,
          account,
        });
        await publicClient.waitForTransactionReceipt({ hash: transferTx });
        logger.info('usdc transferred from user to backend for vault deposit', {
          from,
          to: backendAddress,
          amount: parsed.amount,
          txHash: transferTx,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResponse(400, 'TRANSFER_FAILED', `USDC transfer failed: ${msg}`);
      }

      // Step 3: Approve vault to pull USDC from backend
      const approveTx = await walletClient.writeContract({
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: 'approve',
        args: [vaultAddress, amountAtomic],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      // Step 4: Deposit into vault
      const depositTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [tokenId, amountAtomic],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: depositTx });

      logger.info('vault deposit completed', {
        agentId: id,
        domain: agent.domain,
        amount: parsed.amount,
        depositTxHash: depositTx,
        depositor: from,
      });

      // Step 5: Auto-enable auto-renew if not already enabled
      const isAutoRenew = await publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'autoRenewEnabled',
        args: [tokenId],
      });

      let autoRenewTxHash: string | null = null;
      if (!isAutoRenew) {
        try {
          const autoRenewTx = await walletClient.writeContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'setAutoRenew',
            args: [tokenId, true],
            chain,
            account,
          });
          await publicClient.waitForTransactionReceipt({ hash: autoRenewTx });
          autoRenewTxHash = autoRenewTx;
          logger.info('auto-renew enabled via deposit', { agentId: id, domain: agent.domain });
        } catch (e) {
          logger.warn('failed to auto-enable renew (non-fatal)', {
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const newBalance = await publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'balanceOfToken',
        args: [tokenId],
      });

      return NextResponse.json({
        success: true,
        depositTxHash: depositTx,
        autoRenewEnabled: true,
        autoRenewTxHash,
        vaultBalance: (newBalance as bigint).toString(),
        agentId: id,
        domain: agent.domain,
      });
    },
    { route: '/agents/[id]/renewal/fund:POST' },
  );
}
