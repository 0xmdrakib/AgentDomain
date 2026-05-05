import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { base, baseSepolia, mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getServerEnv } from './env';

/**
 * Get a viem PublicClient for the configured Base network.
 */
export function getPublicClient() {
  const env = getServerEnv();
  const isMainnet = env.BASE_CHAIN_ID === 8453;
  return createPublicClient({
    chain: isMainnet ? base : baseSepolia,
    transport: http(isMainnet ? env.BASE_RPC_URL : env.BASE_SEPOLIA_RPC_URL),
  });
}

/**
 * Get a backend wallet client (used by the off-chain service to call PaymentRouter).
 */
export function getBackendWalletClient() {
  const env = getServerEnv();
  if (!env.BACKEND_PRIVATE_KEY) {
    throw new Error('BACKEND_PRIVATE_KEY is not configured');
  }
  const account = privateKeyToAccount(env.BACKEND_PRIVATE_KEY as `0x${string}`);
  const isMainnet = env.BASE_CHAIN_ID === 8453;
  return createWalletClient({
    account,
    chain: isMainnet ? base : baseSepolia,
    transport: http(isMainnet ? env.BASE_RPC_URL : env.BASE_SEPOLIA_RPC_URL),
  });
}

/**
 * Get an Ethereum mainnet PublicClient for ENS L1 registration.
 */
export function getEthereumPublicClient() {
  const env = getServerEnv();
  return createPublicClient({
    chain: mainnet,
    transport: http(env.ETHEREUM_RPC_URL),
  });
}

/**
 * Get the backend wallet on Ethereum mainnet for ENS commit/reveal.
 */
export function getEthereumBackendWalletClient() {
  const env = getServerEnv();
  if (!env.BACKEND_PRIVATE_KEY) {
    throw new Error('BACKEND_PRIVATE_KEY is not configured');
  }
  const account = privateKeyToAccount(env.BACKEND_PRIVATE_KEY as `0x${string}`);
  return createWalletClient({
    account,
    chain: mainnet,
    transport: http(env.ETHEREUM_RPC_URL),
  });
}

export function getContractAddresses() {
  const env = getServerEnv();
  return {
    paymentRouter: env.PAYMENT_ROUTER_ADDRESS as Address | undefined,
    identityRegistry: env.IDENTITY_REGISTRY_ADDRESS as Address | undefined,
    renewalVault: env.RENEWAL_VAULT_ADDRESS as Address | undefined,
    usdc: env.USDC_ADDRESS as Address,
    treasury: env.TREASURY_ADDRESS as Address | undefined,
  };
}
