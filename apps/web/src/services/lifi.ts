import { formatUnits, parseAbi, type Address, type Hex } from 'viem';
import {
  BASE_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  USDC_DECIMALS,
  sleep,
} from '@agentdomain/shared';
import {
  getBackendWalletClient,
  getContractAddresses,
  getEthereumPublicClient,
  getPublicClient,
} from '@/lib/chain';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordMetric } from '@/lib/metrics';
import { getEthUsdPrice, weiToUsdcAtomic } from './eth-price';

const log = logger.child({ service: 'lifi' });

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';
const FUNDING_BUFFER_BPS = 12_000n;
const STATUS_POLL_INTERVAL_MS = 15_000;
const BALANCE_POLL_INTERVAL_MS = 10_000;

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

type FundingDestination = 'base' | 'ethereum';

interface EnsureNativeBalanceOptions {
  destination: FundingDestination;
  requiredWei: bigint;
  reason: string;
}

interface LifiQuote {
  id: string;
  type: string;
  tool: string;
  action: {
    fromChainId: number;
    toChainId: number;
    fromAmount: string;
    fromAddress?: Address;
    toAddress?: Address;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    approvalAddress?: Address;
  };
  transactionRequest?: {
    from?: Address;
    to?: Address;
    chainId?: number | string;
    data?: Hex;
    value?: string;
    gas?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  includedSteps?: Array<{
    type: string;
    tool: string;
  }>;
}

interface LifiStatusResponse {
  status?: 'NOT_FOUND' | 'PENDING' | 'DONE' | 'FAILED';
  substatus?: string;
  substatusMessage?: string;
  receiving?: {
    txHash?: Hex;
  };
}

export interface LifiFundingResult {
  funded: boolean;
  txHash?: Hex;
  destination: FundingDestination;
  requiredWei: bigint;
  startingBalanceWei: bigint;
  endingBalanceWei?: bigint;
  fromAmountUsdcAtomic?: bigint;
}

export class LifiFundingService {
  async ensureNativeBalance(opts: EnsureNativeBalanceOptions): Promise<LifiFundingResult> {
    if (opts.requiredWei <= 0n) {
      return {
        funded: false,
        destination: opts.destination,
        requiredWei: opts.requiredWei,
        startingBalanceWei: 0n,
        endingBalanceWei: 0n,
      };
    }

    const env = getServerEnv();
    if (env.BASE_CHAIN_ID !== BASE_CHAIN_ID) {
      throw new Error('LI.FI funding is configured for Base mainnet payments only');
    }

    const wallet = getBackendWalletClient();
    const backendAddress = wallet.account!.address;
    const destinationClient =
      opts.destination === 'ethereum' ? getEthereumPublicClient() : getPublicClient();

    const startingBalance = await destinationClient.getBalance({ address: backendAddress });
    if (startingBalance >= opts.requiredWei) {
      log.info('native funding not needed', {
        destination: opts.destination,
        reason: opts.reason,
        requiredWei: opts.requiredWei.toString(),
        balanceWei: startingBalance.toString(),
      });
      recordMetric('lifi_funding_skipped', {
        destination: opts.destination,
        reason: opts.reason,
      });
      return {
        funded: false,
        destination: opts.destination,
        requiredWei: opts.requiredWei,
        startingBalanceWei: startingBalance,
        endingBalanceWei: startingBalance,
      };
    }

    const shortfallWei = opts.requiredWei - startingBalance;
    const quote = await this.getQuoteForShortfall({
      destination: opts.destination,
      shortfallWei,
      backendAddress,
    });
    const fromAmount = BigInt(quote.estimate.fromAmount || quote.action.fromAmount);

    await this.assertBaseUsdcBalance(backendAddress, fromAmount);
    await this.approveIfNeeded(backendAddress, quote, fromAmount);

    const txHash = await this.executeQuote(quote);
    recordMetric('lifi_funding_submitted', {
      destination: opts.destination,
      reason: opts.reason,
      txHash,
      fromAmountAtomic: fromAmount.toString(),
    });

    if (quote.action.toChainId !== BASE_CHAIN_ID) {
      await this.waitForBridgeCompletion({ txHash, quote });
    }

    const endingBalance = await this.waitForNativeBalance({
      destination: opts.destination,
      requiredWei: opts.requiredWei,
      address: backendAddress,
    });

    log.info('native funding completed', {
      destination: opts.destination,
      reason: opts.reason,
      txHash,
      requiredWei: opts.requiredWei.toString(),
      endingBalanceWei: endingBalance.toString(),
      fromAmountUsdc: formatUnits(fromAmount, USDC_DECIMALS),
    });
    recordMetric('lifi_funding_completed', {
      destination: opts.destination,
      reason: opts.reason,
      txHash,
    });

    return {
      funded: true,
      txHash,
      destination: opts.destination,
      requiredWei: opts.requiredWei,
      startingBalanceWei: startingBalance,
      endingBalanceWei: endingBalance,
      fromAmountUsdcAtomic: fromAmount,
    };
  }

