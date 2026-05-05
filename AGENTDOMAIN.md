# AgentDomain — Master Reference

> Last updated: April 26, 2026
> Status: v0 scaffold complete, building toward mainnet launch

---

## 1. What Is AgentDomain?

**AgentDomain is the Squarespace for AI agents.**

One API call gives any AI agent a complete identity on the internet:

- A real domain name (`.ai`, `.com`, `.xyz`, `.agent`)
- A Basename on Base L2 (`.base.eth`)
- An optional ENS name on Ethereum L1 (`.eth`)
- An AgentID NFT (ERC-721) proving ownership
- Auto-configured DNS (Cloudflare)
- Auto-provisioned SSL (Let's Encrypt)
- An email inbox (`agent@yourdomain.com`)
- Auto-renewal via USDC vault (never expires)
- Listed in the public agent registry

**Paid in USDC on Base. No account. No KYC. No human required.**

---

## 2. The Problem We Solve

When a developer builds an AI agent today, they manually:

1. Buy a domain (GoDaddy — human signup required)
2. Configure DNS records
3. Set up email
4. Link it to a blockchain wallet
5. Register ENS / Basename separately
6. Renew every year manually

**We automate ALL of this in one API call in ~30 seconds.**

The agent can do it itself, autonomously, from its own wallet.

---

## 3. Who Are Our Customers

### Right Now (v1 Target)

**AI Agent Developers** — builders using:

- ElizaOS (~18k GitHub stars, dominant Web3 agent framework)
- Coinbase AgentKit (~651 real GitHub dependents, 12,400 npm downloads/week)
- OpenAI SDK, Anthropic, LangChain, CrewAI, AutoGen (via SDK/API)
- x402 protocol builders (~600 in Telegram group, ~150 ecosystem projects)

These are technical people building agent-powered products who hate setting up infrastructure.

### Near Term (v1.5)

**The Agents Themselves** — autonomous agents with their own wallets that call our API directly via x402 and pay in USDC. No human in the loop.

### Later (v2+)

**Enterprise Fleet Operators** — companies running 100+ agents needing identity infrastructure at scale.

---

## 4. Market Reality (Honest Numbers)

| Signal                             | Number                            | What it means                            |
| ---------------------------------- | --------------------------------- | ---------------------------------------- |
| Base daily active addresses        | 447,000                           | Mixed humans + bots + DeFi               |
| AgentKit GitHub dependents         | 651                               | Most reliable signal of real usage       |
| x402 builders (Telegram)           | 600                               | Active builders                          |
| x402 ecosystem projects            | ~150                              | Listed (many pre-revenue)                |
| Virtuals agents (peak)             | ~1,000                            | Mostly dormant, token down 85%           |
| ElizaOS stars                      | 18,200                            | Developer curiosity, not deployed agents |
| **Real autonomous agents running** | **Low hundreds to low thousands** | Honest estimate                          |

**We are early.** The market is real but small today (~1,000-5,000 real agent developers on Base). This is the RIGHT time to build infrastructure — before the agents arrive at scale.

### Historical Parallel

```
Web3 apps:  Infrastructure built 2017-19 → Apps shipped 2020-22 → Users arrived 2023+
AI agents:  Infrastructure built 2025-26 → [WE ARE HERE] → Agents ship 2026-27 → Users 2027+
```

### Revenue Potential

- First 500 registrations = $12,500 revenue
- First 5,000 registrations = $125,000 revenue
- If we own the category when agents scale = millions in ARR

---

## 5. Key Features

| Feature         | What It Is                                          | Why It Matters                                   |
| --------------- | --------------------------------------------------- | ------------------------------------------------ |
| Domain Name     | `.ai`, `.com`, `.xyz` via Spaceship (ICANN partner) | Real web presence                                |
| Multi-Year      | Up to 10 years duration selected upfront            | Lock in identity without worrying about renewals |
| Basename        | `.base.eth` on Base L2 via ENS commit-reveal        | Web3 identity                                    |
| ENS Name        | `.eth` on Ethereum L1 via ENS commit-reveal         | Ethereum-native identity                         |
| AgentID NFT     | ERC-721 on Base representing full identity bundle   | Composable, transferable proof of ownership      |
| DNS Config      | Auto-configured Cloudflare zone + records           | Domain actually works                            |
| SSL Certificate | Let's Encrypt, auto-renewing                        | HTTPS out of the box                             |
| Email Inbox     | `agent@yourdomain.com` via Resend                   | Agent can communicate                            |
| Auto-Renewal    | USDC vault funded by agent, keeper bot renews       | Identity never expires                           |
| Public Registry | Searchable by name, capability, framework           | Agents discover each other                       |
| x402 Payments   | USDC on Base, no accounts, no KYC                   | Agents pay autonomously                          |
| MCP Server      | Natural language interface for LLMs                 | Any LLM can register identities                  |

---

## 6. How It Works (Technical Flow)

```
1. Agent calls POST /agents/register
2. Server returns HTTP 402 + X-Payment-Required (x402 challenge)
3. SDK auto-signs EIP-3009 USDC transferWithAuthorization
4. Agent retries with X-Payment header
5. Server settles payment via x402 facilitator
6. Provisioning fans out in parallel:
   ├── Spaceship → ICANN domain registered
   ├── Cloudflare  → DNS zone created + records configured
   ├── Resend      → Email inbox provisioned (if opted in)
   ├── ENS         → .eth registered on Ethereum L1 (optional)
   ├── Basenames   → .base.eth registered on Base L2
   ├── Pinata      → Metadata pinned to IPFS
   └── PaymentRouter contract → AgentID NFT minted on Base
7. Returns: domain, basename, NFT tokenId, txHash
```

**Time to complete: ~30 seconds**

---

## 7. Pricing

AgentDomain uses live quote pricing, not fixed packages.

| Component    | Pricing rule                                                             |
| ------------ | ------------------------------------------------------------------------ |
| Domain       | Live Spaceship price (base + (years-1)\*renew)                           |
| Basename     | Optional `.base.eth` add-on: onchain rent + Base gas only (no extra fee) |
| ENS          | Optional `.eth` add-on: live ENS rent + Ethereum L1 gas (no extra fee)   |
| Platform fee | $2 per registration for orchestration, DNS, IPFS metadata, and checkout  |
| Renewal      | Calculated at renewal time from registrar/onchain cost                   |

The checkout always shows the final USDC amount before the wallet signs payment.
The official live sources are Spaceship domain availability pricing,
ENS `ETHRegistrarController.rentPrice`, and Basenames `registerPrice` on Base.
The full x402 payment settles to the backend wallet first. Domain recovery and
service fees are swept to treasury; ENS/Basename cost basis stays in the backend
wallet and is converted through LI.FI from Base USDC into native ETH when the
registration wallet needs funding.

---

## 8. Tech Stack

### Smart Contracts (Base L2, Solidity 0.8.24)

| Contract                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `AgentIdentityRegistry` | ERC-721 NFT registry, one per agent identity         |
| `PaymentRouter`         | Receives USDC, triggers minting (idempotent)         |
| `RenewalVault`          | Holds USDC for autonomous renewals, keeper-triggered |

### Backend (Next.js 15, TypeScript)

- **API**: Next.js Route Handlers
- **Database**: PostgreSQL (Neon) + Drizzle ORM
- **Cache**: Redis (Upstash)
- **Queue**: Vercel Cron + QStash

### External Integrations

| Partner       | Purpose                                                          |
| ------------- | ---------------------------------------------------------------- |
| Spaceship     | ICANN domain registration (modern OpenAPI, accepts USDC top-up)  |
| Cloudflare    | DNS zone + records automation                                    |
| Resend        | Email infrastructure                                             |
| Let's Encrypt | SSL via ACME                                                     |
| Pinata        | IPFS metadata storage                                            |
| Basenames     | .base.eth registration                                           |
| ENS           | .eth registration on Ethereum mainnet                            |
| LI.FI         | Converts Base USDC into native ETH for ENS/Basename registration |
| x402          | Payment protocol                                                 |
| Coinbase CDP  | AgentKit + wallet infrastructure                                 |

### Developer Tools

| Tool            | Where                               |
| --------------- | ----------------------------------- |
| TypeScript SDK  | `packages/sdk` → `@agentdomain/sdk` |
| MCP Server      | `apps/mcp-server` → any LLM         |
| ElizaOS Plugin  | `packages/eliza-plugin`             |
| AgentKit Plugin | `packages/agentkit-plugin`          |

---

## 9. Repository Structure

```
agentdomain/                        (monorepo, pnpm + Turborepo)
├── apps/
│   ├── web/                        Next.js 15 (API + UI + dashboard)
│   ├── mcp-server/                 MCP server for LLM agents
│   └── docs/                       Mintlify docs
├── packages/
│   ├── shared/                     Types, schemas, constants, utils
│   ├── sdk/                        @agentdomain/sdk (TypeScript)
│   ├── contracts/                  Three deployable Solidity contracts
│   ├── eliza-plugin/               ElizaOS plugin
│   └── agentkit-plugin/            Coinbase AgentKit action provider
└── services/
    ├── keeper-bot/                 Autonomous renewal worker
    └── ssl-provisioner/            Let's Encrypt ACME DNS-01 automation
```

---

## 10. Competitive Landscape

| Competitor              | What they do                                             | Our advantage                                                                                                                |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Spaceship**           | Our upstream ICANN registrar (we resell their wholesale) | We bundle EVERYTHING (domain + Basename + DNS + email + SSL + NFT) on top of raw registration. They're our backend supplier. |
| **ENS/Basenames**       | Web3 naming only                                         | We bundle Web3 names with traditional domains, email, SSL, AgentID NFT, and x402 payments                                    |
| **Unstoppable Domains** | Web3 domains                                             | Fiat-only checkout, no autonomous agent flow                                                                                 |
| **No one**              | Full autonomous identity stack                           | This is the gap we own                                                                                                       |

**White space:** No one builds the complete end-to-end autonomous identity stack for agents. Spaceship is just a domain registrar. Cloudflare does DNS only. Coinbase does Basenames. We bundle them all + add the AgentID NFT + agent-native x402 payment + autonomous renewal vault.

---

## 11. Go-To-Market

### Phase 1: Developer Beachhead (Months 1-3)

- Target: 651 AgentKit dependents + 600 x402 builders
- Channel: Farcaster (build in public), X, Discord
- Offer: Free first identity for hackathon builders
- Goal: 50 beta agents registered

### Phase 2: Framework Partnerships (Months 2-4)

- Partner with ElizaOS team (plugin already built)
- Partner with Coinbase CDP team (plugin already built)
- Get listed in x402 ecosystem directory
- Get listed in AgentKit docs

### Phase 3: Public Launch (Month 4-5)

- Product Hunt launch
- Farcaster Frame for one-click registration
- Hackathon sponsorships (ETHGlobal, Base hackathons)
- Target: 500 paying registrations

---

## 12. Build Status

### Completed ✅

- [x] Monorepo (Turborepo + pnpm)
- [x] `@agentdomain/shared` — types, schemas, constants, utils
- [x] Smart contracts — AgentIdentityRegistry, PaymentRouter, RenewalVault (+ 26 tests)
- [x] `@agentdomain/sdk` — TypeScript SDK with x402 client
- [x] Database schema — Drizzle ORM, 8 tables, full relations
- [x] Core services — Spaceship, Cloudflare, Resend, Pinata, Basenames
- [x] Identity orchestrator — single transactional flow coordinating all services
- [x] x402 middleware — full payment flow (challenge → sign → settle)
- [x] API routes — 7 endpoints (register, quote, availability, search, lookup, DNS, health)
- [x] Marketing landing page — hero, features, how-it-works, pricing, registry
- [x] Register flow — live availability check + price quote UI
- [x] **Wallet integration (wagmi + Coinbase Smart Wallet + injected + WalletConnect)**
- [x] **End-to-end registration flow with real x402 payment signing**
- [x] **USDC balance check + insufficient balance handling**
- [x] **Registration success/loading/error UI states**
- [x] **Agent detail page (`/agents/[id]`) with DNS records, metadata, links**
- [x] **Dashboard wired to DB — shows connected user's actual agents**
- [x] Public registry — searchable agent list
- [x] MCP server — 7 tools, works with Claude Desktop + any MCP client
- [x] ElizaOS plugin
- [x] AgentKit plugin
- [x] Keeper bot — autonomous renewal worker

### Build Verification ✅

- All 10 packages typecheck cleanly
- Next.js production build succeeds (**18 routes** — landing, dashboard, registry, register, agents/[id], 13 API endpoints)
- Build size: 107KB shared, 258KB on registration page (includes wagmi + viem)
- Edge middleware: 31KB (security headers + CORS)

### Production Hardening (April 2026) ✅

- [x] Drizzle migrations system + initial migration generated
- [x] x402 server-side: local EIP-712 signature recovery, on-chain nonce + balance check, facilitator + self-settle fallback
- [x] SIWE auth: nonce → sign → verify → HMAC-signed session cookie
- [x] Admin auth: `requireAdmin()` gated by `ADMIN_ADDRESSES` env list
- [x] Edge middleware: CSP, HSTS, X-Frame-Options, CORS allowlist
- [x] Sentry integration (lazy-loaded, no-op if SENTRY_DSN unset)
- [x] Health endpoint with DB + RPC reachability checks
- [x] Reconciliation cron worker (`*/5 * * * *`)
- [x] Admin endpoints: `/admin/stats`, `/admin/agents/[id]/revoke`
- [x] Global error boundary + branded 404 page

### Next Steps 🔜

- [ ] Set up env vars (Postgres, Spaceship, Cloudflare, Resend, Pinata)
- [ ] Deploy contracts to Base mainnet through the Remix runbook
- [ ] Run `pnpm --filter @agentdomain/web db:migrate` (apply DB schema)
- [ ] End-to-end test on Base mainnet with a small real registration
- [ ] Smart contract audit (Code4rena/Sherlock, ~$5-10k)
- [ ] Mainnet deployment on Base
- [ ] `pnpm dev` → ship

---

## 13. Environment Setup

```bash
# 1. Fill apps/web/.env.local with these required vars:
DATABASE_URL=postgresql://...        # Neon (free tier works)
SPACESHIP_API_KEY=...             # spaceship.com/application/api-manager
SPACESHIP_API_SECRET=...
CLOUDFLARE_API_TOKEN=...            # Cloudflare dashboard
CLOUDFLARE_ACCOUNT_ID=...
ACME_ACCOUNT_PRIVATE_KEY=...        # PEM for ACME account key; use \n escapes in single-line envs
ACME_CONTACT_EMAIL=ops@example.com  # Let's Encrypt contact email
SSL_CERT_ENCRYPTION_KEY=base64:...  # 32-byte base64 key for encrypted cert storage
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_REQUIRED=true
ADMIN_ADDRESSES=0x...,0x...            # wallet addresses allowed to use admin endpoints
CRON_SECRET=...                        # bearer secret for scheduled cron routes
RESEND_API_KEY=...                  # resend.com
RESEND_WEBHOOK_SECRET=...           # secret shared with Resend inbound webhook
PINATA_JWT=...                      # pinata.cloud
BACKEND_PRIVATE_KEY=0x...           # backend signer wallet
ETHEREUM_RPC_URL=https://...        # Ethereum mainnet RPC for ENS L1 registration
TREASURY_ADDRESS=0x...              # where fees go

# 2. Install deps
pnpm install

# 3. Deploy contracts manually in Remix with a temporary deploy wallet

# 4. Set contract addresses in apps/web/.env.local from Remix deploy output
IDENTITY_REGISTRY_ADDRESS=0x...
PAYMENT_ROUTER_ADDRESS=0x...
RENEWAL_VAULT_ADDRESS=0x...

# 5. Create DB schema
pnpm --filter @agentdomain/web db:push

# 6. Check production wiring without printing secret values
pnpm --filter @agentdomain/web preflight

# 7. Run dev server
pnpm dev
# → http://localhost:3000
```

---

## 14. One Liner for Every Situation

| Situation                            | What to say                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Explaining to a developer            | "npm install @agentdomain/sdk — your agent gets a domain, .base.eth, email, and SSL in one call, paid in USDC on Base" |
| Explaining to an investor            | "We're the identity infrastructure layer for the agent economy. First mover, 87% margins, Base-native."                |
| Explaining to a non-technical person | "We give AI agents their own address on the internet, like registering a business — but the AI does it itself."        |
| Explaining the market timing         | "We're building the roads before the cars arrive. The cars are coming."                                                |
