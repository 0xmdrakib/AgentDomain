# @agentdomain/eliza-plugin

ElizaOS plugin for AgentDomain.

```bash
npm install @agentdomain/eliza-plugin
```

The plugin gives Eliza agents a complete AgentDomain lifecycle surface:

- Registration quote and x402 registration
- Registry discovery
- Agent email send/list, primary address update, and Pro/Enterprise aliases
- DNS management
- SSL repair/reconfiguration
- RenewalVault status, funding, and auto-renew
- Per-agent Premium Plan status and upgrades

Configure `AGENTDOMAIN_API_URL` only if you need a custom endpoint. The default is `https://agentdomain.app/api/v1`.
