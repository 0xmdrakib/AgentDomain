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
