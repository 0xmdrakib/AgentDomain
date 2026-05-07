import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalAddress = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
);
const optionalPrivateKey = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
);

/**
 * Server-side environment variables, parsed and validated at startup.
 * Throws a readable error if any required value is missing.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: optionalUrl,
  REDIS_URL: optionalUrl,

  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  BASE_SEPOLIA_RPC_URL: z.string().url().default('https://sepolia.base.org'),
  BASE_CHAIN_ID: z.coerce.number().default(8453),
  ETHEREUM_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),

  PAYMENT_ROUTER_ADDRESS: optionalAddress,
  IDENTITY_REGISTRY_ADDRESS: optionalAddress,
  RENEWAL_VAULT_ADDRESS: optionalAddress,
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),

  TREASURY_ADDRESS: optionalAddress,
  BACKEND_PRIVATE_KEY: optionalPrivateKey,

  X402_FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator'),
  X402_NETWORK: z.enum(['base', 'base-sepolia']).default('base'),

  LIFI_API_URL: z.string().url().default('https://li.quest/v1'),
  LIFI_API_KEY: optionalString,
  LIFI_INTEGRATOR: z.string().default('agentdomain'),
  LIFI_REFERRER: optionalString,
  LIFI_SLIPPAGE: z.coerce.number().min(0).max(1).default(0.01),
  LIFI_MAX_WAIT_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),

  // Spaceship registrar (https://docs.spaceship.dev)
  SPACESHIP_API_KEY: optionalString,
  SPACESHIP_API_SECRET: optionalString,

  // Platform owner contact info — used as registrant for all domains.
  // These are YOUR details as the platform operator.
  // All domains register under your Spaceship account (normal for resellers).
  SPACESHIP_CONTACT_FIRST_NAME: optionalString,
  SPACESHIP_CONTACT_LAST_NAME: optionalString,
  SPACESHIP_CONTACT_EMAIL: optionalEmail,
  SPACESHIP_CONTACT_PHONE: optionalString, // Format: +1.8001234567
  SPACESHIP_CONTACT_ADDRESS: optionalString,
  SPACESHIP_CONTACT_CITY: optionalString,
  SPACESHIP_CONTACT_STATE: optionalString,
  SPACESHIP_CONTACT_POSTAL_CODE: optionalString,
  SPACESHIP_CONTACT_COUNTRY: z.string().default('US'),
  SPACESHIP_CONTACT_ORGANIZATION: optionalString,

  // Auto-created on first use and cached here to avoid recreating every time.
  // Leave blank initially — the system will create it automatically.
  SPACESHIP_DEFAULT_CONTACT_ID: optionalString,

  CLOUDFLARE_API_TOKEN: optionalString,
  CLOUDFLARE_ACCOUNT_ID: optionalString,

  RESEND_API_KEY: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  PINATA_JWT: optionalString,

  TURNSTILE_SECRET_KEY: optionalString,
  TURNSTILE_REQUIRED: z.enum(['true', 'false']).default('true'),

  ADMIN_ADDRESSES: optionalString,
  CRON_SECRET: optionalString,

  ACME_ACCOUNT_PRIVATE_KEY: optionalString,
  ACME_CONTACT_EMAIL: optionalEmail,
  ACME_DIRECTORY_URL: optionalUrl,
  SSL_CERT_ENCRYPTION_KEY: optionalString,

  SENTRY_DSN: optionalUrl,
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3000/api'),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().default(8453),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
});

let _serverEnv: z.infer<typeof serverSchema> | undefined;
let _clientEnv: z.infer<typeof clientSchema> | undefined;

export function getServerEnv() {
  if (_serverEnv) return _serverEnv;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid server env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid server environment configuration');
  }
  _serverEnv = parsed.data;
  return _serverEnv;
}

export function getClientEnv() {
  if (_clientEnv) return _clientEnv;
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });
  if (!parsed.success) {
    throw new Error('Invalid client environment configuration');
  }
  _clientEnv = parsed.data;
  return _clientEnv;
}
