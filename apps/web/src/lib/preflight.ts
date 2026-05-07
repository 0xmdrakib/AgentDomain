import { sql } from 'drizzle-orm';
import { getAddress, isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getDb } from '@/db';
import { getEthereumPublicClient, getPublicClient } from '@/lib/chain';
import { AGENT_IDENTITY_REGISTRY_ABI, PAYMENT_ROUTER_ABI, RENEWAL_VAULT_ABI } from '@/lib/abis';
import { ENS_MAINNET, ETHEREUM_MAINNET_CHAIN_ID } from '@agentdomain/shared';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  status: PreflightStatus;
  message: string;
  latencyMs?: number;
  details?: Record<string, boolean | number | string | string[]>;
}

export interface PreflightReport {
  status: 'ready' | 'warning' | 'blocked';
  generatedAt: string;
  checks: Record<string, PreflightCheck>;
}

interface PreflightOptions {
  external?: boolean;
}

const BASE_MAINNET_CHAIN_ID = 8453;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const REQUIRED_WEB_ENV = [
  'DATABASE_URL',
  'BASE_RPC_URL',
  'BASE_CHAIN_ID',
  'ETHEREUM_RPC_URL',
  'PAYMENT_ROUTER_ADDRESS',
  'IDENTITY_REGISTRY_ADDRESS',
  'RENEWAL_VAULT_ADDRESS',
  'USDC_ADDRESS',
  'TREASURY_ADDRESS',
  'BACKEND_PRIVATE_KEY',
  'X402_FACILITATOR_URL',
  'X402_NETWORK',
  'SPACESHIP_API_KEY',
  'SPACESHIP_API_SECRET',
  'SPACESHIP_CONTACT_FIRST_NAME',
  'SPACESHIP_CONTACT_LAST_NAME',
  'SPACESHIP_CONTACT_EMAIL',
  'SPACESHIP_CONTACT_PHONE',
  'SPACESHIP_CONTACT_ADDRESS',
  'SPACESHIP_CONTACT_CITY',
  'SPACESHIP_CONTACT_STATE',
  'SPACESHIP_CONTACT_POSTAL_CODE',
  'SPACESHIP_CONTACT_COUNTRY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'PINATA_JWT',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_REQUIRED',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_CHAIN_ID',
] as const;

const REQUIRED_SSL_ENV = [
  'ACME_ACCOUNT_PRIVATE_KEY',
  'ACME_CONTACT_EMAIL',
  'SSL_CERT_ENCRYPTION_KEY',
] as const;

const REQUIRED_OPERATION_ENV = ['ADMIN_ADDRESSES', 'CRON_SECRET'] as const;

const REQUIRED_TABLES = [
  'agents',
  'registrations',
  'dns_records',
  'email_inboxes',
  'email_messages',
  'email_blocklist',
  'renewals',
  'ssl_certificates',
] as const;

export async function runProductionPreflight(
  opts: PreflightOptions = {},
): Promise<PreflightReport> {
  const checks: Record<string, PreflightCheck> = {};

  checks.env = checkEnvironment();
  checks.database = await timedCheck(() => checkDatabase(), 'database preflight failed');
  checks.rpc = await timedCheck(() => checkRpc(), 'Base RPC preflight failed');
  checks.ethereumRpc = await timedCheck(() => checkEthereumRpc(), 'Ethereum RPC preflight failed');
  checks.contractBytecode = await timedCheck(
    () => checkContractBytecode(),
    'contract bytecode preflight failed',
  );
  checks.ensContracts = await timedCheck(
    () => checkEnsContracts(),
    'ENS contract preflight failed',
  );
  checks.contractWiring = await timedCheck(
    () => checkContractWiring(),
    'contract wiring preflight failed',
  );

  if (opts.external) {
    checks.cloudflare = await timedCheck(
      () => checkCloudflareToken(),
      'Cloudflare token preflight failed',
    );
    checks.pinata = await timedCheck(() => checkPinataToken(), 'Pinata token preflight failed');
    checks.resend = await timedCheck(() => checkResendToken(), 'Resend token preflight failed');
    checks.spaceship = await timedCheck(
      () => checkSpaceshipAvailability(),
      'Spaceship token preflight failed',
    );
    checks.lifi = await timedCheck(() => checkLifiApi(), 'LI.FI API preflight failed');
  }

  const values = Object.values(checks);
  const status = values.some((check) => check.status === 'fail')
    ? 'blocked'
    : values.some((check) => check.status === 'warn')
      ? 'warning'
      : 'ready';

  return {
    status,
    generatedAt: new Date().toISOString(),
    checks,
  };
}

