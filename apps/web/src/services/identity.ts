import { keccak256, toHex, type Address, type Hex } from 'viem';
import {
  buildDomain,
  buildBasename,
  buildEnsName,
  computeRegistrationCost,
  parseUsdc,
  isReservedName,
  SERVICE_FEE_USDC_ATOMIC,
  MIN_REGISTRATION_DURATION_SECONDS,
  type RegistrationParams,
  type RegistrationResult,
  type AgentMetadata,
  type PricingBreakdown,
  type SupportedTld,
} from '@agentdomain/shared';
import { agentsRepo, emailRepo, registrationsRepo, sslRepo } from '@/db';
import { getSpaceship, getOrCreatePlatformContact } from './spaceship';
import { buildBaselineDnsRecords, getSpaceshipDns, type ManagedDnsRecord } from './dns';
import { getCloudflareSaas } from './cloudflare-saas';
import { getSesEmail } from './ses';
import { getPinata, type AgentMetadataDocument } from './pinata';
import { getBasenames } from './basenames';
import { getEns } from './ens';
import { getLifiFunding } from './lifi';
import { getBackendWalletClient, getPublicClient, getContractAddresses } from '@/lib/chain';
import { PAYMENT_ROUTER_ABI } from '@/lib/abis';
import { logger } from '@/lib/logger';
import { recordMetric } from '@/lib/metrics';

const log = logger.child({ service: 'identity' });

/**
 * IdentityService - orchestrator for the entire registration flow.
 *
 * A single registration coordinates these external calls in order:
 *   1. ENS        - register .eth on Ethereum L1 (optional)
 *   2. Pinata     - pin agent metadata to IPFS
 *   3. Spaceship  - register the ICANN domain and enable Basic DNS
 *   4. Cloudflare - create the apex-only SaaS custom hostname
 *   5. AWS SES    - provision text-only email infrastructure (optional)
 *   6. Spaceship  - write baseline, SaaS, and SES DNS records
 *   7. Basenames  - register .base.eth on Base L2 (optional)
 *   8. PaymentRouter contract - settle payment, mint AgentID NFT
 *   9. Database   - persist agent + registration audit log
 *
 * No mock paths exist anywhere in this flow - production-only. For local dev
 * without API keys, the service will fail fast with a readable error message
 * instructing which env var is missing.
 *
 * Failure semantics:
 *   - Anything before the on-chain mint that fails => the caller's USDC was NOT
 *     pulled; we mark the registration row 'failed' and throw.
 *   - The mint step pulls USDC + mints in one transaction; if it reverts, no
 *     state change happens.
 *   - After the mint, downstream failures (DNS write, email setup) are logged
 *     and the agent row is created with sslStatus='provisioning'. A
 *     reconciliation worker repairs them later.
 */
