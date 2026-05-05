import type { Address } from 'viem';
import { getContractAddresses } from '@/lib/chain';

export const addresses: {
  usdc: Address;
  paymentRouter: Address;
  identityRegistry: Address;
  renewalVault: Address;
  treasury: Address;
} = getContractAddresses() as {
  usdc: Address;
  paymentRouter: Address;
  identityRegistry: Address;
  renewalVault: Address;
  treasury: Address;
};