function checkEnvironment(): PreflightCheck {
  const missingRequired = [...REQUIRED_WEB_ENV, ...REQUIRED_SSL_ENV].filter((key) => !hasEnv(key));
  const missingOps = REQUIRED_OPERATION_ENV.filter((key) => !hasEnv(key));
  const warnings: string[] = [];

  if (process.env.BASE_CHAIN_ID !== String(BASE_MAINNET_CHAIN_ID)) {
    warnings.push('BASE_CHAIN_ID is not Base mainnet');
  }
  if (process.env.NEXT_PUBLIC_CHAIN_ID !== String(BASE_MAINNET_CHAIN_ID)) {
    warnings.push('NEXT_PUBLIC_CHAIN_ID is not Base mainnet');
  }
  if (process.env.X402_NETWORK !== 'base') {
    warnings.push('X402_NETWORK is not base');
  }
  if (process.env.TURNSTILE_REQUIRED !== 'true') {
    warnings.push('TURNSTILE_REQUIRED is not true');
  }
  if (!hasEnv('ACME_DIRECTORY_URL')) {
    warnings.push('ACME_DIRECTORY_URL is not set; SSL worker depends on NODE_ENV default');
  }
  for (const key of [
    'PAYMENT_ROUTER_ADDRESS',
    'IDENTITY_REGISTRY_ADDRESS',
    'RENEWAL_VAULT_ADDRESS',
    'USDC_ADDRESS',
    'TREASURY_ADDRESS',
  ]) {
    const value = process.env[key];
    if (value && !isAddress(value)) warnings.push(`${key} is not a valid address`);
  }
  if (
    process.env.BACKEND_PRIVATE_KEY &&
    !/^0x[a-fA-F0-9]{64}$/.test(process.env.BACKEND_PRIVATE_KEY)
  ) {
    warnings.push('BACKEND_PRIVATE_KEY has invalid format');
  }
  if (
    process.env.SSL_CERT_ENCRYPTION_KEY &&
    !isLikelyEncryptionKey(process.env.SSL_CERT_ENCRYPTION_KEY)
  ) {
    warnings.push('SSL_CERT_ENCRYPTION_KEY should be base64:32-byte-key or 64-char hex');
  }

  if (missingRequired.length > 0) {
    return {
      status: 'fail',
      message: 'Required production env keys are missing or empty',
      details: { missing: missingRequired },
    };
  }

  if (missingOps.length > 0 || warnings.length > 0) {
    return {
      status: 'warn',
      message: 'Core env is present, but operational settings need attention',
      details: { missingOperational: missingOps, warnings },
    };
  }

  return { status: 'pass', message: 'Production env is complete' };
}

