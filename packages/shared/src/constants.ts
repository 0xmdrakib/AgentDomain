export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const BASE_CHAIN_ID = 8453;
export const USDC_DECIMALS = 6;
export const RENEWAL_TRIGGER_DAYS_BEFORE = 30;
export const MIN_COMMITMENT_AGE_SECONDS = 60;
export const MIN_REGISTRATION_DURATION_SECONDS = 31_536_000;
export const SERVICE_FEE_USDC_ATOMIC = 3_900_000n;
export const EMAIL_FEE_USDC_ATOMIC = 0n;
export const SSL_CERTIFICATION_FEE_USDC_ATOMIC = 0n;
export const MINIMUM_RENEWAL_FEE_USDC_ATOMIC = SERVICE_FEE_USDC_ATOMIC;
export const BASENAME_FEE_USDC_ATOMIC = 0n;
export const ENS_FEE_USDC_ATOMIC = 0n;
export const BASENAME_PRICE_BUFFER_BPS = 12_000n;
export const BASENAME_REGISTRATION_GAS_UNITS = 400_000n;
export const BASENAME_RENEWAL_GAS_UNITS = 180_000n;
export const ENS_PRICE_BUFFER_BPS = 12_000n;
export const ENS_L1_REGISTRATION_GAS_UNITS = 250_000n;
export const ENS_L1_RENEWAL_GAS_UNITS = 180_000n;
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const X402_PAYMENT_HEADER = 'X-Payment';
export const X402_PAYMENT_REQUIRED_HEADER = 'X-Payment-Required';
export const AGENTDOMAIN_API_BASE_URL = 'https://agentdomain.app/api/v1';

export const SERVICE_PLAN_KEYS = ['included', 'pro', 'enterprise'] as const;
export const SERVICE_PLAN_INTERVALS = ['yearly'] as const;

export const SERVICE_PLAN_CATALOG = {
  included: {
    key: 'included',
    label: 'Included',
    yearlyPriceUsdcAtomic: 0n,
    limits: {
      emailPerHour: 10,
      emailPerDay: 100,
      apiKeys: 1,
      dnsRecords: 20,
      emailAliases: 0,
      emailRetentionDays: 180,
    },
    supportTier: 'standard',
    registryPriority: false,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    yearlyPriceUsdcAtomic: 59_000_000n,
    limits: {
      emailPerHour: 100,
      emailPerDay: 1_000,
      apiKeys: 5,
      dnsRecords: 100,
      emailAliases: 5,
      emailRetentionDays: 365,
    },
    supportTier: 'priority',
    registryPriority: false,
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    yearlyPriceUsdcAtomic: 590_000_000n,
    limits: {
      emailPerHour: 1_000,
      emailPerDay: 10_000,
      apiKeys: 25,
      dnsRecords: 500,
      emailAliases: 20,
      emailRetentionDays: 730,
    },
    supportTier: 'enterprise',
    registryPriority: true,
  },
} as const;

export const ENS_MAINNET = {
  registrarController: '0x253553366Da8546fC250F225fe3d25d0C782303b',
  publicResolver: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63',
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  baseRegistrar: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85',
  ethUsdPriceFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
} as const;

export const BASENAMES_MAINNET = {
  baseRegistrar: '0x03c4738ee98ae44591e1a4a4f3cab6641d95dd9a',
  registrarController: '0xa7d2607c6BD39Ae9521e514026CBB078405Ab322',
  l2Resolver: '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875',
} as const;

export const BASENAMES_SEPOLIA = {
  baseRegistrar: '0xa0c70ec36c010b55e3c434d6c6ebeec50c705794',
  registrarController: '0x82c858CDF64b3D893Fe54962680edFDDC37e94C8',
  l2Resolver: '0x85C87e548091f204C2d0350b39ce1874f02197c6',
} as const;

export const SUPPORTED_TLDS = ['xyz', 'com', 'ai', 'org', 'io', 'net', 'co', 'app'] as const;

export const PRIMARY_SUPPORTED_TLDS = SUPPORTED_TLDS;

export const SUPPORTED_FRAMEWORKS = [
  'agentkit',
  'eliza',
  'crewai',
  'langchain',
  'openai',
  'anthropic',
] as const;
