import type { inspectAgentRenewal } from '@agentdomain/sdk';
import { formatUnits } from 'viem';

export type RenewalObservation = Awaited<ReturnType<typeof inspectAgentRenewal>>;

export function renewalUsdc(atomic: string): string {
  return `${formatUnits(BigInt(atomic), 6)} USDC`;
}

export function renewalDuration(seconds: string): string {
  const value = BigInt(seconds);
  return value > 0n && value % 86_400n === 0n ? `${value / 86_400n} days` : `${value} seconds`;
}

export function renewalJson(result: RenewalObservation): string {
  return JSON.stringify(result, null, 2) + '\n';
}