async function checkDatabase(): Promise<PreflightCheck> {
  if (!hasEnv('DATABASE_URL')) return fail('DATABASE_URL is not configured');

  const db = getDb();
  await db.execute(sql`select 1`);

  const tableRows = (await db.execute(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${sql.join(
        REQUIRED_TABLES.map((table) => sql`${table}`),
        sql`,`,
      )})
  `)) as unknown as { table_name: string }[];

  const found = new Set(tableRows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
  if (missing.length > 0) {
    return fail('Database is reachable, but required tables are missing', { missing });
  }

  return pass('Database is reachable and migrations appear applied', {
    checkedTables: REQUIRED_TABLES.length,
  });
}

async function checkRpc(): Promise<PreflightCheck> {
  const client = getPublicClient();
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);

  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    return fail('RPC is not connected to Base mainnet', { chainId });
  }

  return pass('Base RPC is reachable', { chainId, blockNumber: blockNumber.toString() });
}

async function checkEthereumRpc(): Promise<PreflightCheck> {
  const client = getEthereumPublicClient();
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);

  if (chainId !== ETHEREUM_MAINNET_CHAIN_ID) {
    return fail('RPC is not connected to Ethereum mainnet', { chainId });
  }

  return pass('Ethereum RPC is reachable', { chainId, blockNumber: blockNumber.toString() });
}

async function checkContractBytecode(): Promise<PreflightCheck> {
  const addresses = getRequiredAddresses();
  if ('error' in addresses) return fail(addresses.error);

  const client = getPublicClient();
  const results = [
    await hasBytecode(client, addresses.identityRegistry),
    await hasBytecode(client, addresses.paymentRouter),
    await hasBytecode(client, addresses.renewalVault),
    await hasBytecode(client, addresses.usdc),
  ];

  const [identityRegistry, paymentRouter, renewalVault, usdc] = results;
  const missing = [
    ['IDENTITY_REGISTRY_ADDRESS', identityRegistry],
    ['PAYMENT_ROUTER_ADDRESS', paymentRouter],
    ['RENEWAL_VAULT_ADDRESS', renewalVault],
    ['USDC_ADDRESS', usdc],
  ]
    .filter(([, ok]) => !ok)
    .map(([name]) => String(name));

  if (missing.length > 0) {
    return fail('One or more configured contract addresses have no bytecode', { missing });
  }

  return pass('Configured contract addresses have bytecode');
}

async function checkEnsContracts(): Promise<PreflightCheck> {
  const client = getEthereumPublicClient();
  const entries = {
    ENS_REGISTRY: ENS_MAINNET.registry,
    ENS_BASE_REGISTRAR: ENS_MAINNET.baseRegistrar,
    ENS_REGISTRAR_CONTROLLER: ENS_MAINNET.registrarController,
    ENS_PUBLIC_RESOLVER: ENS_MAINNET.publicResolver,
    ETH_USD_PRICE_FEED: ENS_MAINNET.ethUsdPriceFeed,
  } as const;

  const checks = await Promise.all(
    Object.entries(entries).map(async ([name, address]) => [
      name,
      await hasBytecode(client, address),
    ]),
  );
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => String(name));

  if (missing.length > 0) {
    return fail('One or more ENS dependency addresses have no bytecode', { missing });
  }

  return pass('ENS dependency contracts have bytecode');
}

async function checkContractWiring(): Promise<PreflightCheck> {
  const addresses = getRequiredAddresses();
  if ('error' in addresses) return fail(addresses.error);

  const backend = getBackendAddress();
  if ('error' in backend) return fail(backend.error);

  const client = getPublicClient();
  const reads = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: addresses.identityRegistry,
        abi: AGENT_IDENTITY_REGISTRY_ABI,
        functionName: 'minters',
        args: [addresses.paymentRouter],
      },
      {
        address: addresses.identityRegistry,
        abi: AGENT_IDENTITY_REGISTRY_ABI,
        functionName: 'renewalVault',
      },
      { address: addresses.paymentRouter, abi: PAYMENT_ROUTER_ABI, functionName: 'registry' },
      { address: addresses.paymentRouter, abi: PAYMENT_ROUTER_ABI, functionName: 'usdc' },
      { address: addresses.paymentRouter, abi: PAYMENT_ROUTER_ABI, functionName: 'treasury' },
      {
        address: addresses.paymentRouter,
        abi: PAYMENT_ROUTER_ABI,
        functionName: 'authorizedBackend',
      },
      { address: addresses.paymentRouter, abi: PAYMENT_ROUTER_ABI, functionName: 'paused' },
      { address: addresses.renewalVault, abi: RENEWAL_VAULT_ABI, functionName: 'registry' },
      { address: addresses.renewalVault, abi: RENEWAL_VAULT_ABI, functionName: 'nft' },
      { address: addresses.renewalVault, abi: RENEWAL_VAULT_ABI, functionName: 'usdc' },
      { address: addresses.renewalVault, abi: RENEWAL_VAULT_ABI, functionName: 'treasury' },
      {
        address: addresses.renewalVault,
        abi: RENEWAL_VAULT_ABI,
        functionName: 'keepers',
        args: [backend.address],
      },
    ],
  });

  const registryMinterAllowed = readMulticallResult<boolean>(reads, 0, 'registry.minters');
  const registryRenewalVault = readMulticallResult<Address>(reads, 1, 'registry.renewalVault');
  const paymentRegistry = readMulticallResult<Address>(reads, 2, 'payment.registry');
  const paymentUsdc = readMulticallResult<Address>(reads, 3, 'payment.usdc');
  const paymentTreasury = readMulticallResult<Address>(reads, 4, 'payment.treasury');
  const paymentBackend = readMulticallResult<Address>(reads, 5, 'payment.authorizedBackend');
  const paymentPaused = readMulticallResult<boolean>(reads, 6, 'payment.paused');
  const renewalRegistry = readMulticallResult<Address>(reads, 7, 'renewal.registry');
  const renewalNft = readMulticallResult<Address>(reads, 8, 'renewal.nft');
  const renewalUsdc = readMulticallResult<Address>(reads, 9, 'renewal.usdc');
  const renewalTreasury = readMulticallResult<Address>(reads, 10, 'renewal.treasury');
  const renewalKeeperAllowed = readMulticallResult<boolean>(reads, 11, 'renewal.keepers');

  const failures: string[] = [];
  const warnings: string[] = [];

  if (!registryMinterAllowed) failures.push('PaymentRouter is not an allowed registry minter');
  if (!sameAddress(registryRenewalVault, addresses.renewalVault))
    failures.push('Registry renewalVault mismatch');
  if (!sameAddress(paymentRegistry, addresses.identityRegistry))
    failures.push('PaymentRouter registry mismatch');
  if (!sameAddress(paymentUsdc, addresses.usdc)) failures.push('PaymentRouter USDC mismatch');
  if (!sameAddress(paymentTreasury, addresses.treasury))
    failures.push('PaymentRouter treasury mismatch');
  if (!sameAddress(paymentBackend, backend.address))
    failures.push('PaymentRouter backend mismatch');
  if (paymentPaused) warnings.push('PaymentRouter is paused');
  if (!sameAddress(renewalRegistry, addresses.identityRegistry))
    failures.push('RenewalVault registry mismatch');
  if (!sameAddress(renewalNft, addresses.identityRegistry))
    failures.push('RenewalVault NFT mismatch');
  if (!sameAddress(renewalUsdc, addresses.usdc)) failures.push('RenewalVault USDC mismatch');
  if (!sameAddress(renewalTreasury, addresses.treasury))
    failures.push('RenewalVault treasury mismatch');
  if (!renewalKeeperAllowed) failures.push('Backend wallet is not an allowed renewal keeper');

  if (failures.length > 0) {
    return fail('Contract wiring is incomplete or mismatched', { failures, warnings });
  }
  if (warnings.length > 0) {
    return warn('Contract wiring is valid with warnings', { warnings });
  }

  return pass('Contract wiring is correct');
}

async function checkCloudflareToken(): Promise<PreflightCheck> {
  if (!hasEnv('CLOUDFLARE_API_TOKEN')) return fail('CLOUDFLARE_API_TOKEN is not configured');
  const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return fail(`Cloudflare token verify returned HTTP ${res.status}`);
  const body = (await res.json()) as { success?: boolean };
  return body.success ? pass('Cloudflare token verified') : fail('Cloudflare token verify failed');
}

async function checkPinataToken(): Promise<PreflightCheck> {
  if (!hasEnv('PINATA_JWT')) return fail('PINATA_JWT is not configured');
  const res = await fetch('https://api.pinata.cloud/data/testAuthentication', {
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    cache: 'no-store',
  });
  return res.ok ? pass('Pinata token verified') : fail(`Pinata auth returned HTTP ${res.status}`);
}

async function checkResendToken(): Promise<PreflightCheck> {
  if (!hasEnv('RESEND_API_KEY')) return fail('RESEND_API_KEY is not configured');
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    cache: 'no-store',
  });
  return res.ok
    ? pass('Resend token verified')
    : fail(`Resend domains returned HTTP ${res.status}`);
}

async function checkSpaceshipAvailability(): Promise<PreflightCheck> {
  if (!hasEnv('SPACESHIP_API_KEY') || !hasEnv('SPACESHIP_API_SECRET')) {
    return fail('Spaceship credentials are not configured');
  }

  const domain = `agentdomain-preflight-${Date.now()}.xyz`;
  const res = await fetch(`https://spaceship.dev/api/v1/domains/${domain}/availability`, {
    headers: {
      'X-Api-Key': process.env.SPACESHIP_API_KEY!,
      'X-Api-Secret': process.env.SPACESHIP_API_SECRET!,
    },
    cache: 'no-store',
  });
  return res.ok
    ? pass('Spaceship availability API reachable')
    : fail(`Spaceship returned HTTP ${res.status}`);
}

