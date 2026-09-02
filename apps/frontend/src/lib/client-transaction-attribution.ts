import { concatHex, encodeFunctionData, type Address, type Hex } from 'viem';
import {
  BUILDER_CODE_PATTERN,
  encodeBuilderCodeSuffix,
  parseBuilderCodeSuffixFromCalldata,
} from '@x402/extensions/builder-code';
import { RENEWAL_VAULT_ABI, USDC_ABI } from './abis';

export const DEVELOPMENT_BUILDER_CODE = 'agentdomain';

export class ClientTransactionAttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientTransactionAttributionError';
  }
}

export interface AttributedBaseTransaction {
  to: Address;
  data: Hex;
  value: bigint;
}

export function assertSuccessfulClientTransactionReceipt(
  receipt: { status: 'success' | 'reverted' },
  operation: string,
): void {
  if (receipt.status !== 'success') {
    throw new Error(`${operation} transaction reverted on Base`);
  }
}

export function resolveClientBuilderCode(
  configuredBuilderCode: string | null | undefined,
  runtime = process.env.NODE_ENV,
): string {
  if (!configuredBuilderCode || !configuredBuilderCode.trim()) {
    if (runtime !== 'production') return DEVELOPMENT_BUILDER_CODE;
    throw new ClientTransactionAttributionError(
      'Builder Code attribution is not configured. This transaction was not submitted.',
    );
  }

  if (!BUILDER_CODE_PATTERN.test(configuredBuilderCode)) {
    throw new ClientTransactionAttributionError(
      'Builder Code attribution configuration is invalid. This transaction was not submitted.',
    );
  }

  return configuredBuilderCode;
}

export function appendClientBuilderCodeSuffix(data: Hex, builderCode: string): Hex {
  if (!BUILDER_CODE_PATTERN.test(builderCode)) {
    throw new ClientTransactionAttributionError(
      'Builder Code attribution configuration is invalid. This transaction was not submitted.',
    );
  }

  const existing = parseBuilderCodeSuffixFromCalldata(data);
  if (existing) {
    if (existing.a === builderCode) return data;
    throw new ClientTransactionAttributionError(
      'Transaction calldata already contains different Builder Code attribution. This transaction was not submitted.',
    );
  }

  return concatHex([data, encodeBuilderCodeSuffix({ a: builderCode })]);
}

export function buildAttributedUsdcApproval(
  usdcAddress: Address,
  spender: Address,
  amount: bigint,
  builderCode: string,
): AttributedBaseTransaction {
  return {
    to: usdcAddress,
    data: appendClientBuilderCodeSuffix(
      encodeFunctionData({
        abi: USDC_ABI,
        functionName: 'approve',
        args: [spender, amount],
      }),
      builderCode,
    ),
    value: 0n,
  };
}

export function buildAttributedVaultDeposit(
  vaultAddress: Address,
  tokenId: bigint,
  amount: bigint,
  builderCode: string,
): AttributedBaseTransaction {
  return {
    to: vaultAddress,
    data: appendClientBuilderCodeSuffix(
      encodeFunctionData({
        abi: RENEWAL_VAULT_ABI,
        functionName: 'deposit',
        args: [tokenId, amount],
      }),
      builderCode,
    ),
    value: 0n,
  };
}

export function buildAttributedSetAutoRenew(
  vaultAddress: Address,
  tokenId: bigint,
  enabled: boolean,
  builderCode: string,
): AttributedBaseTransaction {
  return {
    to: vaultAddress,
    data: appendClientBuilderCodeSuffix(
      encodeFunctionData({
        abi: RENEWAL_VAULT_ABI,
        functionName: 'setAutoRenew',
        args: [tokenId, enabled],
      }),
      builderCode,
    ),
    value: 0n,
  };
}

export function attributePreparedBaseTransaction(
  transaction: AttributedBaseTransaction,
  builderCode: string,
): AttributedBaseTransaction {
  return {
    ...transaction,
    data: appendClientBuilderCodeSuffix(transaction.data, builderCode),
  };
}
