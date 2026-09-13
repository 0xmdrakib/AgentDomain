# Pre-existing Work: ETHOnline 2026

AgentDomain is an existing product. This Continuity entry adds resumable,
wallet-safe registration, independent identity and renewal inspection,
owner-approved auto-renew controls, three framework integrations and
machine-readable documentation. It does not present the original platform,
contracts, x402 protocol, SDK or documentation site as newly created during ETHOnline.

## Three Source Layers

1. **Pre-event baseline:**
   [`f1bac8f44830cd8e57cfa148ad876ef6933966a0`](https://github.com/0xmdrakib/AgentDomain/commit/f1bac8f44830cd8e57cfa148ad876ef6933966a0),
   committed **2026-09-03T04:22:48Z**. This is the public main ancestor before
   kickoff, not a tag created at kickoff. Existing platform capabilities below
   belong to this layer.
2. **Event registration extensions:**
   [`f14392b280d117380cdf9a92b78f0bd37f78b619`](https://github.com/0xmdrakib/AgentDomain/commit/f14392b280d117380cdf9a92b78f0bd37f78b619),
   committed **2026-09-06T01:18:16Z**, and
   [`c4f477c617f5832df618a508e5769bdf44a738a9`](https://github.com/0xmdrakib/AgentDomain/commit/c4f477c617f5832df618a508e5769bdf44a738a9),
   committed **2026-09-08T22:33:10Z**. These add resumable registration,
   wallet-safe tracking, payment-binding/rejection handling, notifications and
   related tests. They are new event work in this entry, not pre-event code.
3. **Final-day public extensions:** developed on top of
   [`4ac0d284e603a2289c248a981821ee975899e699`](https://github.com/0xmdrakib/AgentDomain/commit/4ac0d284e603a2289c248a981821ee975899e699),
   committed **2026-09-12T00:39:31Z**. This is only the starting snapshot for the
   September 13 inspection, renewal, framework and machine-docs work. It already
   includes layer 2; using it does not make that earlier event work pre-existing
   to the whole entry or count it again as newly written final-day code.

Times above are UTC commit times. See the
[pre-event-to-September-12 diff](https://github.com/0xmdrakib/AgentDomain/compare/f1bac8f44830cd8e57cfa148ad876ef6933966a0...4ac0d284e603a2289c248a981821ee975899e699)
and [new-work record](BUILT_DURING_ETHONLINE.md). Final-day source must be assessed
from its own subsequent diff, not the repository's total size. No commit dates
or history have been rewritten to imply earlier progress.

## Available Before The Event

- The Base-mainnet AgentDomain ERC-721 registry, its identity records and public
  read functions; the contract itself is not a new deployment for this entry.
- The RenewalVault contract, available/pending balance model, auto-renew flag
  and existing renewal operations. New inspection and owner-approved control
  helpers reuse these contracts; they are not a new registrar or renewal engine.
- Agent registration, payments, renewal and domain/name provisioning workflows.
- A TypeScript SDK with `register`, platform API lookup/search and authenticated
  lifecycle operations, plus existing SDK test infrastructure. The later
  asynchronous registration/status/recovery extension is described separately.
- A stdio MCP server with read-only defaults and opt-in write tools.
- The product frontend, public documentation, Coinbase AgentKit and ElizaOS
  adapters, branding, build tooling and existing tests.
- LangChain and CrewAI documentation pages and the short `llms.txt` index.
  The new executable LangChain package, native Python framework examples and
  generated machine-readable outputs are distinct additions; the older guide
  pages and docs infrastructure are reused and updated, not counted as new.

The custom AgentDomain registry is not the ERC-8004 registry. Existing Basename
or ENS strings do not establish a new sponsor integration or independently prove
ownership of those names.

The contracts were not created or redeployed for these extensions. New public
registration code uses documented commercial API contracts; the commercial
backend, provisioning implementation and customer information are not claimed
to be open source. The independent inspection path uses public RPC without
access to those systems. Reused libraries retain their licenses and notices.

See [the new-work record](BUILT_DURING_ETHONLINE.md) and
[AI disclosure](AI_DISCLOSURE.md) for the feature-specific scope and evidence.
