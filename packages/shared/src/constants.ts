export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const BASE_CHAIN_ID = 8453;
export const USDC_DECIMALS = 6;
export const RENEWAL_TRIGGER_DAYS_BEFORE = 30;
export const MIN_COMMITMENT_AGE_SECONDS = 60;
export const MIN_REGISTRATION_DURATION_SECONDS = 31_536_000;
export const SERVICE_FEE_USDC_ATOMIC = 2_000_000n;
export const BASENAME_FEE_USDC_ATOMIC = 0n;
export const ENS_FEE_USDC_ATOMIC = 0n;
export const BASENAME_PRICE_BUFFER_BPS = 12_000n;
export const BASENAME_REGISTRATION_GAS_UNITS = 400_000n;
export const ENS_PRICE_BUFFER_BPS = 12_000n;
export const ENS_L1_REGISTRATION_GAS_UNITS = 250_000n;
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const X402_PAYMENT_HEADER = 'X-Payment';
export const X402_PAYMENT_REQUIRED_HEADER = 'X-Payment-Required';

export const ENS_MAINNET = {
  registrarController: '0x253553366Da8546fC250F225fe3d25d0C782303b',
  publicResolver: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63',
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  baseRegistrar: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85',
  ethUsdPriceFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
} as const;

export const BASENAMES_MAINNET = {
  registrarController: '0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5',
  l2Resolver: '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD',
} as const;

export const BASENAMES_SEPOLIA = {
  registrarController: '0xCa0dDD5D1BEC2e87C32Bb4dDFB07D49f77D62A1D',
  l2Resolver: '0x6533C94869Be28B161C2FB3cBaE96C4255C3Bb28',
} as const;

export const SUPPORTED_TLDS = [
  'xyz',
  'com',
  'ai',
  'org',
  'io',
  'net',
  'co',
  'app',
  'dev',
  'me',
  'info',
  'biz',
  'us',
  'uk',
  'de',
  'fr',
  'jp',
  'kr',
  'cn',
  'ru',
] as const;

export const PRIMARY_SUPPORTED_TLDS = ['xyz', 'com', 'ai', 'org', 'io', 'net', 'co', 'app'] as const;

export const ADDITIONAL_SUPPORTED_TLDS = SUPPORTED_TLDS.filter(
  (tld) => !PRIMARY_SUPPORTED_TLDS.includes(tld as (typeof PRIMARY_SUPPORTED_TLDS)[number]),
);

export const SUPPORTED_FRAMEWORKS = [
  'agentkit',
  'eliza',
  'crewai',
  'langchain',
  'openai',
  'anthropic',
] as const;
