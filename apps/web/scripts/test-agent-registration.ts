/**
 * End-to-end agent registration test script.
 *
 * এটা চালাও contract deploy করার পরে:
 *   pnpm --filter @agentdomain/web exec tsx scripts/test-agent-registration.ts
 *
 * Required .env.local values:
 *   - DATABASE_URL
 *   - SPACESHIP_API_KEY + SPACESHIP_API_SECRET
 *   - CLOUDFLARE_API_TOKEN + CLOUDFLARE_SAAS_ZONE_ID
 *   - PINATA_JWT
 *   - PAYMENT_ROUTER_ADDRESS
 *   - IDENTITY_REGISTRY_ADDRESS
 *   - RENEWAL_VAULT_ADDRESS
 *   - BACKEND_PRIVATE_KEY
 *   - TREASURY_ADDRESS
 *   - TEST_AGENT_PRIVATE_KEY  (a test wallet with Base mainnet USDC)
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
loadEnv({ path: resolve(webRoot, '.env.local'), override: true });

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  const agentPK = process.env.TEST_AGENT_PRIVATE_KEY;
  if (!agentPK) {
    console.error('TEST_AGENT_PRIVATE_KEY not set. Add a test wallet private key.');
    process.exit(1);
  }

  const account = privateKeyToAccount(agentPK as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http() });
  const publicClient = createPublicClient({ chain: base, transport: http() });

  console.log('\n=== AgentDomain Agent Registration Test ===');
  console.log('Agent wallet:', account.address);

  // 1. Check USDC balance
  const usdcBalance = (await publicClient.readContract({
    address: USDC_ADDRESS as Address,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;

  console.log(`USDC Balance: $${formatUnits(usdcBalance, 6)}`);
  if (usdcBalance < parseUnits('15', 6)) {
    console.error('Insufficient USDC. Need at least $15 on Base mainnet.');
    process.exit(1);
  }

  // 2. Check domain availability
  const preferredName = `test-agent-${Date.now()}`;
  const tld = 'xyz';
  console.log(`\nChecking availability: ${preferredName}.${tld}`);

  const availRes = await fetch(`${API_BASE}/domains/availability?name=${preferredName}&tld=${tld}`);
  const avail = (await availRes.json()) as { available: boolean };
  console.log('Available:', avail.available);
  if (!avail.available) {
    console.error('Domain not available');
    process.exit(1);
  }

  // 3. Get quote
  const quoteRes = await fetch(
    `${API_BASE}/agents/quote?preferredName=${preferredName}&tld=${tld}&registerBasename=true&registerEns=false`,
  );
  const quote = (await quoteRes.json()) as { totalUsdc: string };
  console.log(`\nQuote: $${quote.totalUsdc} USDC`);

  // 4. Initial call to get 402
  console.log('\nStep 1: Calling register to get 402 challenge...');
  const initRes = await fetch(`${API_BASE}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: account.address,
      preferredName,
      tld,
      registerBasename: true,
    }),
  });

  if (initRes.status !== 402) {
    const body = await initRes.text();
    console.error('Expected 402, got:', initRes.status, body);
    process.exit(1);
  }
  console.log('✓ Got 402 Payment Required');

  const challengeHeader = initRes.headers.get('X-Payment-Required');
  if (!challengeHeader) {
    console.error('No X-Payment-Required header');
    process.exit(1);
  }
  const challenge = JSON.parse(challengeHeader) as {
    maxAmountRequired: string;
    payTo: Address;
    asset: Address;
    network: string;
    maxTimeoutSeconds: number;
  };
  console.log(
    `Payment required: $${formatUnits(BigInt(challenge.maxAmountRequired), 6)} USDC → ${challenge.payTo}`,
  );

  // 5. Sign EIP-3009 TransferWithAuthorization
  console.log('\nStep 2: Signing EIP-3009 payment...');
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (challenge.maxTimeoutSeconds ?? 300));
  const nonce = ('0x' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')) as `0x${string}`;

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: base.id,
      verifyingContract: challenge.asset,
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
      from: account.address,
      to: challenge.payTo,
      value: BigInt(challenge.maxAmountRequired),
      validAfter,
      validBefore,
      nonce,
    },
  });
  console.log('✓ Signed payment authorization');

  // 6. Build payment payload and retry
  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: challenge.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: challenge.payTo,
        value: challenge.maxAmountRequired,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(paymentPayload))));

  console.log('\nStep 3: Submitting payment and registering...');
  const finalRes = await fetch(`${API_BASE}/agents/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment': encoded,
    },
    body: JSON.stringify({
      wallet: account.address,
      preferredName,
      tld,
      registerBasename: true,
    }),
  });

  const result = await finalRes.json();
  if (!finalRes.ok) {
    console.error('Registration failed:', JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log('\n✅ REGISTRATION SUCCESSFUL!');
  console.log('Domain:', result.domain);
  console.log('Basename:', result.basename ?? 'n/a');
  console.log('NFT Token ID:', result.nftTokenId);
  console.log('TX Hash:', result.txHash);
  console.log('SSL Status:', result.sslStatus);
  console.log('Estimated Ready:', result.estimatedReadyAt);
}

main().catch((e) => {
  console.error('\n❌ Test failed:', e);
  process.exit(1);
});
