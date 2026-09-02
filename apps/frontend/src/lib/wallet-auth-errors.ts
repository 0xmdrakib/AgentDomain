const USER_REJECTED_PATTERNS = [
  'user rejected',
  'user denied',
  'rejected the request',
  'request rejected',
  'denied message signature',
  'code 4001',
];

export function formatWalletAuthError(error: unknown): string {
  const diagnosticText = collectErrorText(error, true).join(' ').toLowerCase();

  if (USER_REJECTED_PATTERNS.some((pattern) => diagnosticText.includes(pattern))) {
    return 'Wallet signature request cancelled. Approve the message in your wallet to sign in.';
  }

  if (
    diagnosticText.includes('signature does not match') ||
    diagnosticText.includes('invalid_signature') ||
    diagnosticText.includes('wallet signature could not be verified')
  ) {
    return 'This wallet signature could not be verified. Disconnect and reconnect the wallet, then try again.';
  }

  if (
    diagnosticText.includes('nonce_missing_or_expired') ||
    diagnosticText.includes('nonce_mismatch') ||
    diagnosticText.includes('sign-in request expired')
  ) {
    return 'This sign-in request expired. Please try again.';
  }

  if (diagnosticText.includes('chain_mismatch') || diagnosticText.includes('base network')) {
    return 'Switch your wallet to Base and try signing in again.';
  }

  const displayable = collectErrorText(error, false).map(cleanWalletErrorMessage).find(Boolean);

  return displayable || 'Wallet sign-in failed. Please try again.';
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
    if (typeof value === 'string' || typeof value === 'number') parts.push(String(value));
  }

  parts.push(...collectErrorText(record.cause, includeDiagnosticFields, depth + 1));
  return parts;
}

function cleanWalletErrorMessage(message: string): string {
  const cleaned = message
    .replace(/Request Arguments:[\s\S]*/i, '')
    .replace(/\bDocs:\s*\S+/gi, '')
    .replace(/\bVersion:\s*\S+/gi, '')
    .replace(/\bDetails:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}
