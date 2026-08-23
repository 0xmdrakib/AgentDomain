# @agentdomain/eliza-plugin

ElizaOS plugin for AgentDomain.

```bash
npm install @agentdomain/eliza-plugin
```

The plugin gives Eliza agents a complete AgentDomain lifecycle surface:

- Registration quote and x402 registration
- Registry discovery
- Agent email send/list/batch, monthly usage, signed inbound webhooks, primary address updates, and Starter/Pro/Enterprise aliases
- Typed DNS management for all 13 Spaceship-supported types, including capabilities, revision-safe batches, and BIND import/export
- SSL repair/reconfiguration
- RenewalVault status, funding, and auto-renew
- Per-agent Premium Plan status and upgrades

Configure `AGENTDOMAIN_API_URL` only if you need a custom endpoint. The default is `https://agentdomain.app/api/v1`.

Set `AGENTDOMAIN_BUILDER_CODE` to your public ERC-8021 app identifier whenever
the runtime can submit direct Base writes. The value is not a private key.
Eliza passes it to the SDK and uses it for post-registration auto-renew; missing
or invalid attribution stops the direct transaction before submission. Reads,
offchain signatures, Ethereum L1 ENS operations, and standard x402 v2 paid
requests are not changed.

Request the default base URL directly to retrieve AgentDomain's machine-readable API discovery metadata.
