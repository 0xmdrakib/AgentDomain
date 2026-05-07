import { randomBytes } from 'node:crypto';
import { bytesToHex, encodeFunctionData, namehash, parseAbi, type Address, type Hex } from 'viem';
import { getEthereumBackendWalletClient, getEthereumPublicClient } from '@/lib/chain';
import { logger } from '@/lib/logger';
import { getEthUsdPrice, weiToUsdcAtomic } from './eth-price';
import {
  ENS_FEE_USDC_ATOMIC,
  ENS_L1_REGISTRATION_GAS_UNITS,
  ENS_MAINNET,
  ENS_PRICE_BUFFER_BPS,
  MIN_COMMITMENT_AGE_SECONDS,
  MIN_REGISTRATION_DURATION_SECONDS,
  sleep,
} from '@agentdomain/shared';

const log = logger.child({ service: 'ens' });

const CONTROLLER_ABI = parseAbi([
  'function available(string label) view returns (bool)',
  'function rentPrice(string label, uint256 duration) view returns ((uint256 base, uint256 premium))',
  'function minCommitmentAge() view returns (uint256)',
  'function makeCommitment((string label, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, uint8 reverseRecord, bytes32 referrer) registration) pure returns (bytes32)',
  'function commit(bytes32 commitment) external',
  'function register((string label, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, uint8 reverseRecord, bytes32 referrer) registration) external payable',
]);

const RESOLVER_ABI = parseAbi(['function setAddr(bytes32 node, address a) external']);

type EnsPrice = { base: bigint; premium: bigint } | readonly [bigint, bigint];

export interface EnsQuote {
  ensName: string;
  rentWei: bigint;
  rentUsdcAtomic: bigint;
  gasUsdcAtomic: bigint;
  serviceFeeUsdcAtomic: bigint;
  totalUsdcAtomic: bigint;
}

export interface EnsRegistrationResult {
  ensName: string;
  txHash: Hex;
  owner: Address;
  durationSeconds: number;
}

export class EnsService {
  async isAvailable(label: string): Promise<boolean> {
    const client = getEthereumPublicClient();
    return (await client.readContract({
      address: ENS_MAINNET.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'available',
      args: [label],
    })) as boolean;
  }

  async getPriceWei(label: string, durationSeconds: number): Promise<bigint> {
    const client = getEthereumPublicClient();
    const price = (await client.readContract({
      address: ENS_MAINNET.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'rentPrice',
      args: [label, BigInt(durationSeconds)],
    })) as EnsPrice;

    return getPriceTotal(price);
  }

  async getQuoteUsdcAtomic(
    label: string,
    durationSeconds = MIN_REGISTRATION_DURATION_SECONDS,
  ): Promise<EnsQuote> {
    const client = getEthereumPublicClient();
    const [rentWei, ethUsd, fees] = await Promise.all([
      this.getPriceWei(label, durationSeconds),
      getEthUsdPrice(),
      client.estimateFeesPerGas().catch(async () => ({ gasPrice: await client.getGasPrice() })),
    ]);

    const feePerGas = getFeePerGas(fees) ?? (await client.getGasPrice());
    const bufferedGasWei = applyBuffer(feePerGas * ENS_L1_REGISTRATION_GAS_UNITS);
    const rentUsdcAtomic = weiToUsdcAtomic(rentWei, ethUsd.answer, ethUsd.decimals);
    const gasUsdcAtomic = weiToUsdcAtomic(bufferedGasWei, ethUsd.answer, ethUsd.decimals);

    return {
      ensName: `${label}.eth`,
      rentWei,
      rentUsdcAtomic,
      gasUsdcAtomic,
      serviceFeeUsdcAtomic: ENS_FEE_USDC_ATOMIC,
      totalUsdcAtomic: rentUsdcAtomic + gasUsdcAtomic,
    };
  }

  async getRequiredWei(label: string, durationSeconds: number): Promise<bigint> {
    const client = getEthereumPublicClient();
    const [rentWei, fees] = await Promise.all([
      this.getPriceWei(label, durationSeconds),
      client.estimateFeesPerGas().catch(async () => ({ gasPrice: await client.getGasPrice() })),
    ]);
    const feePerGas = getFeePerGas(fees) ?? (await client.getGasPrice());
    return applyBuffer(rentWei + feePerGas * ENS_L1_REGISTRATION_GAS_UNITS);
  }

  async assertBackendCanRegister(label: string, durationSeconds: number): Promise<void> {
    const client = getEthereumPublicClient();
    const wallet = getEthereumBackendWalletClient();
    const [requiredWei, balance] = await Promise.all([
      this.getRequiredWei(label, durationSeconds),
      client.getBalance({ address: wallet.account!.address }),
    ]);

    if (balance < requiredWei) {
      throw new Error('Backend wallet needs more ETH on Ethereum mainnet for ENS registration');
    }
  }

