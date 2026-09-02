import { getBaseChainSwitchCopy, isBaseChainMismatchError } from '@/lib/base-chain';

export type TransactionRequestStage = 'approval' | 'deposit' | 'signature' | 'transaction';

export interface TransactionErrorCopyOptions {
  action: string;
  fallback: string;
  stage?: TransactionRequestStage;
}

export interface TransactionErrorCopy {
  kind: 'cancelled' | 'failed';
  title: string;
  description: string;
}

export function getTransactionErrorCopy(
  error: unknown,
  opts: TransactionErrorCopyOptions,
): TransactionErrorCopy {
  const text = collectErrorText(error, true).join(' ').toLowerCase();

  if (isBaseChainMismatchError(error)) {
    const copy = getBaseChainSwitchCopy(error);
    return {
      kind: 'cancelled',
      title: copy.title,
      description: copy.description,
    };
  }

  if (isUserRejectedErrorText(text)) {
    return {
      kind: 'cancelled',
      title: `${opts.action} cancelled`,
      description: getCancellationDescription(opts.stage),
    };
  }

  if (text.includes('insufficient funds')) {
    return {
      kind: 'failed',
      title: `${opts.action} failed`,
      description: 'Your wallet does not have enough funds for this transaction and network fees.',
    };
  }

  if (
    text.includes('invalid decimal') ||
    text.includes('too many decimals') ||
    text.includes('cannot parse') ||
    text.includes('invalid amount')
  ) {
    return {
      kind: 'failed',
      title: 'Invalid amount',
      description: 'Enter a valid USDC amount with up to 6 decimal places.',
    };
  }

  const shortMessage = getDisplayableErrorMessage(error);
  return {
    kind: 'failed',
    title: `${opts.action} failed`,
    description: shortMessage ? `${opts.fallback} ${shortMessage}` : opts.fallback,
  };
}

function getCancellationDescription(stage: TransactionRequestStage | undefined): string {
  if (stage === 'approval') {
    return 'You cancelled the USDC approval request. No funds were moved.';
  }
  if (stage === 'deposit') {
    return 'You cancelled the vault deposit request. Your USDC approval may still be active, but no deposit was submitted.';
  }
  if (stage === 'signature') {
    return 'You cancelled the wallet signature request. No payment was authorized.';
  }
  return 'You cancelled the wallet request. No transaction was submitted.';
}

function isUserRejectedErrorText(text: string): boolean {
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

function collectErrorText(error: unknown, includeDiagnosticFields: boolean, depth = 0): string[] {
  if (!error || depth > 3) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [String(error)];

  const record = error as Record<string, unknown>;
  const keys = includeDiagnosticFields
    ? ['name', 'shortMessage', 'details', 'message', 'reason', 'code']
    : ['shortMessage', 'details', 'reason', 'message'];
  const parts: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
    }
  }
  parts.push(...collectErrorText(record.cause, includeDiagnosticFields, depth + 1));
  return parts;
}

function getDisplayableErrorMessage(error: unknown): string | null {
  const candidates = collectErrorText(error, false).map(cleanWalletErrorMessage).filter(Boolean);
  const message = candidates.find((candidate) => !isUserRejectedErrorText(candidate.toLowerCase()));
  if (!message) return null;
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function cleanWalletErrorMessage(message: string): string {
  return message
    .replace(/Request Arguments:[\s\S]*/i, '')
    .replace(/Contract Call:[\s\S]*/i, '')
    .replace(/\bDocs:\s*\S+/gi, '')
    .replace(/\bVersion:\s*\S+/gi, '')
    .replace(/\bDetails:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
