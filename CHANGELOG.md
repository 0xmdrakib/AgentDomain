# Changelog

Notable changes to AgentDomain's public npm packages are recorded here. Package
versions are immutable once published to npm.

## 0.9.0 - 2026-09-08

Adds resumable registration APIs and reviewed dependency updates across the five
public packages. This pre-1.0 minor release includes behavior and type-compatibility
changes; review the upgrade notes before moving from 0.8.x.

### Highlights

- Adds SDK `submitRegistration`, `getRegistration`, `getRegistrations`,
  `waitForRegistration`, and `recoverRegistration` methods, shared registration
  types/schemas, and structured pending/failed errors.
- Makes `register()` request asynchronous acceptance and wait through
  payer-authenticated status reads after HTTP `202`. Lost responses, timeout, and
  abort preserve recovery handles without automatically resubmitting payment.
- Updates the aligned x402 packages to 2.25.0, the viem dependency floor to 2.56.3,
  and the MCP SDK dependency floor to 1.30.0, with payment and stdio regression tests.
- Reports the installed MCP package version in the protocol handshake instead of
  the stale hard-coded version.

### Upgrade Notes

- `register()` waits up to ten minutes after acceptance by default; submission and
  individual requests default to sixty seconds. Catch `RegistrationPendingError`
  and retain its handle. Timeout or abort does not cancel an accepted purchase.
  `RegistrationFailedError` represents a server-reported failed or refunded state,
  not an instruction to pay again.
- Registration requires payer authentication, not an agent API key. Status reads
  verify `X-Authenticated-Wallet`; custom API adapters must implement the documented
  status contract. Legacy HTTP `200` results are validated and unknown fields are
  stripped; unfinished provisioning in a legacy result is not total completion.
- API URLs are validated at construction: HTTPS is required except for explicit
  loopback HTTP endpoints. Non-browser clients need an absolute URL; embedded
  credentials, query strings, and fragments are rejected.
- Align/deduplicate consumer viem installations to the reviewed 2.56.3 version.
  An independently pinned 2.55.8 `PublicClient` lacks the required
  `watchBlockHeaders` member and can fail assignment to SDK types.
- The x402 helper explicitly disables the new upstream default $1 cap and
  recognized-asset allowlist to preserve its previous payment-selection policy.
  This is not a new spending budget or independent verification of an earlier
  quote. Callers remain responsible for payment authorization; Base-mainnet exact
  v2 signing and existing request-binding checks remain in place.
- MCP stdio now retains a 10 MiB (10,485,760-byte) accumulated unprocessed-input
  bound, including framing, not merely a per-message size limit. Overflow closes
  the transport; reconnect without blindly replaying writes with unknown outcomes.
- Package names, import paths, the `agentdomain-mcp` executable, and AgentKit/Eliza
  peer ranges are unchanged. SDK/plugin modules remain ESM-only. No new framework
  major-version support, instant service-readiness guarantee, or production service
  change is implied by this npm release.

## 0.8.0 - 2026-09-03

This release establishes the public repository as the canonical source and
release pipeline for all AgentDomain npm packages.

### Highlights

- Ships SDK, shared contracts, MCP server, AgentKit, and ElizaOS packages from
  one reviewed public `main` commit with npm provenance.
- Keeps the MCP server read-only by default and requires an exact explicit
  opt-in before write tools are advertised or dispatched.
- Adds complete public DNS, email, registry, renewal, service-plan, and x402 v2
  integration surfaces.
- Enforces ERC-8021 Builder Code attribution for supported direct Base writes.
- Includes linear-time untrusted-text parsing in the ElizaOS integration.
- Improves npm metadata, package-specific documentation, credential guidance,
  source links, and security reporting links.

### Compatibility

- Package names and public import paths are unchanged.
- The canonical API remains `https://api.agentdomain.app/api/v1`.
- The MCP executable remains `agentdomain-mcp` and requires Node.js 20 or newer.

## 0.7.1 - 2026-09-02

- Hardened ElizaOS untrusted-text parsing against polynomial regular-expression
  behavior.

## 0.7.0 - 2026-09-01

- Added attributed public clients and the current AgentDomain integration
  surface.