export class IdentityService {
  /**
   * Compute pricing for a registration without committing.
   * ENS pricing is quoted live on Ethereum L1 because .eth rent and gas move with ETH/USD.
   */
  async computePricing(opts: {
    tld: string;
    registerBasename: boolean;
    registerEns: boolean;
    preferredName?: string;
    basenameLabel?: string;
    ensLabel?: string;
    years?: number;
  }): Promise<PricingBreakdown> {
    if (!opts.preferredName) {
      throw new Error('preferredName is required to compute pricing');
    }
    const years = opts.years ?? 1;
    const durationSeconds = years * 365 * 24 * 60 * 60;

    const domainCost = await this._getDomainCostAtomic(opts.preferredName, opts.tld, years);
    if (domainCost === 0n) {
      throw new Error(
        `Domain price unavailable from registrar for ${opts.preferredName}.${opts.tld}. ` +
          'Please try again or contact support.',
      );
    }

    const basenameCost = opts.registerBasename
      ? (
          await getBasenames().getQuoteUsdcAtomic(
            opts.basenameLabel ?? opts.preferredName,
            durationSeconds,
          )
        ).totalUsdcAtomic
      : 0n;

    // ENS quote usually takes duration but getQuoteUsdcAtomic might not, so we multiply
    const baseEnsCost = opts.registerEns
      ? (await getEns().getQuoteUsdcAtomic(opts.ensLabel ?? opts.preferredName)).totalUsdcAtomic
      : 0n;
    const ensCost = baseEnsCost * BigInt(years);

    const cost = computeRegistrationCost({
      tld: opts.tld,
      registerBasename: opts.registerBasename,
      registerEns: opts.registerEns,
      serviceFee: SERVICE_FEE_USDC_ATOMIC,
      domainMarkup: 0n,
      domainCost,
      basenameFee: 0n,
      basenameCost,
      ensFee: 0n,
      ensCost,
    });
    const treasuryFee = this.computeTreasuryFeeAtomic({
      domainCostAtomic: cost.domainCost,
      basenameCostAtomic: cost.basenameCost,
      ensCostAtomic: cost.ensCost,
      registerBasename: opts.registerBasename,
      registerEns: opts.registerEns,
    });
    const providerCost = cost.total > treasuryFee ? cost.total - treasuryFee : 0n;

    return {
      domainCostUsdc: this._formatUsdc(cost.domainCost),
      basenameCostUsdc: this._formatUsdc(cost.basenameCost),
      ensCostUsdc: this._formatUsdc(cost.ensCost),
      serviceFeeUsdc: this._formatUsdc(cost.serviceFee),
      providerCostUsdc: this._formatUsdc(providerCost),
      treasuryFeeUsdc: this._formatUsdc(treasuryFee),
      totalUsdc: this._formatUsdc(cost.total),
    };
  }

  computeTreasuryFeeAtomic(opts: {
    domainCostAtomic: bigint;
    basenameCostAtomic?: bigint;
    ensCostAtomic?: bigint;
    registerBasename?: boolean;
    registerEns?: boolean;
  }): bigint {
    void opts.basenameCostAtomic;
    void opts.ensCostAtomic;
    void opts.registerBasename;
    void opts.registerEns;
    return opts.domainCostAtomic + SERVICE_FEE_USDC_ATOMIC;
  }

  /**
   * Validate registration parameters before any state-changing work.
   * Throws ValidationError on bad input.
   */
  async validate(params: RegistrationParams): Promise<void> {
    const basenameLabel = params.basenameLabel ?? params.preferredName;
    const ensLabel = params.ensLabel ?? params.preferredName;

    if (isReservedName(params.preferredName)) {
      throw new ValidationError('NAME_RESERVED', `${params.preferredName} is a reserved name`);
    }
    if (params.registerBasename && isReservedName(basenameLabel)) {
      throw new ValidationError('BASENAME_RESERVED', `${basenameLabel} is a reserved Basename`);
    }
    if (params.registerEns && isReservedName(ensLabel)) {
      throw new ValidationError('ENS_RESERVED', `${ensLabel} is a reserved ENS name`);
    }

    const domain = buildDomain(params.preferredName, params.tld ?? 'xyz');

    // 1. Local DB check — already registered with us?
    try {
      const existing = await agentsRepo.getByDomain(domain);
      if (existing) {
        throw new ValidationError('DOMAIN_TAKEN', `${domain} is already registered`);
      }
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      log.warn('db pre-check failed (non-fatal)', { domain, err: String(e) });
    }

    // 2. Spaceship registrar check — available at the registry?
    try {
      const ss = getSpaceship();
      const avail = await ss.checkAvailability(domain);
      if (!avail.available) {
        throw new ValidationError('DOMAIN_UNAVAILABLE', `${domain} is unavailable at registrar`);
      }
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      log.warn('registrar pre-check failed (non-fatal)', { domain, err: String(e) });
    }

    // 3. Basename check — if selected, reject before payment when unavailable.
    if (params.registerBasename) {
      const basename = buildBasename(basenameLabel);
      try {
        const available = await getBasenames().isAvailable(basenameLabel);
        if (!available) {
          throw new ValidationError('BASENAME_UNAVAILABLE', `${basename} is unavailable`);
        }
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError(
          'BASENAME_CHECK_FAILED',
          `Could not verify ${basename}. Try again in a moment.`,
        );
      }
    }

    // 4. ENS check — if selected, reject before payment when unavailable.
    if (params.registerEns) {
      const ensName = buildEnsName(ensLabel);
      try {
        const ens = getEns();
        const available = await ens.isAvailable(ensLabel);
        if (!available) {
          throw new ValidationError('ENS_UNAVAILABLE', `${ensName} is unavailable`);
        }
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError(
          'ENS_CHECK_FAILED',
          `Could not verify ${ensName}. Try again in a moment.`,
        );
      }
    }
  }

