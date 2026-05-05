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
- `fund_renewal_vault` - top up an agent's renewal vault

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
        "AGENTDOMAIN_API_URL": "https://api.agentdomain.xyz/v1",
        "AGENT_PRIVATE_KEY": "0x...",
        "AGENTDOMAIN_NETWORK": "base"
      }
    }
  }
}
```

## License

MIT
