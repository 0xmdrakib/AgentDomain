# @agentdomain/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server for AgentDomain.

It lets MCP-compatible clients discover and manage agent identities through the
[AgentDomain API](https://api.agentdomain.app/api/v1).

The server requires Node.js 20 or newer and communicates over standard input
and output. It does not open a public listener.

## Run

```bash
npx -y @agentdomain/mcp-server
```

For a persistent installation:

```bash
npm install -g @agentdomain/mcp-server
agentdomain-mcp
```

## Default tools

The server starts in read-only mode. It advertises only tools that inspect public
or authorized account state:

- `check_domain_availability` and `quote_registration`
- `lookup_agent`, `get_agent`, and `search_agents`
- `list_agent_email` and `get_agent_email_usage`
- `get_dns_capabilities`, `list_dns_records`, and `export_dns_zone`
- `get_renewal_status` and `get_service_plan`

An API key may authorize additional reads, but merely supplying one never enables
mutation tools.

## Read-only configuration

Start without a signing credential for discovery, lookup, search, and other
read-only operations. For example:

```json
{
  "mcpServers": {
    "agentdomain": {
      "command": "npx",
      "args": ["-y", "@agentdomain/mcp-server"],
      "env": {
        "AGENTDOMAIN_API_URL": "https://api.agentdomain.app/api/v1"
      }
    }
  }
}
```

This remains read-only even if the MCP process receives an ambient API key or
wallet credential.

## Enabling write tools

Write tools are omitted from discovery and blocked at dispatch unless
`AGENTDOMAIN_ENABLE_WRITE_TOOLS` is set to the exact value `true`. Unset or exact
`false` keeps read-only mode. Empty, mixed-case, numeric, whitespace-padded, or
otherwise malformed values stop startup rather than guessing intent.

The opt-in exposes registration, email sending/configuration, email deletion,
DNS mutations, SSL reconfiguration, renewal funding/withdrawal/automation, plan
purchases/scheduling, and registry-visibility changes. Configure the nonsecret
opt-in in the MCP process environment, then inject only the narrowly scoped API
or signing credential required by the selected operation through a trusted
secret-aware launcher. Do not place either credential in MCP client JSON.

## Signing credentials

Supply `AGENT_PRIVATE_KEY` only when an enabled operation requires a wallet
signature. Inject it through a trusted external secret store or secret-aware
launcher; never paste it into client JSON, source code, shell history, logs, or a
repository. Use a dedicated wallet with only the authority and funds required
for the intended operation.

Owner-authorized renewal changes require the AgentID NFT owner wallet. Paid plan
purchases likewise require an authorized wallet with sufficient USDC. An
agent-scoped API key can call its permitted endpoints but cannot sign wallet
transactions.

`AGENTDOMAIN_BUILDER_CODE` is the public ERC-8021 application identifier used to
attribute supported Base transactions. It accepts 1-32 lowercase letters,
numbers, or underscores and is needed only by tools that explicitly require it.

## Pricing options

Registration pricing includes the live domain price and the AgentDomain platform
fee. Email setup, SSL certification, DNS orchestration, and AgentID NFT
orchestration are included unless the API response states otherwise.

Optional settings include:

- `registerBasename: false` to skip Basename
- `registerEns: false` to skip ENS
- `emailUsername` to customize the primary inbox local part
- `premiumPlan: "included" | "starter" | "pro" | "enterprise"` to select a plan

Use `quote_registration` before signing a payment. Treat the returned quote,
limits, expiry, and renewal amount as authoritative for that request.

## License

Published package releases are licensed under Apache-2.0.

## Links

- [MCP guide](https://docs.agentdomain.app/sdk/mcp)
- [API discovery](https://api.agentdomain.app/api/v1)
- [Source](https://github.com/0xmdrakib/AgentDomain/tree/main/packages/mcp-server)
- [Security policy](https://github.com/0xmdrakib/AgentDomain/security/policy)
