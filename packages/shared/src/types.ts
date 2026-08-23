import type { Address, Hex } from 'viem';
import { SERVICE_PLAN_INTERVALS, SERVICE_PLAN_KEYS, SUPPORTED_TLDS } from './constants.js';

export type SupportedTld = (typeof SUPPORTED_TLDS)[number];
export type ServicePlanKey = (typeof SERVICE_PLAN_KEYS)[number];
export type ServicePlanInterval = (typeof SERVICE_PLAN_INTERVALS)[number];
export type EnterpriseEmailTier = (typeof import('./constants.js').ENTERPRISE_EMAIL_TIERS)[number];
export type ServicePlanSku = 'included' | 'starter' | 'pro' | `enterprise-${EnterpriseEmailTier}`;

export interface ServicePlanLimits {
  monthlyEmails: number;
  requestsPerSecond: number;
  apiKeys: number;
  dnsRecords: number;
  emailAliases: number;
  emailRetentionDays: number;
}

export interface ServicePlanEntitlement {
  plan: ServicePlanKey;
  planSku?: ServicePlanSku;
  status: 'included' | 'active' | 'expired' | 'canceled';
  interval: ServicePlanInterval | null;
  autoRenew: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  limits: ServicePlanLimits;
  supportTier: string;
  registryPriority: boolean;
}

export interface RegistrationParams {
  preferredName: string;
  tld: SupportedTld;
  registerBasename: boolean;
  basenameLabel?: string;
  registerEns: boolean;
  ensLabel?: string;
  ownerAddress?: Address;
  emailEnabled: boolean;
  emailUsername?: string;
  premiumPlan?: ServicePlanKey;
  premiumPlanSku?: ServicePlanSku;
  years: number;
  autoRenew: boolean;
  dnsTarget?: string;
  metadata?: AgentMetadata;
  wallet: Address;
  turnstileToken?: string;
}

export interface RegistrationResult {
  registrationId?: string;
  agentId: string;
  nftTokenId: number;
  domain: string;
  basename: string | null;
  ensName: string | null;
  txHash: Hex;
  sslStatus: string;
  estimatedReadyAt: string;
  metadataUri: string;
  renewalSnapshot?: RenewalPriceSnapshot;
  provisioningStatus?: 'completed' | 'processing' | 'recovery_required';
  provisioningMessage?: string;
}

export interface AgentMetadata {
  name?: string;
  description?: string;
  imageUri?: string;
  framework?: string;
  capabilities?: string[];
  x402Endpoint?: string;
  socials?: Record<string, string>;
}

export interface PricingBreakdown {
  domainCostUsdc: string;
  basenameCostUsdc: string;
  ensCostUsdc: string;
  serviceFeeUsdc: string;
  platformFeeUsdc: string;
  premiumPlan: ServicePlanKey;
  premiumPlanSku?: ServicePlanSku;
  premiumPlanLabel: string;
  premiumPlanFeeUsdc: string;
  emailFeeUsdc: string;
  sslCertificationFeeUsdc: string;
  emailIncluded: boolean;
  sslIncluded: boolean;
  includedServices: string[];
  providerCostUsdc: string;
  treasuryFeeUsdc: string;
  totalUsdc: string;
}

export type RenewalSnapshotItemKey =
  'domain' | 'platform' | 'premium_plan' | 'ssl' | 'email' | 'basename' | 'ens';

export interface RenewalPriceSnapshotItem {
  key: RenewalSnapshotItemKey;
  label: string;
  name?: string;
  selected: boolean;
  provisioned: boolean;
  includedInAutoRenew: boolean;
  amountUsdc: string | null;
  amountAtomic: string | null;
  source: 'spaceship' | 'agentdomain' | 'ses' | 'basenames' | 'ens';
  note?: string;
}

export interface RenewalPriceSnapshot {
  version: 1;
  capturedAt: string;
  years: number;
  currency: 'USDC';
  autoRenewTotalUsdc: string;
  autoRenewTotalAtomic: string;
  fullServiceTotalUsdc: string | null;
  fullServiceTotalAtomic: string | null;
  items: RenewalPriceSnapshotItem[];
  warnings: string[];
}

export interface EmailMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  providerMessageId?: string | null;
  fromAddress: string;
  toAddress?: string | null;
  subject?: string | null;
  text?: string | null;
  verificationCodes?: string[] | null;
  spamVerdict?: string | null;
  virusVerdict?: string | null;
  receivedAt: string;
  read: boolean;
}

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402PaymentRequirement[];
  extensions?: Record<string, unknown>;
}
