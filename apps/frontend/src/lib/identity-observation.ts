import type { inspectAgentIdentity } from '@agentdomain/sdk';

export type IdentityObservation = Awaited<ReturnType<typeof inspectAgentIdentity>>;
export type IdentityInspectionInput = Parameters<typeof inspectAgentIdentity>[0];
export type ObservationTone = 'neutral' | 'success' | 'warning' | 'danger';

export function observationSummary(result: IdentityObservation): {
  label: string;
  tone: ObservationTone;
} {
  if (result.status === 'not_found') return { label: 'Identity not found', tone: 'neutral' };
  if (
    !result.consistent ||
    !result.checks.ownerConsistent ||
    !result.checks.domainConsistent ||
    !result.checks.metadataConsistent ||
    !result.checks.lifecycleConsistent
  )
    return { label: 'Records differ', tone: 'danger' };
  if (result.checks.expectedOwnerMatches === false)
    return { label: 'Expected wallet differs', tone: 'danger' };
  if (result.lifecycle === 'revoked') return { label: 'Revoked identity', tone: 'danger' };
  if (result.lifecycle === 'expired') return { label: 'Expired identity', tone: 'warning' };
  return { label: 'Records consistent', tone: 'success' };
}

export function observationTime(seconds: string): string {
  if (!/^\d+$/.test(seconds)) return seconds;
  const milliseconds = BigInt(seconds) * 1000n;
  if (milliseconds > 8_640_000_000_000_000n) return `${seconds} seconds (Unix)`;
  return new Date(Number(milliseconds)).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function baseScanLink(kind: 'address' | 'block' | 'token', value: string, tokenId?: string) {
  if (kind === 'block') {
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
    return `https://basescan.org/block/${value}`;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  if (kind === 'token') {
    if (!tokenId || !/^\d+$/.test(tokenId)) return null;
    return `https://basescan.org/token/${value}?a=${tokenId}`;
  }
  return `https://basescan.org/address/${value}`;
}

export function observationJson(result: IdentityObservation): string {
  return JSON.stringify(result, null, 2) + '\n';
}

export function inspectionFailure(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'RATE_LIMITED') {
    const seconds =
      error && typeof error === 'object' && 'retryAfterSeconds' in error
        ? error.retryAfterSeconds
        : null;
    return typeof seconds === 'number' &&
      Number.isInteger(seconds) &&
      seconds >= 1 &&
      seconds <= 3_600
      ? `Identity checks are rate-limited. Try again in ${seconds} seconds.`
      : 'Identity checks are rate-limited. Please wait before trying again.';
  }
  // Only documented SDK codes may become UI messages; never display RPC payloads.
  if (code === 'INVALID_INPUT') return 'Check the domain, token ID and expected wallet.';
  if (code === 'WRONG_CHAIN')
    return 'The RPC returned another network. No Base observation was confirmed.';
  if (code === 'UNSAFE_SNAPSHOT')
    return 'The safe block changed or was unavailable. No observation was confirmed.';
  return 'The RPC check failed. No observation was confirmed.';
}
