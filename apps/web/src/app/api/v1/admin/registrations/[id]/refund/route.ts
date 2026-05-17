import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseUnits, type Address } from 'viem';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { registrationsRepo } from '@/db';
import { getBackendWalletClient, getContractAddresses } from '@/lib/chain';
import { logger } from '@/lib/logger';
import { USDC_DECIMALS } from '@agentdomain/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/refund' });

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const schema = z.object({
  reason: z.string().min(3).max(500),
  /**
   * If true, the backend wallet sends USDC from treasury back to payer.
   * Requires the backend wallet to have authority over treasury (or for treasury
   * to be the backend wallet). Defaults false — admin records the refund
   * intent but does not auto-execute.
   */
  executeOnChain: z.boolean().default(false),
});

/**
 * POST /api/v1/admin/registrations/{id}/refund
 *
 * Mark a failed registration as refunded. Optionally execute the on-chain
 * transfer (if the backend wallet has access to treasury funds).
 *
 * Use case: a registration failed after USDC was settled but before NFT minted.
 * The treasury holds the USDC; admin processes a refund to the original payer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const parsed = await parseBody(req, schema);
    if (parsed instanceof Response) return parsed;

    const reg = await registrationsRepo.getById(id);
    if (!reg) return errorResponse(404, 'NOT_FOUND', 'Registration not found');

    if (reg.status !== 'failed') {
      return errorResponse(
        400,
        'NOT_REFUNDABLE',
        `Registration status is '${reg.status}'; only 'failed' rows are refundable`,
      );
    }

    let onChainTxHash: string | undefined;

    if (parsed.executeOnChain) {
      try {
        const { usdc } = getContractAddresses();
        const wallet = getBackendWalletClient();
        const amountAtomic = parseUnits(reg.paymentAmount, USDC_DECIMALS);

        onChainTxHash = await wallet.writeContract({
          address: usdc,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [reg.payerAddress as Address, amountAtomic],
          chain: wallet.chain,
          account: wallet.account!,
        });

        log.info('refund tx sent', {
          registrationId: id,
          txHash: onChainTxHash,
          amount: reg.paymentAmount,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('refund tx failed', { id, err: msg });
        return errorResponse(500, 'TX_FAILED', `On-chain refund failed: ${msg}`);
      }
    }

    // Append to error message for audit trail (don't overwrite the original)
    const auditNote = `[REFUNDED by ${auth.address} at ${new Date().toISOString()}: ${parsed.reason}]${
      onChainTxHash ? ` tx=${onChainTxHash}` : ''
    }`;
    await registrationsRepo.update(id, {
      errorMessage: reg.errorMessage ? `${reg.errorMessage}\n${auditNote}` : auditNote,
    });

    return NextResponse.json({
      ok: true,
      registrationId: id,
      amount: reg.paymentAmount,
      payer: reg.payerAddress,
      onChainTxHash,
      executed: !!onChainTxHash,
    });
  }, { route: '/admin/refund' });
}
