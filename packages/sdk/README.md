# @agentdomain/sdk

TypeScript SDK for AgentDomain, the autonomous identity stack for AI agents.

AgentDomain provides domain, DNS, SSL, email, Basename, ENS, x402 USDC checkout, AgentID NFT, renewal controls, and per-agent Premium Plans.

The production API base is `https://api.agentdomain.app/api/v1`. A direct `GET` request returns the
machine-readable service discovery document; human documentation is available at
`https://docs.agentdomain.app`.

The SDK resolves a relative `apiUrl` against the browser location at construction,
before any signing or payment. Outside a browser, configure an absolute URL.
API bases must use HTTPS; explicitly configured HTTP `localhost`, `127.0.0.1`, and
`[::1]` endpoints are allowed for local development. Embedded credentials, query
strings, and fragments are rejected before requests begin.

```bash
npm install @agentdomain/sdk@0.9.0 viem@2.56.3
```

## Quick start

Public discovery and quotes do not require credentials:

```ts
import { AgentDomain } from '@agentdomain/sdk';

const ad = new AgentDomain();

const availability = await ad.checkAvailability('research-agent', {
  tld: 'xyz',
});

const quote = await ad.quote({
  preferredName: 'research-agent',
  tld: 'xyz',
  registerBasename: false,
  registerEns: false,
  emailUsername: 'agent',
  premiumPlan: 'included',
});
```

Pass a viem `walletClient` only for wallet-authorized or paid operations. Pass an
agent-scoped API key only to a trusted server or agent runtime; never expose it
in browser-delivered configuration.

## Authentication model

- Public availability, quote, and registry search methods need no credential.
- Owner operations use a wallet signature through the supplied `walletClient`.
- Agent-scoped operations can use a narrowly scoped `apiKey`.
- x402 purchases require an authorized Base wallet with sufficient USDC.
- Direct Base writes also require the public `builderCode` attribution value.

The SDK does not persist credentials. Applications remain responsible for
keeping wallet and API-key material out of source, logs, client bundles, and
untrusted process environments.

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

## Asynchronous registration

New in 0.9.0: submission, status, waiting, and recovery methods distinguish payment
acceptance from completed registration. SDK 0.8.x and earlier may treat HTTP `202`
as a `RegistrationResult`; their return type is not evidence that registration
finished. Upgrade to 0.9.0 or integrate the documented HTTP status contract directly.

```ts
import { AgentDomain, RegistrationPendingError } from '@agentdomain/sdk';

const ad = new AgentDomain({ walletClient });
const controller = new AbortController();
try {
  const identity = await ad.register(
    { preferredName: 'research-agent', tld: 'xyz' },
    { timeoutMs: 600_000, signal: controller.signal },
  );
  console.log(identity.agentId);
} catch (error) {
  if (!(error instanceof RegistrationPendingError)) throw error;
  // Keep this non-secret handle. Timeout or abort does not cancel the purchase.
  console.log(error.reason, error.handle);
}
```

`submitRegistration(args, options)` sends `Prefer: respond-async` and returns either
the minimum `RegistrationAccepted` response on `202` or the original
`RegistrationResult` on `200`. `register()` calls it once, then waits on status GETs
after `202`. `waitForRegistration(acceptedOrIdOrHandle, options)` resumes waiting
without submitting any purchase. Completion returns the server-projected
`progress.result`; missing results produce `completion_result_unavailable`, never
invented NFT IDs, transaction hashes, or metadata fields. Legacy public `200` fields
remain compatible and may still report unfinished provisioning. The SDK validates
required fields and the requested domain, then returns the schema-projected result;
unknown root or nested fields are not echoed to callers.

