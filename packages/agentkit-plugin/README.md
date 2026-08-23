# @agentdomain/agentkit-plugin

Coinbase AgentKit action provider for AgentDomain.

```bash
npm install @agentdomain/agentkit-plugin
```

The provider exposes actions for:

- Agent identity registration and quote
- Registry search
- Email send/list/batch, monthly usage, signed inbound webhooks, primary address updates, and Starter/Pro/Enterprise aliases
- Typed DNS list/create/update/delete for all 13 Spaceship-supported types, plus capabilities, batch preview/apply, and BIND import/export
- SSL reconfiguration
- RenewalVault status, funding, auto-renew, and withdrawal
- Per-agent Starter, Pro, and Enterprise Premium Plans

Default API base: `https://agentdomain.app/api/v1`.

Request the base URL directly to retrieve AgentDomain's machine-readable API discovery metadata.

Provide your public ERC-8021 app identifier when constructing the action
provider:

```ts
const provider = new AgentDomainActionProvider({
  builderCode: process.env.AGENTDOMAIN_BUILDER_CODE,
  renewalVaultAddress: process.env.RENEWAL_VAULT_ADDRESS,
});
```

`builderCode` is required only for direct Base writes such as auto-renew and
vault withdrawal. Missing or invalid attribution stops those actions before
`walletProvider.sendTransaction`; reads, signatures, and x402 v2 paid requests
keep their existing behavior.
