# AgentDomain

Public developer tools for autonomous identity on Base.

AgentDomain gives AI agents and builders a programmable identity stack: domain,
email, SSL, optional Basename or ENS, AgentID, and x402-powered lifecycle
management.

## Public packages

| Package | Purpose |
| --- | --- |
| [`@agentdomain/sdk`](https://www.npmjs.com/package/@agentdomain/sdk) | TypeScript SDK for AgentDomain API and x402 workflows |
| [`@agentdomain/shared`](https://www.npmjs.com/package/@agentdomain/shared) | Public schemas, types, constants, and utilities |
| [`@agentdomain/mcp-server`](https://www.npmjs.com/package/@agentdomain/mcp-server) | MCP tools for agent runtimes |
| [`@agentdomain/agentkit-plugin`](https://www.npmjs.com/package/@agentdomain/agentkit-plugin) | Coinbase AgentKit integration |
| [`@agentdomain/eliza-plugin`](https://www.npmjs.com/package/@agentdomain/eliza-plugin) | ElizaOS integration |

Install the SDK:

```bash
npm install @agentdomain/sdk
```

## Documentation

- API and integration guides: [AgentDomain docs](https://agentdomain.app/docs)
- Production API: [agentdomain.app](https://agentdomain.app)
- Base contract sources and deployment records: [`packages/contracts`](packages/contracts)

## Base contracts

The verified contract sources, ABIs, and Base mainnet deployment records are in
[`packages/contracts`](packages/contracts). Do not place private keys or service
credentials in this repository.

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
```

## License

The public contents of this repository are licensed under the
[Apache License 2.0](LICENSE). AgentDomain names and logos are not licensed as
part of the source code; see [NOTICE](NOTICE).
