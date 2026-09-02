# AgentDomain

Public developer tools for autonomous identity on Base.

AgentDomain gives AI agents and builders a programmable identity stack: domain,
email, SSL, optional Basename or ENS, AgentID, and x402-powered lifecycle
management.

Live docs: https://docs.agentdomain.app

## Public source of truth

This repository is the public source of truth for the AgentDomain frontend,
documentation, SDKs, integrations, and published contract artifacts. Frontend work belongs
in `apps/frontend`; documentation work belongs in `apps/docs`. Their production
destinations are `agentdomain.app` and `docs.agentdomain.app`, respectively.

Backend services, storage implementations, infrastructure, operations, private
configuration, and provider credentials are intentionally outside this
repository. Public applications integrate through reviewed API contracts only.

## Cloudflare deployment ownership

Cloudflare Workers Builds deploys the production frontend and documentation from
the protected `main` branch of this repository. Non-production branch builds are
disabled on the production Workers; isolated preview Workers remain separate
targets.

| Worker                 | Build command                                                     | Production deploy command                                           |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `agentdomain-frontend` | `pnpm --filter @agentdomain/frontend build:cloudflare:production` | `pnpm --filter @agentdomain/frontend exec wrangler deploy --env=""` |
| `agentdomain-docs`     | `pnpm --filter @agentdomain/docs build:cloudflare:production`     | `pnpm --filter @agentdomain/docs exec wrangler deploy --env=""`     |

Build-time browser settings are configured in Cloudflare and are not a source of
backend credentials. Production custom domains, runtime bindings, and API routing
remain provider configuration rather than repository secrets.

---

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

## Documentation

- API and integration guides: [AgentDomain docs](https://docs.agentdomain.app)
- Production API: [agentdomain.app](https://agentdomain.app)
- Base contract source and available deployment records: [`packages/contracts`](packages/contracts)

## Base contracts

Contract source and the Base mainnet deployment records currently published by
AgentDomain are in [`packages/contracts`](packages/contracts). Only artifacts
committed there are part of this public evidence; this repository does not claim
complete ABI or deployment verification where those artifacts are absent. Do not
place private keys or service credentials in this repository.

## Development

```bash
pnpm install
pnpm check:public-boundary
pnpm ci:public
```

Real `frontend.env` files are local-only. Keep `frontend.env.example`
value-free, and never expose secrets through browser-visible variables. Pull
requests and fork builds do not receive production deployment credentials.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Unless a file or third-party notice states otherwise, the source code and
documentation in this repository are licensed under the
[Apache License 2.0](LICENSE). AgentDomain names, logos, marks, and brand artwork
are excluded from that license; see [NOTICE](NOTICE).
