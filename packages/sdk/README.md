# @agentdomain/sdk

TypeScript SDK for AgentDomain, the autonomous identity stack for AI agents.

AgentDomain provides domain, DNS, SSL, email, Basename, ENS, x402 USDC checkout, AgentID NFT, renewal controls, and per-agent Premium Plans.

```bash
npm install @agentdomain/sdk viem
```

```ts
import { AgentDomain } from '@agentdomain/sdk';

const ad = new AgentDomain({
  apiUrl: 'https://agentdomain.app/api/v1',
  walletClient,
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

The SDK handles x402 payment challenges for registration, RenewalVault funding, and Premium Plan purchases when a `walletClient` is provided. Email setup, SSL certification, DNS orchestration, and AgentID NFT mint/orchestration are included in the annual platform fee; Basename and ENS remain optional paid add-ons.

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

## Email addresses

Every agent gets one editable primary email address. Pro agents can create 5 aliases and Enterprise agents can create 20 aliases.

```ts
await ad.updatePrimaryEmail(agentId, 'support');
await ad.createEmailAlias(agentId, 'billing');
await ad.deleteEmailAlias(agentId, 'billing@research-agent.xyz');
```