  async register(opts: {
    label: string;
    ownerAddress: Address;
    durationSeconds: number;
  }): Promise<EnsRegistrationResult> {
    const wallet = getEthereumBackendWalletClient();
    const publicClient = getEthereumPublicClient();
    const ensName = `${opts.label}.eth`;
    const node = namehash(ensName);
    const secret = bytesToHex(randomBytes(32)) as Hex;
    const setAddrData = encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, opts.ownerAddress],
    });

    const registration = {
      label: opts.label,
      owner: opts.ownerAddress,
      duration: BigInt(opts.durationSeconds),
      secret,
      resolver: ENS_MAINNET.publicResolver,
      data: [setAddrData] as readonly Hex[],
      reverseRecord: 0,
      referrer: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
    } as const;

    const commitment = (await publicClient.readContract({
      address: ENS_MAINNET.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'makeCommitment',
      args: [registration],
    })) as Hex;

    log.info('ens commit prepared', { label: opts.label, commitment });

    const commitTxHash = await wallet.writeContract({
      address: ENS_MAINNET.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'commit',
      args: [commitment],
      chain: wallet.chain,
      account: wallet.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: commitTxHash });
    log.info('ens commit confirmed', { label: opts.label, txHash: commitTxHash });

    const minCommitmentAge = await this.getMinCommitmentAgeSeconds();
    await sleep((minCommitmentAge + 5) * 1000);

    const priceWei = await this.getPriceWei(opts.label, opts.durationSeconds);
    const registerTxHash = await wallet.writeContract({
      address: ENS_MAINNET.registrarController,
      abi: CONTROLLER_ABI,
      functionName: 'register',
      args: [registration],
      value: applyBuffer(priceWei),
      chain: wallet.chain,
      account: wallet.account!,
    });

    await publicClient.waitForTransactionReceipt({ hash: registerTxHash });
    log.info('ens registered', { ensName, owner: opts.ownerAddress, txHash: registerTxHash });

    return {
      ensName,
      txHash: registerTxHash,
      owner: opts.ownerAddress,
      durationSeconds: opts.durationSeconds,
    };
  }

  /**
   * Renew an existing ENS name for additional duration.
   * Unlike registration, renewal does NOT require commit-reveal.
   */
  async renew(opts: {
    label: string;
    durationSeconds: number;
  }): Promise<{ txHash: Hex; ensName: string }> {
    const wallet = getEthereumBackendWalletClient();
    const publicClient = getEthereumPublicClient();
    const ensName = `${opts.label}.eth`;

    const RENEW_ABI = parseAbi([
      'function renew(string label, uint256 duration) external payable',
    ]);

    const priceWei = await this.getPriceWei(opts.label, opts.durationSeconds);
    const priceWithBuffer = applyBuffer(priceWei);

    const txHash = await wallet.writeContract({
      address: ENS_MAINNET.registrarController,
      abi: RENEW_ABI,
      functionName: 'renew',
      args: [opts.label, BigInt(opts.durationSeconds)],
      value: priceWithBuffer,
      chain: wallet.chain,
      account: wallet.account!,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log.info('ens renewed', { ensName, txHash, durationSeconds: opts.durationSeconds });

    return { txHash, ensName };
  }

  computeNamehash(label: string): Hex {
    return namehash(`${label}.eth`);
  }

  private async getMinCommitmentAgeSeconds(): Promise<number> {
    try {
      const client = getEthereumPublicClient();
      const seconds = (await client.readContract({
        address: ENS_MAINNET.registrarController,
        abi: CONTROLLER_ABI,
        functionName: 'minCommitmentAge',
      })) as bigint;
      return Number(seconds);
    } catch (e) {
      log.warn('ens min commitment age read failed; using default', { err: String(e) });
      return MIN_COMMITMENT_AGE_SECONDS;
    }
  }
}

function getPriceTotal(price: EnsPrice): bigint {
  if ('base' in price) return price.base + price.premium;
  return price[0] + price[1];
}

function getFeePerGas(fees: { maxFeePerGas?: bigint; gasPrice?: bigint }): bigint | undefined {
  return fees.maxFeePerGas ?? fees.gasPrice;
}

function applyBuffer(value: bigint): bigint {
  return (value * ENS_PRICE_BUFFER_BPS + 9_999n) / 10_000n;
}

let _instance: EnsService | null = null;
export function getEns(): EnsService {
  if (!_instance) _instance = new EnsService();
  return _instance;
}