async function checkLifiApi(): Promise<PreflightCheck> {
  const baseUrl = trimTrailingSlash(process.env.LIFI_API_URL ?? 'https://li.quest/v1');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.LIFI_API_KEY) headers['x-lifi-api-key'] = process.env.LIFI_API_KEY;

  const res = await fetch(`${baseUrl}/chains?chainTypes=EVM`, {
    headers,
    cache: 'no-store',
  });
  return res.ok ? pass('LI.FI API is reachable') : fail(`LI.FI returned HTTP ${res.status}`);
}

async function timedCheck(
  fn: () => Promise<PreflightCheck>,
  fallbackMessage: string,
): Promise<PreflightCheck> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return { ...result, latencyMs: Date.now() - startedAt };
  } catch (e) {
    return {
      status: 'fail',
      message: fallbackMessage,
      latencyMs: Date.now() - startedAt,
      details: { error: sanitizeError(e) },
    };
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/0x[a-fA-F0-9]{64}/g, '0x[redacted-hex-64]')
    .replace(/0x[a-fA-F0-9]{40}/g, '0x[redacted-address]')
    .replace(/Authorization: Bearer\s+[^\s]+/gi, 'Authorization: Bearer [redacted]');
}

function hasEnv(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function getRequiredAddresses():
  | {
      identityRegistry: Address;
      paymentRouter: Address;
      renewalVault: Address;
      usdc: Address;
      treasury: Address;
    }
  | { error: string } {
  const entries = {
    identityRegistry: process.env.IDENTITY_REGISTRY_ADDRESS,
    paymentRouter: process.env.PAYMENT_ROUTER_ADDRESS,
    renewalVault: process.env.RENEWAL_VAULT_ADDRESS,
    usdc: process.env.USDC_ADDRESS,
    treasury: process.env.TREASURY_ADDRESS,
  };

  for (const [name, value] of Object.entries(entries)) {
    if (!value || !isAddress(value) || sameAddress(value, ZERO_ADDRESS)) {
      return { error: `${name} is missing or invalid` };
    }
  }

  return {
    identityRegistry: getAddress(entries.identityRegistry!),
    paymentRouter: getAddress(entries.paymentRouter!),
    renewalVault: getAddress(entries.renewalVault!),
    usdc: getAddress(entries.usdc!),
    treasury: getAddress(entries.treasury!),
  };
}

function getBackendAddress(): { address: Address } | { error: string } {
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    return { error: 'BACKEND_PRIVATE_KEY is missing or invalid' };
  }
  return { address: privateKeyToAccount(privateKey as `0x${string}`).address };
}

