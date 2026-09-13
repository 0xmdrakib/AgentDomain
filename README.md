# AgentDomain

Public developer tools for autonomous identity on Base.

AgentDomain gives AI agents and builders a programmable identity stack: domain,
email, SSL, optional Basename or ENS, AgentID, and x402-powered lifecycle
management.

- Website: [agentdomain.app](https://agentdomain.app)
- Documentation: [docs.agentdomain.app](https://docs.agentdomain.app)
- API: [api.agentdomain.app/api/v1](https://api.agentdomain.app/api/v1)

## Public packages

All eight packages below target **0.11.0 release candidates**. Publication of
this version has not yet been verified on npm or PyPI. Use reviewed source
builds or local wheels until the matching registry release is confirmed.

| Package                                                                                      | Purpose                                               |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`@agentdomain/sdk`](https://www.npmjs.com/package/@agentdomain/sdk)                         | TypeScript SDK for AgentDomain API and x402 workflows |
| [`@agentdomain/shared`](https://www.npmjs.com/package/@agentdomain/shared)                   | Public schemas, types, constants, and utilities       |
| [`@agentdomain/mcp-server`](https://www.npmjs.com/package/@agentdomain/mcp-server)           | MCP tools for agent runtimes                          |
| [`@agentdomain/agentkit-plugin`](https://www.npmjs.com/package/@agentdomain/agentkit-plugin) | Coinbase AgentKit integration                         |
| [`@agentdomain/eliza-plugin`](https://www.npmjs.com/package/@agentdomain/eliza-plugin)       | ElizaOS integration                                   |
| [`@agentdomain/langchain-plugin`](packages/langchain-plugin)                                 | Native LangChain JavaScript tools                     |
| [`agentdomain-crewai`](packages/crewai-plugin)                                               | Standalone native CrewAI Python integration           |
| [`agentdomain-autogen`](packages/autogen-plugin)                                             | Standalone native AutoGen Python integration          |

CrewAI and Microsoft AutoGen have their own Python distributions. Both retain the native stdio MCP
interface and require a separately installed Node MCP server.

After registry verification, install the pinned SDK:

```bash
npm install @agentdomain/sdk@0.11.0
```

See the [changelog](CHANGELOG.md) for public package release notes and
compatibility details.

## Lifecycle workflow

The coordinated **0.11.0** candidate contains the six npm packages and two
standalone Python integrations. Their current source versions do not establish
registry publication or deployment. The earlier SDK/MCP 0.10.0 release and
[Identity Check](https://agentdomain.app/verify) deployment are separate historical
evidence, not proof that this candidate is live. See the
[release evidence](BUILT_DURING_ETHONLINE.md#release-and-demo-evidence).

- `inspectAgentIdentity` observes the AgentDomain registry on Base without
  platform credentials or a wallet. Missing identities, RPC errors, owner
  mismatches and inconsistent records remain distinct.
- `inspectAgentRenewal` reads identity and RenewalVault state at the same
  canonical safe-block hash, including available/reserved USDC, timing and flags.
- `prepareAutoRenewChange` creates an unsigned, attributed setting transaction.
  `executeAutoRenewChange` requires a separate host-provided human approval
  callback; `confirmAutoRenewChange` checks the actual transaction and safe
  readback. Uncertain submissions are not automatically resent.
- The verification view adds read-only renewal observations. The framework
  flows stop at inspection or unsigned preparation, without wallet execution.

These are RPC observations, not consensus proofs or verification of linked
Basename/ENS ownership. The minimum vault fee is not a registrar quote, and
changing auto-renew does not itself renew a domain. Enabling permits authorized
renewal operators to use funded vault balances without a new signature for each
renewal; disabling does not cancel an existing reservation.

| New integration                              | Implementation                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| [LangChain](packages/langchain-plugin)       | TypeScript tools using `@langchain/core`; unsigned planning is a host opt-in.         |
| [CrewAI](packages/crewai-plugin)             | Standalone Python tools using official core-native MCP APIs.                          |
| [Microsoft AutoGen](packages/autogen-plugin) | Standalone guarded Python `McpWorkbench` for identity, renewal and unsigned planning. |

The deterministic framework tests need no paid model and submit no live wallet
transactions. The optional CrewAI recipe retains known Chroma dependency
advisories; passing its isolated tests is not a clean security audit. Read the
[scoped security note](packages/mcp-server/examples/crewai/README.md#security-note)
before using the Python integration.
See the [renewal guide](apps/docs/src/content/docs/guides/renewal.mdx)
for the approval and billing boundaries.

## Documentation for tools

The [docs build](apps/docs/README.md) now generates `llms-full.txt`,
`openapi.json`, `api-index.json` and `.well-known/agentdomain.json` from reviewed
public sources. They describe documented interfaces, with source hashes and
workspace versions; they do not invent REST endpoints for onchain functions,
authorize actions, or prove npm publication. Published outputs:
[full text](https://docs.agentdomain.app/llms-full.txt),
[OpenAPI](https://docs.agentdomain.app/openapi.json),
[API index](https://docs.agentdomain.app/api-index.json), and
[discovery](https://docs.agentdomain.app/.well-known/agentdomain.json).

For the ETHOnline contribution and reused-work distinction, see
[PREEXISTING.md](PREEXISTING.md), [BUILT_DURING_ETHONLINE.md](BUILT_DURING_ETHONLINE.md)
and [AI_DISCLOSURE.md](AI_DISCLOSURE.md).

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