  private async getQuoteForShortfall(opts: {
    destination: FundingDestination;
    shortfallWei: bigint;
    backendAddress: Address;
  }): Promise<LifiQuote> {
    const env = getServerEnv();
    const ethUsd = await getEthUsdPrice();
    let fromAmount = applyBuffer(
      weiToUsdcAtomic(opts.shortfallWei, ethUsd.answer, ethUsd.decimals),
      FUNDING_BUFFER_BPS,
    );
    if (fromAmount === 0n) fromAmount = 1n;

    const toChainId = opts.destination === 'ethereum' ? ETHEREUM_MAINNET_CHAIN_ID : BASE_CHAIN_ID;
    let quote = await this.fetchQuote({
      toChainId,
      fromAmount,
      backendAddress: opts.backendAddress,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const minReceived = BigInt(quote.estimate.toAmountMin);
      if (minReceived >= opts.shortfallWei) break;
      if (minReceived <= 0n) {
        throw new Error('LI.FI quote returned zero minimum output for native funding');
      }
      fromAmount = (fromAmount * opts.shortfallWei * 12n) / (minReceived * 10n) + 1n;
      quote = await this.fetchQuote({
        toChainId,
        fromAmount,
        backendAddress: opts.backendAddress,
      });
    }

    const minReceived = BigInt(quote.estimate.toAmountMin);
    if (minReceived < opts.shortfallWei) {
      throw new Error('LI.FI route cannot guarantee enough native ETH for registration');
    }

    recordMetric('lifi_funding_quoted', {
      destination: opts.destination,
      tool: quote.tool,
      fromAmountAtomic: quote.estimate.fromAmount,
      toAmountMinWei: quote.estimate.toAmountMin,
    });

    return quote;
  }

  private async fetchQuote(opts: {
    toChainId: number;
    fromAmount: bigint;
    backendAddress: Address;
  }): Promise<LifiQuote> {
    const env = getServerEnv();
    const { usdc } = getContractAddresses();
    const params = new URLSearchParams({
      fromChain: String(BASE_CHAIN_ID),
      toChain: String(opts.toChainId),
      fromToken: usdc,
      toToken: NATIVE_TOKEN,
      fromAmount: opts.fromAmount.toString(),
      fromAddress: opts.backendAddress,
      toAddress: opts.backendAddress,
      slippage: String(env.LIFI_SLIPPAGE),
      integrator: env.LIFI_INTEGRATOR,
      order: 'FASTEST',
    });
    if (env.LIFI_REFERRER) params.set('referrer', env.LIFI_REFERRER);

    const res = await fetch(`${trimTrailingSlash(env.LIFI_API_URL)}/quote?${params.toString()}`, {
      headers: this.getHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await safeResponseText(res);
      throw new Error(`LI.FI quote failed with HTTP ${res.status}: ${body}`);
    }

    const quote = (await res.json()) as LifiQuote;
    if (!quote.transactionRequest?.to) {
      throw new Error('LI.FI quote did not include an executable transaction request');
    }
    if (!quote.estimate?.approvalAddress) {
      throw new Error('LI.FI quote did not include an approval address');
    }

    return quote;
  }

  private async assertBaseUsdcBalance(owner: Address, amount: bigint): Promise<void> {
    const client = getPublicClient();
    const { usdc } = getContractAddresses();
    const balance = (await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })) as bigint;

    if (balance < amount) {
      throw new Error(
        `Backend wallet has insufficient Base USDC for LI.FI funding: needs ${formatUnits(
          amount,
          USDC_DECIMALS,
        )}, has ${formatUnits(balance, USDC_DECIMALS)}`,
      );
    }
  }

  private async approveIfNeeded(owner: Address, quote: LifiQuote, amount: bigint): Promise<void> {
    const spender = quote.estimate.approvalAddress;
    if (!spender) throw new Error('LI.FI approval address missing');

    const wallet = getBackendWalletClient();
    const client = getPublicClient();
    const { usdc } = getContractAddresses();
    const allowance = (await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    })) as bigint;
    if (allowance >= amount) return;

