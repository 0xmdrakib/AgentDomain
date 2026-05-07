import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { lt, eq, and, sql } from 'drizzle-orm';
import { parseUsdc, RENEWAL_TRIGGER_DAYS_BEFORE, retry } from '@agentdomain/shared';
import { logger } from './logger';
import { agents, renewals } from './schema';

/**
 * Single keeper tick:
 *   1. Load env config
 *   2. Find agents expiring within RENEWAL_TRIGGER_DAYS_BEFORE
 *   3. For each, check on-chain vault balance + autoRenewEnabled
 *   4. If renewable, call RenewalVault.executeRenewal(tokenId, cost)
 *   5. Insert/update renewal row in DB
 */
export async function runTick(): Promise<void> {
  const env = parseEnv();
  const sqlClient = postgres(env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema: { agents, renewals } });

  const isMainnet = env.BASE_CHAIN_ID === 8453;
  const chain = isMainnet ? base : baseSepolia;
  const rpc = isMainnet ? env.BASE_RPC_URL : env.BASE_SEPOLIA_RPC_URL;
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as `0x${string}`);

  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

  // Find candidates
  const cutoff = new Date(Date.now() + RENEWAL_TRIGGER_DAYS_BEFORE * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select()
    .from(agents)
    .where(and(eq(agents.status, 'active'), lt(agents.expiresAt, cutoff)))
    .limit(50);

  logger.info('found renewal candidates', { count: candidates.length });

  const renewalCost = parseUsdc('12'); // $12 per renewal year

  for (const agent of candidates) {
    try {
      // 1. Read on-chain state
      const [autoRenew, balance, isRenewable] = await Promise.all([
        publicClient.readContract({
          address: env.RENEWAL_VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: 'autoRenewEnabled',
          args: [BigInt(agent.agentIdNft)],
        }),
        publicClient.readContract({
          address: env.RENEWAL_VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: 'balanceOfToken',
          args: [BigInt(agent.agentIdNft)],
        }),
        publicClient.readContract({
          address: env.RENEWAL_VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: 'isRenewable',
          args: [BigInt(agent.agentIdNft)],
        }),
      ]);

      if (!autoRenew) {
        logger.info('skipping: autoRenew disabled', { domain: agent.domain });
        continue;
      }
      if ((balance as bigint) < renewalCost) {
        logger.warn('skipping: insufficient vault balance', {
          domain: agent.domain,
          balance: (balance as bigint).toString(),
        });
        continue;
      }
      if (!isRenewable) {
        logger.info('skipping: not in renewal window yet', { domain: agent.domain });
        continue;
      }

      // 2. Execute renewal
      const txHash = await retry(async () =>
        walletClient.writeContract({
          address: env.RENEWAL_VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: 'executeRenewal',
          args: [BigInt(agent.agentIdNft), renewalCost],
          chain,
          account,
        }),
      );

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // 2.5 Call Spaceship API to renew the domain
      const currentExpiryDate = agent.expiresAt 
        ? agent.expiresAt.toISOString().split('T')[0] // API might expect YYYY-MM-DD
        : new Date().toISOString().split('T')[0];

      const spaceshipRes = await fetch(
        `${env.SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(agent.domain)}/renew`,
        {
          method: 'POST',
          headers: {
            'X-Api-Key': env.SPACESHIP_API_KEY,
            'X-Api-Secret': env.SPACESHIP_API_SECRET,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            years: 1,
            currentExpirationDate: currentExpiryDate,
          }),
        }
      );

      if (spaceshipRes.status !== 202) {
        throw new Error(`Spaceship API renewal failed: ${spaceshipRes.status} ${await spaceshipRes.text()}`);
      }

      logger.info('spaceship api renewal triggered', { domain: agent.domain });

      // 3. Persist
      await db.insert(renewals).values({
        agentId: agent.id,
        scheduledFor: new Date(),
        amount: '12',
        status: 'completed',
        txHash,
        completedAt: new Date(),
      });

      // 4. Update agent's expiry locally (extend by 1 year)
      const newExpiry = new Date(
        (agent.expiresAt?.getTime() ?? Date.now()) + 365 * 24 * 60 * 60 * 1000,
      );
      await db
        .update(agents)
        .set({ expiresAt: newExpiry, updatedAt: new Date() })
        .where(eq(agents.id, agent.id));

      logger.info('renewal executed', { domain: agent.domain, txHash, newExpiry });
    } catch (e) {
      logger.error('renewal failed for agent', {
        agentId: agent.id,
        err: e instanceof Error ? e.message : String(e),
      });
      await db.insert(renewals).values({
        agentId: agent.id,
        scheduledFor: new Date(),
        amount: '12',
        status: 'failed',
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await sqlClient.end();
}

function parseEnv() {
  const env = process.env;
  const keeperPrivateKey = env.KEEPER_PRIVATE_KEY ?? env.BACKEND_PRIVATE_KEY;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL required');
  if (!keeperPrivateKey) throw new Error('KEEPER_PRIVATE_KEY or BACKEND_PRIVATE_KEY required');
  if (!env.RENEWAL_VAULT_ADDRESS) throw new Error('RENEWAL_VAULT_ADDRESS required');
  if (!env.SPACESHIP_API_KEY) throw new Error('SPACESHIP_API_KEY required for domain renewals');
  if (!env.SPACESHIP_API_SECRET) throw new Error('SPACESHIP_API_SECRET required for domain renewals');
  
  return {
    DATABASE_URL: env.DATABASE_URL,
    KEEPER_PRIVATE_KEY: keeperPrivateKey,
    RENEWAL_VAULT_ADDRESS: env.RENEWAL_VAULT_ADDRESS as Address,
    BASE_CHAIN_ID: Number(env.BASE_CHAIN_ID ?? 8453),
    BASE_RPC_URL: env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    BASE_SEPOLIA_RPC_URL: env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    SPACESHIP_API_KEY: env.SPACESHIP_API_KEY,
    SPACESHIP_API_SECRET: env.SPACESHIP_API_SECRET,
    SPACESHIP_API_BASE: env.SPACESHIP_API_BASE ?? 'https://spaceship.dev/api',
  };
}

const VAULT_ABI = [
  {
    type: 'function',
    name: 'balanceOfToken',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'autoRenewEnabled',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isRenewable',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'executeRenewal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'cost', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;
