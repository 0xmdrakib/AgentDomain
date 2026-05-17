export type AgentStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type RegistrationStatus = 'pending' | 'completed' | 'failed';
export type RenewalStatus = 'scheduled' | 'in_progress' | 'completed' | 'failed';
export type DnsRecordType = 'A' | 'AAAA' | 'ALIAS' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';
export type SslStatus = 'pending' | 'provisioning' | 'active' | 'failed' | 'expired';
export type RegistrationFlowStep =
  | 'payment'
  | 'ens'
  | 'metadata'
  | 'domain'
  | 'dns'
  | 'ssl'
  | 'email'
  | 'basename'
  | 'mint'
  | 'persist';
export type RegistrationFlowStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface RegistrationStepState {
  status: RegistrationFlowStatus;
  updatedAt: string;
  error: string | null;
  txHash: string | null;
  note: string | null;
}

export interface RegistrationProgress {
  overall: 'pending' | 'running' | 'partial' | 'completed' | 'failed';
  currentStep: RegistrationFlowStep | null;
  steps: Partial<Record<RegistrationFlowStep, RegistrationStepState>>;
}

export interface Agent {
  id: string;
  walletAddress: string;
  ownerAddress: string;
  agentIdNft: number;
  domain: string;
  basename: string | null;
  ensName: string | null;
  status: AgentStatus;
  metadataUri: string | null;
  metadataJson: Record<string, unknown> | null;
  sslStatus: SslStatus;
  dnsTarget: string | null;
  framework: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export type NewAgent = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Agent, 'id' | 'createdAt' | 'updatedAt'>>;

export interface Registration {
  id: string;
  agentId: string | null;
  idempotencyKey: string;
  paymentTxHash: string | null;
  txHash: string | null;
  payerAddress: string;
  paymentAmount: string;
  domainCost: string;
  basenameCost: string;
  ensCost: string;
  serviceFee: string;
  status: RegistrationStatus;
  registrarOrderId: string | null;
  errorMessage: string | null;
  requestParams: Record<string, unknown> | null;
  progress: RegistrationProgress | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type NewRegistration = Omit<Registration, 'id' | 'createdAt'> &
  Partial<Pick<Registration, 'id' | 'createdAt' | 'paymentTxHash' | 'progress'>>;

export interface DnsRecordRow {
  id: string;
  agentId: string;
  type: DnsRecordType;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  providerRecordId: string | null;
  provider: string;
  systemManaged: boolean;
  purpose: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDnsRecord = Omit<DnsRecordRow, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<DnsRecordRow, 'id' | 'createdAt' | 'updatedAt'>>;

export interface SslHostnameRow {
  id: string;
  agentId: string;
  hostname: string;
  cloudflareCustomHostnameId: string;
  hostnameStatus: string;
  sslStatus: string;
  validationRecords: Record<string, unknown>[] | null;
  validationErrors: Record<string, unknown>[] | null;
  createdAt: Date;
  updatedAt: Date;
  lastError: string | null;
}

export type NewSslHostname = Pick<SslHostnameRow, 'agentId' | 'hostname' | 'cloudflareCustomHostnameId'> &
  Partial<Omit<SslHostnameRow, 'agentId' | 'hostname' | 'cloudflareCustomHostnameId'>>;

export interface EmailInboxRow {
  id: string;
  agentId: string;
  emailAddress: string;
  sesIdentityArn: string | null;
  sesVerificationStatus: string;
  sesMailFromDomain: string | null;
  dkimConfigured: boolean;
  spfConfigured: boolean;
  dmarcConfigured: boolean;
  createdAt: Date;
}

export type NewEmailInbox = Pick<EmailInboxRow, 'agentId' | 'emailAddress'> &
  Partial<Omit<EmailInboxRow, 'agentId' | 'emailAddress'>>;

export interface EmailMessageRow {
  id: string;
  inboxId: string;
  direction: string;
  providerMessageId: string | null;
  fromAddress: string;
  toAddress: string | null;
  subject: string | null;
  text: string | null;
  verificationCodes: string[] | null;
  spamVerdict: string | null;
  virusVerdict: string | null;
  receivedAt: Date;
  read: boolean;
}

export type NewEmailMessage = Omit<EmailMessageRow, 'id' | 'receivedAt'> &
  Partial<Pick<EmailMessageRow, 'id' | 'receivedAt'>>;

export interface EmailBlocklistRow {
  id: string;
  inboxId: string;
  value: string;
  reason: string | null;
  createdAt: Date;
}

export interface Renewal {
  id: string;
  agentId: string;
  scheduledFor: Date;
  amount: string;
  status: RenewalStatus;
  txHash: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type NewRenewal = Omit<Renewal, 'id' | 'createdAt'> & Partial<Pick<Renewal, 'id' | 'createdAt'>>;

export interface DiscountCode {
  id: string;
  code: string;
  usageLimit: number;
  usedCount: number;
  discountPercent: number;
  appliesTo: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface User {
  id: string;
  walletAddress: string;
  email: string | null;
  createdAt: Date;
}

export interface ApiKeyRow {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface RepositoryList<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface PlatformStats {
  agents: { total: number; active: number; expired: number; revoked: number };
  registrations: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    partial: number;
    paymentSettled: number;
    last24h: number;
    last7d: number;
  };
  renewals: { total: number; completed: number; failed: number };
  revenue: { totalUsdc: string };
}
