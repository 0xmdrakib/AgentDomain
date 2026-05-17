export const entities = {
  agent: 'AGENT',
  registration: 'REGISTRATION',
  dnsRecord: 'DNS_RECORD',
  sslHostname: 'SSL_HOSTNAME',
  emailInbox: 'EMAIL_INBOX',
  emailMessage: 'EMAIL_MESSAGE',
  emailBlocklist: 'EMAIL_BLOCKLIST',
  renewal: 'RENEWAL',
  discountCode: 'DISCOUNT_CODE',
  user: 'USER',
  apiKey: 'API_KEY',
  reputationEvent: 'REPUTATION_EVENT',
  lookup: 'LOOKUP',
} as const;

export function pkAgent(agentId: string) {
  return `AGENT#${agentId}`;
}

export function skAgent() {
  return 'PROFILE';
}

export function pkRegistration(id: string) {
  return `REGISTRATION#${id}`;
}

export function pkDiscount(id: string) {
  return `DISCOUNT#${id}`;
}

export function pkUser(id: string) {
  return `USER#${id}`;
}

export function pkApiKey(id: string) {
  return `APIKEY#${id}`;
}

export function pkLookup(value: string) {
  return `LOOKUP#${value}`;
}

export function skLookup() {
  return 'LOOKUP';
}

export function skDnsRecord(recordId: string) {
  return `DNS#${recordId}`;
}

export function skSslHostname() {
  return 'SSL#HOSTNAME';
}

export function skEmailInbox() {
  return 'EMAIL#INBOX';
}

export function skEmailMessage(receivedAtIso: string, id: string) {
  return `EMAIL#MESSAGE#${receivedAtIso}#${id}`;
}

export function skEmailBlocklist(id: string) {
  return `EMAIL#BLOCK#${id}`;
}

export function skRenewal(scheduledForIso: string, id: string) {
  return `RENEWAL#${scheduledForIso}#${id}`;
}

export function domainLookup(domain: string) {
  return `DOMAIN#${domain.toLowerCase()}`;
}

export function walletLookup(wallet: string) {
  return `WALLET#${wallet.toLowerCase()}`;
}

export function emailLookup(email: string) {
  return `EMAIL#${email.toLowerCase()}`;
}

export function apiKeyLookup(hashOrPrefix: string) {
  return `APIKEY#${hashOrPrefix}`;
}

export function apiKeyPrefixLookup(prefix: string) {
  return `APIKEY_PREFIX#${prefix}`;
}

export function registrationIdempotencyLookup(key: string) {
  return `REG_IDEMPOTENCY#${key}`;
}

export function providerMessageLookup(id: string) {
  return `PROVIDER_MESSAGE#${id}`;
}

export function discountCodeLookup(code: string) {
  return `DISCOUNT#${code.toUpperCase()}`;
}

export function userWalletLookup(wallet: string) {
  return `USER_WALLET#${wallet.toLowerCase()}`;
}

export function gsiEntity(entity: string, sort: string) {
  return { GSI1PK: `ENTITY#${entity}`, GSI1SK: sort };
}

export function gsiWallet(wallet: string, sort: string) {
  return { GSI1PK: walletLookup(wallet), GSI1SK: sort };
}

export function gsiStatus(entity: string, status: string, sort: string) {
  return { GSI1PK: `STATUS#${entity}#${status}`, GSI1SK: sort };
}
