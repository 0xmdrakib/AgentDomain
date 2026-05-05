import { namehash, parseAbi, type Address, type Hex } from 'viem';
import { getBackendWalletClient, getPublicClient } from '@/lib/chain';
import { logger } from '@/lib/logger';
import { getEthUsdPrice, weiToUsdcAtomic } from './eth-price';
import {
  BASENAME_FEE_USDC_ATOMIC,
  BASENAME_PRICE_BUFFER_BPS,
  BASENAME_REGISTRATION_GAS_UNITS,
  sleep,
  BASENAMES_MAINNET,
  BASENAMES_SEPOLIA,
  BASE_CHAIN_ID,
  MIN_COMMITMENT_AGE_SECONDS,
} from '@agentdomain/shared';

/**
 * Basenames (.base.eth) registration service.
 *
 * Basenames is Coinbase's ENS-fork on Base L2. It uses the standard ENS
 * commit-reveal pattern. We act as a registration agent: the backend wallet
 * pays the ETH gas + name fee, then ownership is assigned to the agent.
 *
 * Contracts source: https://github.com/base/basenames (verified 2026-04)
 */

const log = logger.child({ service: 'basenames' });

/**
 * Choose the right contract set for the active chain.
 */
function getContracts() {
  const chainId = Number(process.env.BASE_CHAIN_ID ?? BASE_CHAIN_ID);
  return chainId === BASE_CHAIN_ID ? BASENAMES_MAINNET : BASENAMES_SEPOLIA;
}

/**
 * ENS-style commit-reveal Registrar Controller ABI.
 * Matches base/basenames RegistrarController.sol.
 */
const CONTROLLER_ABI = parseAbi([
  'function available(string name) view returns (bool)',
  'function registerPrice(string name, uint256 duration) view returns (uint256)',
  'function makeCommitment((string name, address owner, uint256 duration, address resolver, bytes[] data, bool reverseRecord)) pure returns (bytes32)',
  'function commit(bytes32 commitment) external',
  'function register((string name, address owner, uint256 duration, address resolver, bytes[] data, bool reverseRecord)) external payable',
]);

export interface BasenameRegistrationResult {
  basename: string;
  txHash: Hex;
  owner: Address;
  durationSeconds: number;
}

export interface BasenameQuote {
  basename: string;
  rentWei: bigint;
  rentUsdcAtomic: bigint;
  gasUsdcAtomic: bigint;
  serviceFeeUsdcAtomic: bigint;
  totalUsdcAtomic: bigint;
}

export class BasenamesService {
  /**
   * Check whether a Basename label is available.
   */
  async isAvailable(label: string): Promise<boolean> {
    const client = getPublicClient();
    const c = getContracts();
    return (await client.readContract({
      address: c.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'available',
      args: [label],
    })) as boolean;
  }

  /**
   * Get the registration price in wei for a label + duration.
   * Pricing comes from the on-chain price oracle, which is denominated in USD
   * but priced into ETH at request time.
   */
  async getPriceWei(label: string, durationSeconds: number): Promise<bigint> {
    const client = getPublicClient();
    const c = getContracts();
    return (await client.readContract({
      address: c.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'registerPrice',
      args: [label, BigInt(durationSeconds)],
    })) as bigint;
  }

  async getQuoteUsdcAtomic(label: string, durationSeconds: number): Promise<BasenameQuote> {
    const client = getPublicClient();
    const [rentWei, ethUsd, fees] = await Promise.all([
      this.getPriceWei(label, durationSeconds),
      getEthUsdPrice(),
      client.estimateFeesPerGas().catch(async () => ({ gasPrice: await client.getGasPrice() })),
    ]);

    const feePerGas = getFeePerGas(fees) ?? (await client.getGasPrice());
    const bufferedGasWei = applyBuffer(feePerGas * BASENAME_REGISTRATION_GAS_UNITS);
    const rentUsdcAtomic = weiToUsdcAtomic(rentWei, ethUsd.answer, ethUsd.decimals);
    const gasUsdcAtomic = weiToUsdcAtomic(bufferedGasWei, ethUsd.answer, ethUsd.decimals);

    return {
      basename: `${label}.base.eth`,
      rentWei,
      rentUsdcAtomic,
      gasUsdcAtomic,
      serviceFeeUsdcAtomic: BASENAME_FEE_USDC_ATOMIC,
      totalUsdcAtomic: rentUsdcAtomic + gasUsdcAtomic,
    };
  }

  async getRequiredWei(label: string, durationSeconds: number): Promise<bigint> {
    const client = getPublicClient();
    const [rentWei, fees] = await Promise.all([
      this.getPriceWei(label, durationSeconds),
      client.estimateFeesPerGas().catch(async () => ({ gasPrice: await client.getGasPrice() })),
    ]);
    const feePerGas = getFeePerGas(fees) ?? (await client.getGasPrice());
    return applyRentSlippage(rentWei) + applyBuffer(feePerGas * BASENAME_REGISTRATION_GAS_UNITS);
  }

