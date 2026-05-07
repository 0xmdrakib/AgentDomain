# AgentDomain

AgentDomain is an autonomous identity stack for AI agents that bundles a domain, Basename, DNS, email, SSL, and an AgentID NFT into one registration flow on Base.

**Live app:** https://agentdomain.vercel.app

---

## Overview

AgentDomain helps AI agents create a complete internet and onchain identity without manual setup.

Instead of separately buying a domain, configuring DNS, setting up email, registering onchain names, and handling renewals, the app coordinates the full identity flow through one checkout-style registration process paid in **USDC on Base**.

The project includes a web app, public registry, operator dashboard, API routes, smart contracts, SDK packages, an MCP server, agent framework plugins, and automation services for renewals and SSL provisioning.

## Features

- One-flow identity registration for AI agents
- Traditional domain registration with supported TLDs such as **.xyz**, **.com**, **.ai**, **.org**, **.io**, **.net**, **.co**, **.app**, and more
- Optional **Basename** registration on Base
- Optional **ENS** registration on Ethereum mainnet
- **AgentID NFT** minted on Base to represent the identity bundle
- USDC payment flow on Base through x402-style payment handling
- Live quote calculation before registration
- Cloudflare DNS zone creation and baseline DNS record setup
- Optional Resend-powered email inbox for `agent@domain`
- SSL provisioning and renewal workflow through the SSL provisioner service
- Renewal vault and keeper workflow for autonomous identity renewals
- Public agent registry with search by name, framework, or capability
- TypeScript SDK for app and agent integrations
- MCP server for LLM-based agent identity registration
- ElizaOS and AgentKit plugin packages
- Admin dashboard, registration monitoring, repair actions, and production preflight checks

## Supported identity bundle

AgentDomain can provision the following identity components:

- **Domain:** A traditional domain name registered through the registrar integration
- **Basename:** A `.base.eth` identity on Base
- **ENS:** An optional `.eth` name on Ethereum mainnet
- **DNS:** Managed DNS records through Cloudflare
- **Email:** Optional `agent@domain` inbox and send API through Resend
- **SSL:** Certificate provisioning and renewal workflow
- **AgentID NFT:** ERC-721 identity record minted on Base
- **Renewal vault:** USDC-funded renewal support for long-term identity ownership

## Registration behavior

### Quote and validation

The app validates the requested name, TLD, Basename, ENS label, registration years, owner wallet, and optional metadata before creating a registration.

Quote calculation can include:

- Live domain pricing
- Basename rent and gas estimate
- ENS rent and Ethereum L1 gas estimate
- Platform service fee
- Optional discount code handling

### x402 payment flow

Registration uses a payment-required flow where the first API request can return a payment challenge. After payment information is provided, the server settles the USDC payment and continues the registration workflow.

The registration route is designed to be idempotent so retries can avoid duplicate processing.

### Provisioning flow

After validation and payment, the system can coordinate:

- ENS registration on Ethereum mainnet, if selected
- Metadata upload to Pinata/IPFS
- Domain registration through Spaceship
- Cloudflare zone creation and DNS setup
- Resend email domain setup, if enabled
- Basename registration on Base, if selected
- AgentID NFT minting through the payment router contract
- Database persistence for agents, registrations, DNS records, and inboxes

## API and automation

### Public API

The app exposes API routes for:

- Domain availability checks
- Registration quotes
- Agent identity registration
- Agent search and lookup
- DNS record management
- Email inbox and send actions
- Renewal vault funding, status, and withdrawal
- API key management
- Auth and SIWE session handling

### Admin API

Admin routes support:

- Registration monitoring
- Agent creation and repair actions
- SSL reprovisioning
- Refund and retry actions
- Discount code management
- Renewal monitoring
- Production preflight checks

### Automation services

The project includes background services for:

- Renewal checks through the keeper bot
- SSL certificate provisioning and renewal
- Cron-based reconciliation for pending or failed registration states

## Developer tools

- **TypeScript SDK:** Register identities, check availability, quote registrations, search agents, send email, and manage renewal vaults
- **MCP server:** Lets LLMs call AgentDomain tools through a Model Context Protocol server
- **AgentKit plugin:** Adds AgentDomain actions to Coinbase AgentKit-style workflows
- **Eliza plugin:** Adds AgentDomain actions to ElizaOS-style agents
- **Docs app:** Mintlify documentation for APIs, guides, SDKs, and framework integrations

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Wagmi
- viem
- Drizzle ORM
- PostgreSQL
- Redis / Upstash
- QStash
- Solidity
- Foundry
- OpenZeppelin
- pnpm workspaces
- Turborepo
- Mintlify
- x402
- Base
- Ethereum mainnet
- USDC
- ENS
- Basenames
- Spaceship
- Cloudflare
- Resend
- Pinata
- LI.FI

---

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create `apps/web/.env` file in this location. Then copy the values from [.env.example](./.env.example) and fill them in.

Important groups include:

- Database and Redis connection values
- Base and Ethereum RPC URLs
- Contract addresses for the registry, payment router, renewal vault, USDC, and treasury
- Backend wallet private key
- x402 facilitator settings
- Spaceship registrar credentials
- Cloudflare credentials
- Resend credentials
- Pinata credentials
- Turnstile, cron, admin, Sentry, and SSL worker values as needed

### 3. Run database migrations

```bash
pnpm --filter @agentdomain/web db:migrate
```

### 4. Run the development server

```bash
pnpm dev
```

Open `http://localhost:3000` in your browser.

### 5. Run production preflight checks

```bash
pnpm --filter @agentdomain/web preflight
```

To include third-party integration checks:

```bash
pnpm --filter @agentdomain/web preflight -- --external
```

### 6. Build the project

```bash
pnpm build
```

## Smart contracts

The contracts package includes:

- `AgentIdentityRegistry` for ERC-721 identity records
- `PaymentRouter` for paid registration minting
- `RenewalVault` for USDC-funded renewals

## License

This project is licensed under the [MIT License](./LICENSE).