  /**
   * Register an agent identity end-to-end.
   *
   * Idempotency: callers should hash (wallet, name, nonce) into idempotencyKey
   * to safely retry without double-processing.
   */
  async register(params: RegistrationParams, idempotencyKey: string): Promise<RegistrationResult> {
    const tld = (params.tld ?? 'xyz') as SupportedTld;
    const basenameLabel = params.basenameLabel ?? params.preferredName;
    const ensLabel = params.ensLabel ?? params.preferredName;
    const ownerAddress = params.ownerAddress ?? params.wallet;
    const domain = buildDomain(params.preferredName, tld);
    const basename = params.registerBasename ? buildBasename(basenameLabel) : null;
    const ensName = params.registerEns ? buildEnsName(ensLabel) : null;
    const years = params.years ?? 1;
    const durationSeconds = years * 365 * 24 * 60 * 60;

    log.info('registration started', { domain, wallet: params.wallet, idempotencyKey });
    recordMetric('registration_started', { domain, wallet: params.wallet });

    const pricing = await this.computePricing({
      tld,
      registerBasename: !!params.registerBasename,
      registerEns: !!params.registerEns,
      preferredName: params.preferredName,
      basenameLabel,
      ensLabel,
      years,
    });

    const totalAtomic = parseUsdc(pricing.totalUsdc);

    // Insert pending registration row (idempotency-safe via unique key)
    const reg = await registrationsRepo.upsertPending({
      agentId: null,
      idempotencyKey,
      txHash: null,
      payerAddress: params.wallet,
      paymentAmount: pricing.totalUsdc,
      domainCost: pricing.domainCostUsdc,
      basenameCost: pricing.basenameCostUsdc,
      ensCost: pricing.ensCostUsdc,
      serviceFee: pricing.serviceFeeUsdc,
      status: 'pending',
      registrarOrderId: null,
      errorMessage: null,
      requestParams: params as unknown as Record<string, unknown>,
      completedAt: null,
    });

    if (!reg) throw new Error('Failed to create registration record');

    try {
      // ─── Step 1: Register ENS on Ethereum L1 (optional) ───────────────
      let ensTxHash: Hex | undefined;
      if (ensName && params.registerEns) {
        const ens = getEns();
        const requiredWei = await ens.getRequiredWei(ensLabel, durationSeconds);
        await getLifiFunding().ensureNativeBalance({
          destination: 'ethereum',
          requiredWei,
          reason: `ens:${ensName}`,
        });
        const ensResult = await ens.register({
          label: ensLabel,
          ownerAddress,
          durationSeconds,
        });
        ensTxHash = ensResult.txHash;
        log.info('ens registered', { ensName, txHash: ensTxHash });
      }

      // ─── Step 2: Pin agent metadata to IPFS ───────────────────────────
      const metadataDoc: AgentMetadataDocument = this._buildMetadata({
        domain,
        basename,
        ensName,
        wallet: params.wallet,
        ownerAddress,
        userMetadata: params.metadata,
      });
      const pinata = getPinata();
      const pinned = await pinata.uploadMetadata(metadataDoc, params.preferredName);
      log.info('metadata pinned', { cid: pinned.cid });

      // ─── Step 3: Register ICANN domain via Spaceship (async) ──────────
      // getOrCreatePlatformContact() auto-creates the contact from env vars
      // on first call, then caches the ID for subsequent calls.
      const contactId = await getOrCreatePlatformContact();
      const ss = getSpaceship();
      const ssResult = await ss.registerDomain({
        domain,
        years,
        contactId,
        autoRenew: false, // we manage renewal via on-chain RenewalVault
        privacyLevel: 'high',
      });
      log.info('domain registration initiated', { domain, operationId: ssResult.operationId, years });

      // Wait for Spaceship to confirm registration before proceeding.
      const opStatus = await ss.waitForOperation(ssResult.operationId, {
        maxWaitSeconds: 120,
      });
      if (opStatus.status !== 'success') {
        throw new Error(
          `Domain registration failed at Spaceship: ${JSON.stringify(opStatus.details)}`,
        );
      }
      log.info('domain registered', { domain });

      // Step 4: Enable Spaceship Basic DNS.
      const dns = getSpaceshipDns();
      await dns.ensureBasicDns(domain);
      log.info('spaceship basic dns ready', { domain });

      // Step 5: Create the apex-only Cloudflare for SaaS hostname.
      let cfHostname:
        | {
            id: string;
            status: string;
            sslStatus: string;
            validationRecords: Record<string, unknown>[];
            dnsValidationRecords: ManagedDnsRecord[];
            validationErrors: Record<string, unknown>[];
          }
        | undefined;
      try {
        cfHostname = await getCloudflareSaas().createApexHostname(domain);
      } catch (e) {
        log.warn('cloudflare saas hostname setup failed (will retry async)', { err: String(e) });
      }

      // Step 6: Email setup (optional).
      let sesIdentityArn: string | undefined;
      let sesVerificationStatus: string | undefined;
      let emailRecords: ManagedDnsRecord[] = [];
      if (params.emailEnabled) {
        try {
          const setup = await getSesEmail().setupDomain(domain);
          sesIdentityArn = setup.identityArn;
          sesVerificationStatus = setup.verificationStatus;
          emailRecords = setup.records;
        } catch (e) {
          log.warn('ses email setup failed (continuing without email)', { err: String(e) });
        }
      }

      // Step 7: Configure baseline DNS records.
      const baselineRecords = buildBaselineDnsRecords({
        domain,
        emailRecords,
        cloudflareValidationRecords: cfHostname?.dnsValidationRecords,
      });

      // Step 8: Register Basename on Base L2 (optional).
      let basenameTxHash: Hex | undefined;
      if (basename && params.registerBasename) {
        try {
          const bn = getBasenames();
          const requiredWei = await bn.getRequiredWei(basenameLabel, durationSeconds);
          await getLifiFunding().ensureNativeBalance({
            destination: 'base',
            requiredWei,
            reason: `basename:${basename}`,
          });
          const bnResult = await bn.register({
            label: basenameLabel,
            ownerAddress,
            durationSeconds,
            setReverseRecord: true,
          });
          basenameTxHash = bnResult.txHash;
          log.info('basename registered', { basename, txHash: basenameTxHash });
        } catch (e) {
          // Basename failure is non-fatal — domain is already registered, just
          // log and continue. A reconciliation job can retry later.
          log.warn('basename registration failed (will retry async)', { err: String(e) });
        }
      }

      // ─── Step 9: Mint AgentID NFT via PaymentRouter contract ──────────
      const mintResult = await this._mintIdentity({
        payer: params.wallet,
        recipient: ownerAddress,
        domain,
        basename: basename ?? '',
        ensName: ensName ?? '',
        metadataUri: pinned.ipfsUri,
        amount: totalAtomic,
        durationSeconds,
        idempotencyKey,
      });
      const tokenId = mintResult.tokenId;

      // ─── Step 10: Persist agent row ───────────────────────────────────
      const agent = await agentsRepo.create({
        walletAddress: params.wallet,
        ownerAddress: ownerAddress,
        agentIdNft: Number(tokenId),
        domain,
        basename,
        ensName,
        status: 'active',
        metadataUri: pinned.ipfsUri,
        metadataJson: metadataDoc as unknown as Record<string, unknown>,
        dnsTarget: params.dnsTarget ?? null,
        framework: params.metadata?.framework ?? null,
        sslStatus: 'provisioning',
        expiresAt: new Date(Date.now() + years * 365 * 24 * 60 * 60 * 1000),
      });

      // ─── Step 11: Persist DNS records + email inbox ───────────────────
      if (agent) {
        await dns.replaceAgentRecords(
          { id: agent.id, domain },
          baselineRecords,
        );

        if (cfHostname) {
          await sslRepo.upsert(agent.id, {
            agentId: agent.id,
            hostname: domain,
            cloudflareCustomHostnameId: cfHostname.id,
            hostnameStatus: cfHostname.status,
            sslStatus: cfHostname.sslStatus,
            validationRecords: cfHostname.validationRecords,
            validationErrors: cfHostname.validationErrors,
          });
        }

        if (params.emailEnabled && sesIdentityArn) {
          await emailRepo.upsertInbox(agent.id, {
            agentId: agent.id,
            emailAddress: `agent@${domain}`,
            sesIdentityArn,
            sesVerificationStatus: sesVerificationStatus ?? 'Pending',
          });
        }
      }

      // ─── Step 12: Mark registration completed ─────────────────────────
      await registrationsRepo.update(reg.id, {
        status: 'completed',
        agentId: agent?.id ?? null,
        completedAt: new Date(),
      });

      log.info('registration completed', { domain, tokenId: tokenId.toString() });
      recordMetric('registration_completed', {
        domain,
        tokenId: tokenId.toString(),
        registrationId: reg.id,
      });

      return {
        agentId: agent?.id ?? '',
        nftTokenId: Number(tokenId),
        domain,
        basename,
        ensName,
        txHash: mintResult.txHash ?? ensTxHash ?? basenameTxHash ?? ('0x' as Hex),
        sslStatus: 'provisioning',
        estimatedReadyAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        metadataUri: pinned.ipfsUri,
      };
    } catch (err) {
      log.error('registration failed', { err: String(err), domain });
      recordMetric('registration_failed', {
        domain,
        registrationId: reg.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      await registrationsRepo.update(reg.id, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // -----------------------------------------------------------------
  // INTERNAL
  // -----------------------------------------------------------------

  private async _mintIdentity(opts: {
    payer: Address;
    recipient: Address;
    domain: string;
    basename: string;
    ensName: string;
    metadataUri: string;
    amount: bigint;
    durationSeconds: number;
    idempotencyKey: string;
  }): Promise<{ tokenId: bigint; txHash: Hex }> {
    const wallet = getBackendWalletClient();
    const publicClient = getPublicClient();
    const { paymentRouter } = getContractAddresses();
    if (!paymentRouter) throw new Error('PAYMENT_ROUTER_ADDRESS not configured');

    const idempotencyKeyHex = keccak256(toHex(opts.idempotencyKey));

    const intent = {
      payer: opts.payer,
      recipient: opts.recipient,
      domain: opts.domain,
      basename: opts.basename,
      ensName: opts.ensName,
      metadataUri: opts.metadataUri,
      amount: opts.amount,
      duration: BigInt(opts.durationSeconds),
      idempotencyKey: idempotencyKeyHex,
    } as const;

    // Use mintForPaidRegistration (Flow A) since the x402 facilitator has
    // already moved USDC from the agent's wallet to treasury before this call.
    // This avoids requiring the agent to also approve() this contract.
    let txHash: Hex;
    try {
      txHash = await wallet.writeContract({
        address: paymentRouter,
        abi: PAYMENT_ROUTER_ABI,
        functionName: 'mintForPaidRegistration',
        args: [intent],
        chain: wallet.chain,
        account: wallet.account!,
      });
      recordMetric('mint_submitted', { txHash, domain: opts.domain });
    } catch (e) {
      recordMetric('mint_failed', { domain: opts.domain, reason: String(e) });
      throw e;
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    log.info('mint tx confirmed', { txHash, blockNumber: receipt.blockNumber.toString() });

    // Decode tokenId from RegistrationProcessed event:
    // event RegistrationProcessed(bytes32 indexed idempotencyKey, uint256 indexed tokenId, ...)
    for (const lg of receipt.logs) {
      if (lg.topics.length >= 3 && lg.topics[1] === idempotencyKeyHex) {
        const tokenIdHex = lg.topics[2] as `0x${string}`;
        const tokenId = BigInt(tokenIdHex);
        recordMetric('mint_succeeded', {
          txHash,
          tokenId: tokenId.toString(),
          blockNumber: receipt.blockNumber.toString(),
        });
        return { tokenId, txHash };
      }
    }
    recordMetric('mint_failed', { domain: opts.domain, reason: 'token_id_decode_failed', txHash });
    throw new Error('Could not decode tokenId from receipt');
  }

  private _buildMetadata(opts: {
    domain: string;
    basename: string | null;
    ensName: string | null;
    wallet: Address;
    ownerAddress?: Address;
    userMetadata?: AgentMetadata;
  }): AgentMetadataDocument {
    const m = opts.userMetadata ?? {};
    return {
      name: m.name ?? opts.domain,
      description: m.description ?? `AI agent identity registered on AgentDomain.`,
      image: m.imageUri,
      external_url: `https://${opts.domain}`,
      attributes: [
        { trait_type: 'Domain', value: opts.domain },
        { trait_type: 'Basename', value: opts.basename ?? 'none' },
        { trait_type: 'ENS', value: opts.ensName ?? 'none' },
        { trait_type: 'Framework', value: m.framework ?? 'custom' },
      ],
      agentdomain: {
        domain: opts.domain,
        basename: opts.basename ?? undefined,
        ensName: opts.ensName ?? undefined,
        walletAddress: opts.ownerAddress ?? opts.wallet,
        capabilities: m.capabilities,
        framework: m.framework,
        x402Endpoint: m.x402Endpoint,
        socials: m.socials as Record<string, string> | undefined,
      },
    };
  }

  private async _getDomainCostAtomic(preferredName: string, tld: string, years: number): Promise<bigint> {
    if (!process.env.SPACESHIP_API_KEY || !process.env.SPACESHIP_API_SECRET) {
      throw new Error(
        'SPACESHIP_API_KEY and SPACESHIP_API_SECRET are required to compute domain pricing',
      );
    }

    const domain = buildDomain(preferredName, tld);
    const availability = await getSpaceship().checkAvailability(domain);
    const priceNum = Number(availability.priceUsd);
    const renewPriceNum = Number(availability.renewPriceUsd ?? availability.priceUsd);
    
    let totalUsd = 0;
    if (priceNum > 0) {
       totalUsd = priceNum + (Math.max(1, years) - 1) * renewPriceNum;
    }
    const livePrice = totalUsd > 0 ? parseUsdc(totalUsd.toFixed(2)) : 0n;
    if (livePrice > 0n) return livePrice;
    
    log.warn('spaceship returned no price for domain', { domain });
    return 0n;
  }

  private _formatUsdc(atomic: bigint): string {
    const whole = atomic / 1_000_000n;
    const frac = atomic % 1_000_000n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  }
}

export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

let _instance: IdentityService | null = null;
export function getIdentityService(): IdentityService {
  if (!_instance) _instance = new IdentityService();
  return _instance;
}
