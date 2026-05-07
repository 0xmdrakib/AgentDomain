# @agentdomain/contracts

Smart contracts for AgentDomain. Solidity 0.8.24, built with Foundry.

## Contracts

| Contract                | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `AgentIdentityRegistry` | ERC-721 NFT representing an agent identity bundle        |
| `PaymentRouter`         | Receives USDC payments and triggers minting (idempotent) |
| `RenewalVault`          | Holds USDC for autonomous identity renewals              |

## Architecture

```
        ┌─────────────────────┐
        │   Off-chain x402    │
        │     Backend         │
        └──────────┬──────────┘
                   │ processRegistration
                   ▼
        ┌─────────────────────┐
        │   PaymentRouter     │  ─── pulls USDC ──> Treasury
        └──────────┬──────────┘
                   │ mintIdentity
                   ▼
        ┌─────────────────────┐
        │AgentIdentityRegistry│  ── ERC-721 ──> Agent wallet
        └──────────▲──────────┘
                   │ extendExpiry
        ┌──────────┴──────────┐
        │   RenewalVault      │  <── deposit ── Agent
        └─────────────────────┘
                   ▲
                   │ executeRenewal
              ┌────┴────┐
              │ Keeper  │
              └─────────┘
```

## Setup

```bash
# Install Foundry (one-time)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies from the workspace lockfile
pnpm install

# Build
forge build
```

## Remix Deployment

Deploy from Remix with a temporary deploy wallet, not your main wallet private key.
After deployment, wire permissions and transfer ownership to your main admin wallet
or Safe.

1. Deploy `AgentIdentityRegistry` with `initialOwner = deploy wallet address`.
2. Deploy `PaymentRouter` with `initialOwner`, Base USDC, registry address, treasury address, and backend signer address.
3. Deploy `RenewalVault` with `initialOwner`, Base USDC, registry address, registry address, and treasury address.
4. Call `setMinter(paymentRouterAddress, true)` on `AgentIdentityRegistry`.
5. Call `setRenewalVault(renewalVaultAddress)` on `AgentIdentityRegistry`.
6. Call `setKeeper(backendOrKeeperAddress, true)` on `RenewalVault`.
7. Transfer ownership of all three contracts to your final admin wallet or Safe.
8. Put the three deployed contract addresses into `apps/web/.env.local`.

## Security Notes

- Idempotency keys prevent replay attacks on registration.
- `Pausable` PaymentRouter can be paused in emergencies.
- `RenewalVault` keepers are gated; anyone can deposit, only owner can withdraw.
- Registry uses ERC-721 transfer hooks to keep `_ownerToTokenId` accurate.
- All admin functions are guarded by `Ownable`; production ownership should end on
  a Safe or dedicated admin wallet, not on the temporary deploy wallet.

## Audit Status

- [ ] Internal review complete
- [ ] Code4rena / Sherlock contest scheduled
- [ ] Bug bounty (Immunefi) live
