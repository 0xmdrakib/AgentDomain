import { parseAbi } from 'viem';
import { getEthereumPublicClient } from '@/lib/chain';
import { ENS_MAINNET, USDC_DECIMALS } from '@agentdomain/shared';

const ETH_USD_FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

export async function getEthUsdPrice(): Promise<{ answer: bigint; decimals: number }> {
  const client = getEthereumPublicClient();
  const [decimals, roundData] = await Promise.all([
    client.readContract({
      address: ENS_MAINNET.ethUsdPriceFeed,
      abi: ETH_USD_FEED_ABI,
      functionName: 'decimals',
    }) as Promise<number>,
    client.readContract({
      address: ENS_MAINNET.ethUsdPriceFeed,
      abi: ETH_USD_FEED_ABI,
      functionName: 'latestRoundData',
    }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
  ]);

  const answer = roundData[1];
  if (answer <= 0n) throw new Error('Invalid ETH/USD oracle price');
  return { answer, decimals };
}

export function weiToUsdcAtomic(wei: bigint, ethUsdPrice: bigint, priceDecimals: number): bigint {
  const numerator = wei * ethUsdPrice * 10n ** BigInt(USDC_DECIMALS);
  const denominator = 10n ** 18n * 10n ** BigInt(priceDecimals);
  return (numerator + denominator - 1n) / denominator;
}
