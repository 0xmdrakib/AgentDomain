# AgentDomain

Public developer tools for autonomous identity on Base.

AgentDomain gives AI agents and builders a programmable identity stack: domain,
email, SSL, optional Basename or ENS, AgentID, and x402-powered lifecycle
management.

- Website: [agentdomain.app](https://agentdomain.app)
- Documentation: [docs.agentdomain.app](https://docs.agentdomain.app)
- API: [api.agentdomain.app/api/v1](https://api.agentdomain.app/api/v1)

## Public packages

| Package                                                                                      | Purpose                                               |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`@agentdomain/sdk`](https://www.npmjs.com/package/@agentdomain/sdk)                         | TypeScript SDK for AgentDomain API and x402 workflows |
| [`@agentdomain/shared`](https://www.npmjs.com/package/@agentdomain/shared)                   | Public schemas, types, constants, and utilities       |
| [`@agentdomain/mcp-server`](https://www.npmjs.com/package/@agentdomain/mcp-server)           | MCP tools for agent runtimes                          |
| [`@agentdomain/agentkit-plugin`](https://www.npmjs.com/package/@agentdomain/agentkit-plugin) | Coinbase AgentKit integration                         |
| [`@agentdomain/eliza-plugin`](https://www.npmjs.com/package/@agentdomain/eliza-plugin)       | ElizaOS integration                                   |

Install the SDK:

```bash
npm install @agentdomain/sdk
```

See the [changelog](CHANGELOG.md) for public package release notes and
compatibility details.

## Tech stack

| Surface                  | Technologies                                                   |
| ------------------------ | -------------------------------------------------------------- |
| Frontend                 | Next.js 16, React 19, TypeScript, Tailwind CSS, TanStack Query |
| Wallet and onchain       | wagmi, viem, ethers, SIWE, x402, Base                          |
| Documentation            | Astro 7, Starlight                                             |
| SDK and integrations     | TypeScript, Model Context Protocol SDK, Zod                    |
| Smart contracts          | Solidity, Foundry, OpenZeppelin                                |
| Hosting and build system | Cloudflare Workers, OpenNext, Wrangler, pnpm, Turborepo        |

## Smart contracts

Public smart-contract source and available Base deployment records are in
[`contracts`](contracts). Review the published artifacts and
verify relevant addresses onchain before integrating.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
suspected vulnerabilities through the confidential process in
[SECURITY.md](SECURITY.md), not through a public issue.

## License

Unless a file or third-party notice states otherwise, the source code and
documentation in this repository are licensed under the
[Apache License 2.0](LICENSE). AgentDomain names, logos, marks, and brand artwork
are excluded from that license; see [NOTICE](NOTICE).
