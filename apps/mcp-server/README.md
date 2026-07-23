# @agentdomain/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server for AgentDomain.

Lets any MCP-compatible LLM client (Claude Desktop, ChatGPT desktop apps, custom agents) register and manage agent identities through natural language.

## Tools exposed

- `check_domain_availability` - is a domain available?
- `quote_registration` - price a registration
- `register_agent_identity` - register a complete identity (requires wallet)
- `lookup_agent` - find an agent by wallet
- `search_agents` - search the public registry
- `send_agent_email` - send an email from an agent's address
- `list_agent_email` - read agent inbox/outbox messages
- `update_primary_email` - change the included primary email username
- `create_email_alias` - create a Pro/Enterprise receive-and-send email alias
- `delete_email_alias` - delete an active email alias
- `list_dns_records` - list DNS records for an agent domain
- `create_dns_record` - create a user-managed DNS record
- `update_dns_record` - update a user-managed DNS record
- `delete_dns_record` - delete a user-managed DNS record
- `reconfigure_ssl` - rebuild Cloudflare SaaS SSL and DNS validation records
- `fund_renewal_vault` - top up an agent's renewal vault
- `withdraw_renewal_vault` - build an owner-signed vault withdrawal transaction
- `get_renewal_status` - check renewal date, amount, vault balance, and auto-renew state
- `enable_auto_renew` - enable on-chain auto-renew with the AgentID NFT owner wallet
- `get_service_plan` - inspect per-agent Included/Pro/Enterprise limits
- `purchase_service_plan` - upgrade to Pro or Enterprise with x402 USDC

## Install

```bash
npm install -g @agentdomain/mcp-server
```

## Configure (Claude Desktop example)

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentdomain": {
      "command": "npx",
      "args": ["-y", "@agentdomain/mcp-server"],
      "env": {
        "AGENTDOMAIN_API_URL": "https://agentdomain.app/api/v1",
        "AGENT_PRIVATE_KEY": "0x...",
        "AGENTDOMAIN_NETWORK": "base",
        "RENEWAL_VAULT_ADDRESS": "0x..."
      }
    }
  }
}
```

For `enable_auto_renew`, `AGENT_PRIVATE_KEY` must be the AgentID NFT owner wallet. Funding can come
from any wallet, but the RenewalVault contract only accepts auto-renew changes from the owner.

## Pricing flags

Registration pricing includes the live domain price plus the annual AgentDomain
platform fee. Email setup, SSL certification, DNS orchestration, and AgentID NFT
mint/orchestration are included in that platform fee.

Optional onchain services charge only when enabled:

- `registerBasename: false` skips Basename and Basename cost.
- `registerEns: false` skips ENS and ENS cost.
- `emailEnabled` is still accepted for old clients but is deprecated and ignored.
- `emailUsername` customizes the primary inbox local-part; omit it for `agent@domain`.
- `premiumPlan: "included" | "pro" | "enterprise"` selects the per-agent plan at registration.

Use `quote_registration` first so the agent sees `platformFeeUsdc`, included
email/SSL metadata, optional component costs, and `totalUsdc` before it signs
the x402 payment.

For renewals, `get_renewal_status` returns the exact next renewal amount and the
shortfall to fund before the keeper can reserve and complete the renewal.

For Premium Plans, `purchase_service_plan` upgrades coverage through the
agent's current expiry. Future Premium Plan renewal is charged together with the
identity renewal quote in RenewalVault.

Autonomous Premium Plan purchase requires `AGENT_PRIVATE_KEY` for the owner or a
delegated wallet on Base with enough USDC. An agent-scoped API key can operate
its own allowed endpoints, but it cannot sign x402 paid purchases by itself.

## License

Apache-2.0. See the repository [LICENSE](../../LICENSE).
