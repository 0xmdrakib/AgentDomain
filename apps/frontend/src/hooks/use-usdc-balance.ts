'use client';

import { useReadContract } from 'wagmi';
import { base } from 'wagmi/chains';
import { formatUnits, type Address } from 'viem';
import { USDC_BASE, USDC_DECIMALS } from '@agentdomain/shared';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * Read the connected wallet's USDC balance on the active Base network.
 * Polls every 12 seconds.
 */
export function useUsdcBalance(address: Address | undefined, chainId: number | undefined) {
  const onBaseMainnet = chainId === base.id;
  const usdcAddress = USDC_BASE;

  const { data, isLoading, refetch } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: {
      enabled: Boolean(address && onBaseMainnet),
      refetchInterval: 12_000,
    },
  });

  const balanceAtomic = (data as bigint | undefined) ?? 0n;
  const balanceFormatted = formatUnits(balanceAtomic, USDC_DECIMALS);
  const balanceNumber = Number(balanceFormatted);

  return {
    balanceAtomic,
    balanceFormatted,
    balanceNumber,
    isLoading,
    refetch,
    usdcAddress,
  };
}