  /**
   * Register a Basename, with the agent address as owner.
   *
   * Standard ENS commit-reveal:
   *   1. compute commitment hash off-chain
   *   2. submit commit() tx — recorded on-chain
   *   3. wait MIN_COMMITMENT_AGE (60s)
   *   4. submit register() tx with ETH payment
   *
   * The backend wallet pays ETH for both txs; the agent paid USDC upstream
   * which more than covers the ETH cost via spread.
   */
  async register(opts: {
    label: string;
    ownerAddress: Address;
    durationSeconds: number;
    setReverseRecord?: boolean;
  }): Promise<BasenameRegistrationResult> {
    const wallet = getBackendWalletClient();
    const publicClient = getPublicClient();
    const c = getContracts();

    const params = {
      name: opts.label,
      owner: opts.ownerAddress,
      duration: BigInt(opts.durationSeconds),
      resolver: c.l2Resolver,
      data: [] as readonly `0x${string}`[],
      reverseRecord: opts.setReverseRecord ?? true,
    } as const;

    // 1. Compute commitment hash off-chain (free, no tx).
    const commitment = (await publicClient.readContract({
      address: c.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'makeCommitment',
      args: [params],
    })) as Hex;

    log.info('basename commit prepared', { label: opts.label, commitment });

    // 2. Submit commit tx.
    const commitTxHash = await wallet.writeContract({
      address: c.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'commit',
      args: [commitment],
      chain: wallet.chain,
      account: wallet.account!,
    });

    await publicClient.waitForTransactionReceipt({ hash: commitTxHash });
    log.info('basename commit confirmed', { label: opts.label, txHash: commitTxHash });

    // 3. Wait the anti-frontrun window. +5s buffer for chain settlement.
    await sleep((MIN_COMMITMENT_AGE_SECONDS + 5) * 1000);

    // 4. Read the live price + add 5% slippage buffer for ETH/USD oracle drift.
    const price = await this.getPriceWei(opts.label, opts.durationSeconds);
    const priceWithSlippage = applyRentSlippage(price);

    const registerTxHash = await wallet.writeContract({
      address: c.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'register',
      args: [params],
      value: priceWithSlippage,
      chain: wallet.chain,
      account: wallet.account!,
    });

    await publicClient.waitForTransactionReceipt({ hash: registerTxHash });
    log.info('basename registered', {
      label: opts.label,
      owner: opts.ownerAddress,
      txHash: registerTxHash,
    });

    return {
      basename: `${opts.label}.base.eth`,
      txHash: registerTxHash,
      owner: opts.ownerAddress,
      durationSeconds: opts.durationSeconds,
    };
  }

  /**
   * Renew an existing Basename for additional duration.
   * Unlike registration, renewal does NOT require commit-reveal.
   */
  async renew(opts: {
    label: string;
    durationSeconds: number;
  }): Promise<{ txHash: Hex; basename: string }> {
    const wallet = getBackendWalletClient();
    const publicClient = getPublicClient();
    const c = getContracts();
    const basename = `${opts.label}.base.eth`;

    const RENEW_ABI = parseAbi([
      'function renew(string name, uint256 duration) external payable',
    ]);

    const priceWei = await this.getPriceWei(opts.label, opts.durationSeconds);
    const priceWithSlippage = applyRentSlippage(priceWei);

    const txHash = await wallet.writeContract({
      address: c.registrarController,
      abi: RENEW_ABI,
      functionName: 'renew',
      args: [opts.label, BigInt(opts.durationSeconds)],
      value: priceWithSlippage,
      chain: wallet.chain,
      account: wallet.account!,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log.info('basename renewed', { basename, txHash, durationSeconds: opts.durationSeconds });

    return { txHash, basename };
  }

  /**
   * Compute the namehash for a Basename label (used for resolver lookups).
   */
  computeNamehash(label: string): Hex {
    return namehash(`${label}.base.eth`);
  }
}

let _instance: BasenamesService | null = null;
export function getBasenames(): BasenamesService {
  if (!_instance) _instance = new BasenamesService();
  return _instance;
}

function getFeePerGas(fees: { maxFeePerGas?: bigint; gasPrice?: bigint }): bigint | undefined {
  return fees.maxFeePerGas ?? fees.gasPrice;
}

function applyBuffer(value: bigint): bigint {
  return (value * BASENAME_PRICE_BUFFER_BPS + 9_999n) / 10_000n;
}

function applyRentSlippage(value: bigint): bigint {
  return (value * 105n + 99n) / 100n;
}