    const txHash = await wallet.writeContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
      chain: wallet.chain,
      account: wallet.account!,
    });
    recordMetric('lifi_approval_submitted', {
      spender,
      amountAtomic: amount.toString(),
      txHash,
    });
    await client.waitForTransactionReceipt({ hash: txHash });
  }

  private async executeQuote(quote: LifiQuote): Promise<Hex> {
    const wallet = getBackendWalletClient();
    const client = getPublicClient();
    const tx = quote.transactionRequest;
    if (!tx?.to) throw new Error('LI.FI transaction request missing target');

    const chainId = tx.chainId ? Number(tx.chainId) : BASE_CHAIN_ID;
    if (chainId !== BASE_CHAIN_ID) {
      throw new Error(`LI.FI transaction is for chain ${chainId}, expected Base mainnet`);
    }

    const request: {
      account: NonNullable<typeof wallet.account>;
      chain: typeof wallet.chain;
      to: Address;
      data?: Hex;
      value?: bigint;
      gas?: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    } = {
      account: wallet.account!,
      chain: wallet.chain,
      to: tx.to,
      data: tx.data,
      value: parseOptionalBigInt(tx.value) ?? 0n,
    };

    const gas = parseOptionalBigInt(tx.gasLimit ?? tx.gas);
    if (gas) request.gas = gas;

    const maxFeePerGas = parseOptionalBigInt(tx.maxFeePerGas);
    const maxPriorityFeePerGas = parseOptionalBigInt(tx.maxPriorityFeePerGas);
    if (maxFeePerGas || maxPriorityFeePerGas) {
      if (maxFeePerGas) request.maxFeePerGas = maxFeePerGas;
      if (maxPriorityFeePerGas) request.maxPriorityFeePerGas = maxPriorityFeePerGas;
    }

    try {
      const txHash = await wallet.sendTransaction(request);
      await client.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    } catch (e) {
      recordMetric('lifi_funding_failed', {
        tool: quote.tool,
        reason: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  private async waitForBridgeCompletion(opts: { txHash: Hex; quote: LifiQuote }): Promise<void> {
    const env = getServerEnv();
    const deadline = Date.now() + env.LIFI_MAX_WAIT_SECONDS * 1000;

    while (Date.now() < deadline) {
      await sleep(STATUS_POLL_INTERVAL_MS);
      const status = await this.fetchStatus(opts.txHash, opts.quote);
      if (status.status === 'DONE') return;
      if (status.status === 'FAILED') {
        throw new Error(
          `LI.FI transfer failed: ${status.substatus ?? 'FAILED'} ${
            status.substatusMessage ?? ''
          }`.trim(),
        );
      }
    }

    throw new Error('Timed out waiting for LI.FI cross-chain funding to complete');
  }

  private async fetchStatus(txHash: Hex, quote: LifiQuote): Promise<LifiStatusResponse> {
    const env = getServerEnv();
    const params = new URLSearchParams({
      txHash,
      bridge: getStatusBridge(quote),
      fromChain: String(quote.action.fromChainId),
      toChain: String(quote.action.toChainId),
    });
    const res = await fetch(`${trimTrailingSlash(env.LIFI_API_URL)}/status?${params.toString()}`, {
      headers: this.getHeaders(),
      cache: 'no-store',
    });
    if (res.status === 404) return { status: 'NOT_FOUND' };
    if (!res.ok) {
      log.warn('lifi status poll failed', {
        status: res.status,
        body: await safeResponseText(res),
      });
      return { status: 'PENDING' };
    }
    return (await res.json()) as LifiStatusResponse;
  }

  private async waitForNativeBalance(opts: {
    destination: FundingDestination;
    requiredWei: bigint;
    address: Address;
  }): Promise<bigint> {
    const env = getServerEnv();
    const deadline = Date.now() + env.LIFI_MAX_WAIT_SECONDS * 1000;
    const client = opts.destination === 'ethereum' ? getEthereumPublicClient() : getPublicClient();

    while (Date.now() < deadline) {
      const balance = await client.getBalance({ address: opts.address });
      if (balance >= opts.requiredWei) return balance;
      await sleep(BALANCE_POLL_INTERVAL_MS);
    }

    throw new Error('Timed out waiting for LI.FI-funded native balance');
  }

  private getHeaders(): Record<string, string> {
    const env = getServerEnv();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY;
    return headers;
  }
}

function applyBuffer(value: bigint, bps: bigint): bigint {
  return (value * bps + 9_999n) / 10_000n;
}

function parseOptionalBigInt(value?: string | number | bigint): bigint | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  return BigInt(value);
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return 'unreadable response';
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getStatusBridge(quote: LifiQuote): string {
  return quote.includedSteps?.find((step) => step.type === 'cross')?.tool ?? quote.tool;
}

let _instance: LifiFundingService | null = null;
export function getLifiFunding(): LifiFundingService {
  if (!_instance) _instance = new LifiFundingService();
  return _instance;
}
