import { base } from 'wagmi/chains';

export const BASE_MAINNET_CHAIN_ID = base.id;
export const BASE_MAINNET_NAME = 'Base mainnet';

export class BaseChainRequiredError extends Error {
  constructor(message = 'Switch your wallet to Base mainnet before continuing.') {
    super(message);
    this.name = 'BaseChainRequiredError';
  }
}

export function isBaseChainRequiredError(error: unknown): error is BaseChainRequiredError {
  return error instanceof BaseChainRequiredError;
}

export function isBaseChainMismatchError(error: unknown): boolean {
  const text = collectErrorText(error).join(' ').toLowerCase();
  return (
    text.includes('expected chain id: 8453') ||
    text.includes('does not match the connection') ||
    text.includes('does not match connection') ||
    (text.includes('current chain') && text.includes('8453')) ||
    (text.includes('connector') && text.includes('chain') && text.includes('8453'))
  );
}

export function isUserRejectedWalletRequest(error: unknown): boolean {
  const text = collectErrorText(error).join(' ').toLowerCase();
  return (
    text.includes('user rejected') ||
    text.includes('user denied') ||
    text.includes('rejected the request') ||
    text.includes('request rejected') ||
    text.includes('denied transaction signature') ||
    text.includes('code 4001') ||
    text.includes('4001')
  );
}

export function getBaseChainSwitchCopy(error?: unknown): {
  kind: 'cancelled' | 'failed';
  title: string;
  description: string;
} {
  if (error && isUserRejectedWalletRequest(error)) {
    return {
      kind: 'cancelled',
      title: 'Network switch cancelled',
      description: 'No transaction was submitted. Switch to Base mainnet to continue.',
    };
  }

  return {
    kind: 'failed',
    title: `Switch to ${BASE_MAINNET_NAME}`,
    description:
      'This action only works on Base mainnet. Switch your wallet network to Base and try again.',
  };
}

function collectErrorText(error: unknown, depth = 0): string[] {
  if (!error || depth > 4) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [String(error)];

  const record = error as Record<string, unknown>;
  const keys = ['name', 'shortMessage', 'details', 'message', 'reason', 'code'];
  const parts: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
    }
  }
  parts.push(...collectErrorText(record.cause, depth + 1));
  return parts;
}