`getRegistration(id)` and `getRegistrations({ limit, offset })` require the **payer**
wallet, not a different designated NFT owner. They never send an agent API key or
payment header as authorization. Lists default to 20 entries and accept at most 50.
With a wallet client, they omit cookies and use `X-Agent-Signature`
and reuse its in-memory signature for up to four minutes, then sign afresh. Rejected
signing and authorization failures stop waiting instead of prompting repeatedly.
Every status/list/recovery read sends `expectedPayer` from the signer, a recovery
handle, or an explicit option. It is an identity consistency check, not authentication.
The SDK rejects a missing or mismatched `X-Authenticated-Wallet` response header
before reading the response body, preventing a different session wallet from being used.
For an already signed-in browser, use `registrationAuth: 'session'` and supply
`registrationExpectedPayer` in the constructor or `expectedPayer` per request when
there is no wallet client. Session requests include cookies and do not request a
read signature. Session-only reads without a known payer fail before fetching.
Sign in and read status on the same API
host. A server-side SIWE integration must provide a cookie-preserving fetch runtime;
Node fetch does not acquire a browser session automatically.

Waiting defaults to ten minutes after acceptance; individual requests and submission
default to sixty seconds. Both support `AbortSignal` and `timeoutMs`. Status polling
honors `pollAfterSeconds` and transient-read `Retry-After` with a five-second minimum. `action_required` and
`awaiting_payment` stop the waiter with `RegistrationPendingError`; `failed` and
`refunded` produce `RegistrationFailedError` containing the server progress. A wait
timeout, abort, or read outage is not a failed-registration assertion.
An HTTP `202` response containing a minimal `action_required` handle immediately
produces `RegistrationPendingError` with that reason; read its status instead of paying again.

On a lost POST response, the SDK raises `RegistrationPendingError` and never retries
the POST or signs a new payment automatically. A known payment identifier is only a
reference, never status authorization. Use `getRegistration()` when an ID is known.
For an unknown ID, `recoverRegistration(error.handle)` performs authenticated list
reads and requires exactly one match for the exact domain and inclusive submission
time interval. Known-ID recovery enforces the same domain, time, and authenticated-payer
binding; knowing an ID does not bypass handle validation. When only an ID is available,
use a payer-authenticated `getRegistration()` read instead of inventing a recovery window.
Discovery scans at most ten pages of 50 entries (500 total) and refuses multiple matches,
incomplete searches, and no-match results. Clock skew can prevent a time match; do not
interpret no match as proof that no payment occurred. Inspect the payer's list or
contact support instead of starting another checkout.

`completed` in the status contract means the identity and all selected services are
ready, not merely that payment succeeded or an agent ID exists. DNS, HTTPS, email, and
selected names can take additional time. Estimates may be `null`; there is no instant
completion guarantee.

## Upgrading from 0.8.x

Existing `register(args)` calls remain valid, but HTTP `202` now starts authenticated
waiting instead of returning an acceptance body as a completed result. Use
`submitRegistration()` for acceptance without waiting for asynchronous provisioning,
and handle the structured errors described above. Legacy HTTP `200` results are validated and
schema-projected, so callers must not rely on unknown response fields.

The connected signer must match the registration payer (`args.wallet`); use
`ownerAddress` for a different designated NFT owner. Registration does not authorize
with an agent API key. Custom API adapters must support the documented payer-scoped
status contract, including `X-Authenticated-Wallet`. API URL validation applies at
construction, including to clients used only for discovery.

Align/deduplicate viem to the reviewed 2.56.3 version across the SDK and your client
code. An independently pinned 2.55.8 `PublicClient` lacks the required
`watchBlockHeaders` member and can fail TypeScript assignment. This release does not
promise arbitrary mixed-version viem compatibility. Package imports remain ESM-only.

The x402 packages are aligned at 2.25.0. `createX402PaymentHeaders()` explicitly
disables the upstream default $1 cap and recognized-asset allowlist to preserve its
previous payment-selection policy. This does not introduce a spending budget or
independently verify an earlier quote. Callers must authorize the payment terms;
Base-mainnet exact v2 signing and the existing request-binding checks remain in place.

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

## Links

- [TypeScript SDK guide](https://docs.agentdomain.app/sdk/typescript)
- [API reference](https://docs.agentdomain.app/api-reference/overview)
- [Source](https://github.com/0xmdrakib/AgentDomain/tree/main/packages/sdk)
- [Security policy](https://github.com/0xmdrakib/AgentDomain/security/policy)