async function hasBytecode(
  client: { getBytecode: (args: { address: Address }) => Promise<`0x${string}` | undefined> },
  address: Address,
): Promise<boolean> {
  const bytecode = await client.getBytecode({ address });
  return Boolean(bytecode && bytecode !== '0x');
}

function readMulticallResult<T>(
  reads: readonly { status: 'success' | 'failure'; result?: unknown; error?: Error }[],
  index: number,
  label: string,
): T {
  const read = reads[index];
  if (!read) throw new Error(`${label} read missing`);
  if (read.status === 'failure') {
    throw new Error(`${label} read failed: ${read.error?.message ?? 'unknown error'}`);
  }
  return read.result as T;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isLikelyEncryptionKey(value: string): boolean {
  if (/^[a-fA-F0-9]{64}$/.test(value)) return true;
  if (!value.startsWith('base64:')) return false;
  try {
    return Buffer.from(value.slice('base64:'.length), 'base64').length === 32;
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function pass(message: string, details?: PreflightCheck['details']): PreflightCheck {
  return { status: 'pass', message, details };
}

function warn(message: string, details?: PreflightCheck['details']): PreflightCheck {
  return { status: 'warn', message, details };
}

function fail(message: string, details?: PreflightCheck['details']): PreflightCheck {
  return { status: 'fail', message, details };
}
