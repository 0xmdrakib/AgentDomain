import { getAddress } from 'viem';

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    return getAddress(address).toLowerCase();
  } catch {
    return null;
  }
}
