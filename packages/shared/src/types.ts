import type { Address, Hex } from 'viem';
import { SERVICE_PLAN_INTERVALS, SERVICE_PLAN_KEYS, SUPPORTED_TLDS } from './constants.js';

export type SupportedTld = (typeof SUPPORTED_TLDS)[number];
export type ServicePlanKey = (typeof SERVICE_PLAN_KEYS)[number];
export type ServicePlanInterval = (typeof SERVICE_PLAN_INTERVALS)[number];

export interface ServicePlanLimits {
  emailPerHour: number;
  emailPerDay: number;
  apiKeys: number;
  dnsRecords: number;
  emailAliases: number;
  emailRetentionDays: number;
}

export interface ServicePlanEntitlement {
  plan: ServicePlanKey;
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
  | 'domain'
  | 'platform'
  | 'premium_plan'
  | 'ssl'
  | 'email'
  | 'basename'
  | 'ens';

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

export type DnsRecordType = 'A' | 'AAAA' | 'ALIAS' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';

export interface DnsRecord {
  id: string;
  type: DnsRecordType;
  name: string;
  value: string;
  ttl: number;
  priority?: number | null;
  systemManaged?: boolean;
  purpose?: string | null;
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
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extensions?: Record<string, unknown>;
}
