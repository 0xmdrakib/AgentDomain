# AgentDomain

> The autonomous identity stack for AI agents. **Domain + Basename + ENS + DNS + Email + SSL** in one transaction on Base.

**Squarespace for AI Agents.** A single API call gives any AI agent a complete onchain identity, paid in USDC on Base, fully autonomous - no human required.

## Why AgentDomain?

The agent economy is exploding. 100+ projects on Base's x402 ecosystem, $7.6B agent market growing at 50% CAGR. But AI agents have no standard identity layer. They need:

- A **domain name** for web presence
- A **Basename** for onchain identity
- An optional **ENS name** on Ethereum L1
- **DNS configuration** to route traffic
- **Email** for human/agent communication
- **SSL** for trust
- **Autonomous renewal** so they never expire

AgentDomain delivers all of this in **one x402-protected API call**.

## Features

- **One-call identity bundle** - multi-year domain + Basename + ENS + DNS + SSL in a single tx
- **x402-native payments** - pay in USDC on Base, no signup, no KYC
- **AgentID NFT (ERC-721)** - your identity is composable and transferable
- **Autonomous renewals** - enable auto-renew with 1 click to never lose your identity
- **MCP server** - any LLM can register identities via natural language
- **Open SDK** - drop-in TypeScript SDK + ElizaOS / AgentKit / OpenAI / Anthropic tool adapters
- **Public registry** - other agents discover you by name or capability

## Architecture

```
apps/
  web/              Next.js 15 app (marketing, dashboard, API)
  mcp-server/       MCP server for LLM agents
  docs/             Mintlify documentation site
packages/
  sdk/              @agentdomain/sdk (TypeScript)
  contracts/        Foundry smart contracts (Solidity)
  eliza-plugin/     ElizaOS plugin
  agentkit-plugin/  Coinbase AgentKit action provider
  shared/           Shared types and utilities
  ui/               Shared React UI components
services/
  keeper-bot/       Renewal automation worker
  ssl-provisioner/  Let's Encrypt automation
```

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, TailwindCSS, shadcn/ui, Wagmi, Viem
- **Backend**: Next.js Route Handlers, Drizzle ORM, Postgres (Neon), Redis (Upstash)
- **Smart Contracts**: Solidity 0.8.24+, Foundry, OpenZeppelin
- **Blockchain**: Base L2, Ethereum L1, USDC, x402, Basenames, ENS
- **Integrations**: Spaceship registrar, Cloudflare DNS, Resend, Pinata, Let's Encrypt

## Email API

- `POST /api/webhooks/resend/inbound` stores Resend inbound email events. In production, protect it with `RESEND_WEBHOOK_SECRET` via `Authorization: Bearer <secret>` or `x-agentdomain-webhook-secret`.
- `GET /api/v1/agents/:id/email` lists an agent inbox.
- `PATCH /api/v1/agents/:id/email/:messageId` marks a message read/unread.
- `POST /api/v1/agents/:id/email/send` sends from `agent@domain` with rate limiting.
- `GET/POST /api/v1/agents/:id/email/blocklist` manages blocked senders/domains.

## SSL Automation

- `services/ssl-provisioner` polls active agents with pending/failed SSL or certs due for renewal.
- It uses Let's Encrypt ACME DNS-01 challenges through Cloudflare and stores cert/key material encrypted in `ssl_certificates`.
- Required worker env: `DATABASE_URL`, `CLOUDFLARE_API_TOKEN`, `ACME_ACCOUNT_PRIVATE_KEY`, `ACME_CONTACT_EMAIL`, and `SSL_CERT_ENCRYPTION_KEY`.
- Optional worker env: `ACME_DIRECTORY_URL`, `ACME_PREFERRED_CHAIN`, `SSL_RENEW_BEFORE_DAYS`, `SSL_DNS_PROPAGATION_SECONDS`, `SSL_PROVISIONER_BATCH_SIZE`, and `SSL_PROVISIONER_TICK_INTERVAL_SECONDS`.
- Run with `pnpm --filter @agentdomain/ssl-provisioner dev` locally or build then `pnpm --filter @agentdomain/ssl-provisioner start` in production.

## Production Preflight

- Run `pnpm --filter @agentdomain/web preflight` before the first real registration.
- Run `pnpm --filter @agentdomain/web preflight -- --external` to also verify Cloudflare, Pinata, Resend, and Spaceship credentials.
- Admin endpoint: `GET /api/v1/admin/preflight`; add `?external=1` for third-party checks.
- The preflight output is sanitized and never prints secret env values.

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment
# Fill apps/web/.env.local with your local/prod values

# Run database migrations
pnpm --filter @agentdomain/web db:migrate

# Start dev servers
pnpm dev
```

## Roadmap

- [x] Monorepo scaffolding
- [x] Smart contracts (AgentIdentityRegistry, PaymentRouter, RenewalVault)
- [x] Spaceship availability + registration integration
- [x] Basename registration
- [x] ENS L1 registration
- [x] Cloudflare DNS automation
- [x] x402 payment middleware
- [x] TypeScript SDK
- [x] MCP server
- [x] Marketing site + operator dashboard
- [x] Email inbox API + inbound webhook
- [x] Renewal vault + keeper bot
- [x] Mainnet launch on Base

## License

MIT
