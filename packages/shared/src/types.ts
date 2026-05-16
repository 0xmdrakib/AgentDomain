import type { Address, Hex } from 'viem';
import { SUPPORTED_TLDS } from './constants';

export type SupportedTld = (typeof SUPPORTED_TLDS)[number];

export interface RegistrationParams {
  preferredName: string;
  tld: SupportedTld;
  registerBasename: boolean;
  basenameLabel?: string;
  registerEns: boolean;
  ensLabel?: string;
  ownerAddress?: Address;
  emailEnabled: boolean;
  years: number;
  autoRenew: boolean;
  dnsTarget?: string;
  metadata?: AgentMetadata;
  wallet: Address;
  turnstileToken?: string;
}

export interface RegistrationResult {
  agentId: string;
  nftTokenId: number;
  domain: string;
  basename: string | null;
  ensName: string | null;
  txHash: Hex;
  sslStatus: string;
  estimatedReadyAt: string;
  metadataUri: string;
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
  providerCostUsdc: string;
  treasuryFeeUsdc: string;
  totalUsdc: string;
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
}
