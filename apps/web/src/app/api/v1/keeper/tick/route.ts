import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { createPublicClient, createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { agentsRepo, renewalsRepo } from '@/db';
import { RENEWAL_TRIGGER_DAYS_BEFORE, retry } from '@agentdomain/shared';
import { logger } from '@/lib/logger';

// Standard ERC20 / Vault ABI fragment
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
    name: 'isRenewable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executeRenewal',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('upstash-signature');
    if (!signature) {
      return new NextResponse('Missing signature', { status: 401 });
    }

    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    if (!currentSigningKey || !nextSigningKey) {
      logger.error('QStash signing keys are not configured');
      return new NextResponse('Internal Server Error', { status: 500 });
    }

    const receiver = new Receiver({
      currentSigningKey,
      nextSigningKey,
    });

    const body = await req.text();
    const isValid = await receiver.verify({
      signature,
      body,
    });

    if (!isValid) {
      return new NextResponse('Invalid signature', { status: 401 });
    }

    logger.info('QStash keeper tick triggered');

    const isMainnet = process.env.NEXT_PUBLIC_BASE_CHAIN_ID === '8453';
    const chain = isMainnet ? base : baseSepolia;
    const rpc = isMainnet
      ? process.env.NEXT_PUBLIC_BASE_RPC_URL
      : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

    if (!process.env.BACKEND_PRIVATE_KEY) {
      logger.error('BACKEND_PRIVATE_KEY is not set');
      return new NextResponse('Internal Server Error', { status: 500 });
    }

    const account = privateKeyToAccount(process.env.BACKEND_PRIVATE_KEY as `0x${string}`);

    const publicClient = createPublicClient({ chain, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

    // Find candidates
    const cutoff = new Date(Date.now() + RENEWAL_TRIGGER_DAYS_BEFORE * 24 * 60 * 60 * 1000);
    const candidates = await agentsRepo.listExpiringBefore(cutoff, 50);

    logger.info('found renewal candidates', { count: candidates.length });

    const vaultAddress = process.env.NEXT_PUBLIC_RENEWAL_VAULT_ADDRESS as `0x${string}`;

    let renewedCount = 0;

    for (const agent of candidates) {
      // Compute the conservative per-agent renewal budget once so both the
      // success path and error reporting use the same amount.
      const domainCostUsdc = 12_000_000n; // $12 domain renewal
      const ensCostUsdc = agent.ensName ? 15_000_000n : 0n; // $15 ENS renewal (conservative)
      const bnsCostUsdc = agent.basename ? 5_000_000n : 0n; // $5 Basename renewal (conservative)
      const totalRenewalCost = domainCostUsdc + ensCostUsdc + bnsCostUsdc;

      try {
        if (!agent.agentIdNft) continue;

        logger.info('computed renewal cost', {
          domain: agent.domain,
          domainCost: '$12',
          ensCost: agent.ensName ? '$15' : '$0',
          bnsCost: agent.basename ? '$5' : '$0',
          totalCost: `$${Number(totalRenewalCost) / 1_000_000}`,
        });

        // 1. Read on-chain state
        const [autoRenew, balance, isRenewable] = await Promise.all([
          publicClient.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'autoRenewEnabled',
            args: [BigInt(agent.agentIdNft)],
          }),
          publicClient.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'balanceOfToken',
            args: [BigInt(agent.agentIdNft)],
          }),
          publicClient.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'isRenewable',
            args: [BigInt(agent.agentIdNft)],
          }),
        ]);

        if (!autoRenew) {
          logger.info('skipping: autoRenew disabled', { domain: agent.domain });
          continue;
        }
        if ((balance as bigint) < totalRenewalCost) {
          logger.warn('skipping: insufficient vault balance', {
            domain: agent.domain,
            balance: (balance as bigint).toString(),
            required: totalRenewalCost.toString(),
          });
          continue;
        }
        if (!isRenewable) {
          logger.info('skipping: not in renewal window yet', { domain: agent.domain });
          continue;
        }

        // ─── Step 2: Renew ICANN domain via Spaceship FIRST ─────────
        // Pre-flight: If Spaceship fails, we never touch the vault.
        const renewalDurationSeconds = 365 * 24 * 60 * 60;

        const currentExpiryDate = agent.expiresAt
          ? agent.expiresAt.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        const spaceshipRes = await fetch(
          `${process.env.SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(agent.domain)}/renew`,
          {
            method: 'POST',
            headers: {
              'X-Api-Key': process.env.SPACESHIP_API_KEY ?? '',
              'X-Api-Secret': process.env.SPACESHIP_API_SECRET ?? '',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              years: 1,
              currentExpirationDate: currentExpiryDate,
            }),
          },
        );

        if (spaceshipRes.status !== 202 && spaceshipRes.status !== 200) {
          throw new Error(
            `Spaceship API renewal failed: ${spaceshipRes.status} ${await spaceshipRes.text()}`,
          );
        }

        logger.info('domain renewed via spaceship', { domain: agent.domain });

        // ─── Step 3: Execute on-chain vault renewal (deducts USDC from vault) ───
        // The contract transfers totalRenewalCost to treasury internally —
        // we do NOT send a separate USDC transfer.
        const txHash = await retry(async () =>
          walletClient.writeContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'executeRenewal',
            args: [BigInt(agent.agentIdNft!)],
            chain,
            account,
          }),
        );

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        // ─── 2b: Renew ENS (.eth) if agent has one ───────────────────────
        if (agent.ensName) {
          try {
            const ensLabel = agent.ensName.replace('.eth', '');
            const { getEns } = await import('@/services/ens');
            const ens = getEns();

            // Ensure backend wallet has enough ETH on Ethereum L1
            const { getLifiFunding } = await import('@/services/lifi');
            const requiredWei = await ens.getRequiredWei(ensLabel, renewalDurationSeconds);
            await getLifiFunding().ensureNativeBalance({
              destination: 'ethereum',
              requiredWei,
              reason: `ens-renew:${agent.ensName}`,
            });

            const ensResult = await ens.renew({
              label: ensLabel,
              durationSeconds: renewalDurationSeconds,
            });
            logger.info('ens renewed', {
              ensName: agent.ensName,
              txHash: ensResult.txHash,
            });
          } catch (ensErr) {
            logger.error('ens renewal failed (non-fatal)', {
              ensName: agent.ensName,
              err: ensErr instanceof Error ? ensErr.message : String(ensErr),
            });
          }
        }

        // ─── 2c: Renew Basename (.base.eth) if agent has one ─────────────
        if (agent.basename) {
          try {
            const bnLabel = agent.basename.replace('.base.eth', '');
            const { getBasenames } = await import('@/services/basenames');
            const bn = getBasenames();

            // Ensure backend wallet has enough ETH on Base L2
            const { getLifiFunding } = await import('@/services/lifi');
            const requiredWei = await bn.getRequiredWei(bnLabel, renewalDurationSeconds);
            await getLifiFunding().ensureNativeBalance({
              destination: 'base',
              requiredWei,
              reason: `basename-renew:${agent.basename}`,
            });

            const bnResult = await bn.renew({
              label: bnLabel,
              durationSeconds: renewalDurationSeconds,
            });
            logger.info('basename renewed', {
              basename: agent.basename,
              txHash: bnResult.txHash,
            });
          } catch (bnErr) {
            logger.error('basename renewal failed (non-fatal)', {
              basename: agent.basename,
              err: bnErr instanceof Error ? bnErr.message : String(bnErr),
            });
          }
        }

        // 3. Persist renewal record
        const totalCostString = (Number(totalRenewalCost) / 1_000_000).toFixed(2);
        await renewalsRepo.create({
          agentId: agent.id,
          scheduledFor: new Date(),
          amount: totalCostString,
          status: 'completed',
          txHash,
          attemptCount: 1,
          lastError: null,
          completedAt: new Date(),
        });

        // 4. Update agent's expiry locally (extend by 1 year)
        const newExpiry = new Date(
          (agent.expiresAt?.getTime() ?? Date.now()) + 365 * 24 * 60 * 60 * 1000,
        );
        await agentsRepo.update(agent.id, { expiresAt: newExpiry, updatedAt: new Date() });

        logger.info('full renewal completed', {
          domain: agent.domain,
          ensName: agent.ensName ?? 'none',
          basename: agent.basename ?? 'none',
          txHash,
          newExpiry,
        });
        renewedCount++;
      } catch (e) {
        logger.error('renewal failed for agent', {
          agentId: agent.id,
          err: e instanceof Error ? e.message : String(e),
        });
        await renewalsRepo.create({
          agentId: agent.id,
          scheduledFor: new Date(),
          amount: (Number(totalRenewalCost) / 1_000_000).toFixed(2),
          status: 'failed',
          txHash: null,
          attemptCount: 1,
          lastError: e instanceof Error ? e.message : String(e),
          completedAt: null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: candidates.length,
      renewed: renewedCount,
    });
  } catch (error) {
    logger.error('Error processing keeper tick', { error });
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
