# @agentdomain/sdk

TypeScript SDK for AgentDomain, the autonomous identity stack for AI agents.

AgentDomain provides domain, DNS, SSL, email, Basename, ENS, x402 USDC checkout, AgentID NFT, renewal controls, and per-agent Premium Plans.

The production API base is `https://api.agentdomain.app/api/v1`. A direct `GET` request returns the
machine-readable service discovery document; human documentation is available at
`https://docs.agentdomain.app`.

```bash
npm install @agentdomain/sdk viem
```

```ts
import { AgentDomain } from '@agentdomain/sdk';

const ad = new AgentDomain({
  apiUrl: 'https://api.agentdomain.app/api/v1',
  walletClient,
  builderCode: process.env.AGENTDOMAIN_BUILDER_CODE,
});

const quote = await ad.quote({
  preferredName: 'research-agent',
  tld: 'xyz',
  registerBasename: true,
  registerEns: false,
  emailUsername: 'agent',
  premiumPlan: 'pro',
});
```

`builderCode` is the public ERC-8021 app identifier assigned to your application;
it is not a wallet secret. It is required when the SDK creates a direct Base
transaction, including `setAutoRenew` and the transaction returned by
`withdrawFromVault`. Missing or invalid attribution fails before wallet
submission. Read requests and offchain signatures are unaffected. x402 v2 paid
requests continue to use the resource server's standard `builder-code`
extension rather than a direct-transaction suffix.

The SDK handles x402 v2 payment challenges for registration and Premium Plan
purchases when a `walletClient` is provided. RenewalVault funding uses a
delegated EIP-3009 authorization followed by the server's vault workflow; it is
not converted into an x402 paid resource. Email setup, SSL certification, DNS
orchestration, and AgentID NFT mint/orchestration are included in the annual
platform fee; Basename and ENS remain optional paid add-ons.

## Autonomous Premium Plan actions

An agent can buy or upgrade its Premium Plan autonomously only when its runtime has an owner or delegated wallet signer on Base with enough USDC. An agent-scoped API key is enough for scoped operations like email/DNS, but it cannot sign x402 paid purchases.

```ts
const identity = await ad.register({
  preferredName: 'research-agent',
  tld: 'xyz',
  years: 1,
  premiumPlan: 'pro',
});

await ad.purchaseServicePlan({
  agentId: identity.agentId,
  plan: 'enterprise',
});
```

## Agent-scoped API keys

API keys are scoped to one agent identity and count against that agent's Premium Plan limit. Create the key from the owner dashboard or with an owner wallet signature, then pass the full key to the agent runtime.

```ts
const owner = new AgentDomain({ walletClient });
const key = await owner.createApiKey(agentId, 'Production key');

const agent = new AgentDomain({
  apiKey: key.fullKey,
});

await agent.sendEmail(agentId, {
  to: 'admin@example.com',
  fromAddress: 'agent@research-agent.xyz',
  subject: 'Status',
  text: 'Agent online.',
});
```

The full key is returned only once. A scoped key can manage only its own agent ID.

## Professional DNS management

The SDK supports every currently available DNS record type: `A`, `AAAA`,
`ALIAS`, `CAA`, `CNAME`, `HTTPS`, `MX`, `NS`, `PTR`, `SRV`, `SVCB`, `TLSA`, and
`TXT`. Structured record data is preferred; legacy `value` and `priority`
payloads remain compatible.

```ts
const capabilities = await agent.getDnsCapabilities(agentId);
const records = [
  {
    type: 'SRV',
    name: '_https._tcp.api',
    ttl: 300,
    data: { priority: 10, weight: 5, port: 443, target: 'edge.example.com' },
  },
];

const preview = await agent.previewDnsBatch(agentId, records);
await agent.applyDnsBatch(agentId, records, preview.baseRevision);
const zoneFile = await agent.exportDnsZone(agentId);
```

Batch and BIND imports must be previewed first. Apply calls require the
`baseRevision` from that preview, preventing stale changes from overwriting a
newer zone. System-managed SSL, email, verification, and routing records remain
read-only and are preserved during replace operations.

## Monthly usage, batch send, and inbound webhooks

All plans combine sent recipients and accepted inbound messages into one monthly
quota. Send up to 100 message objects in one batch request, inspect current
usage, and configure a signed inbound webhook:

```ts
await agent.sendEmailBatch(agentId, {
  messages: [{ to: 'ops@example.com', subject: 'Status', text: 'Agent online.' }],
});

const usage = await agent.getEmailUsage(agentId);
const webhook = await agent.setEmailWebhook(agentId, {
  url: 'https://example.com/webhooks/agentdomain',
  payloadMode: 'metadata',
  enabled: true,
});
```

## Email addresses

Every agent gets one editable primary email address. Starter agents can create 5
aliases, Pro agents 10, and Enterprise agents 20.

```ts
await ad.updatePrimaryEmail(agentId, 'support');
await ad.createEmailAlias(agentId, 'billing');
await ad.deleteEmailAlias(agentId, 'billing@research-agent.xyz');
```
