# Changelog

Notable changes to AgentDomain's public packages are recorded here. Published
versions are immutable in their respective registries.

## npm 0.11.0 - 2026-09-14

`@agentdomain/shared`, `@agentdomain/sdk`, `@agentdomain/mcp-server`,
`@agentdomain/agentkit-plugin` and `@agentdomain/eliza-plugin` are published at
0.11.0. Registry tarballs match the reviewed immutable artifacts from
[GitHub Actions run 34837830930](https://github.com/0xmdrakib/AgentDomain/actions/runs/34837830930),
using source commit `f975c685477d6602a12511701f36e429fb7fe1b1`.

The run published those five packages before stopping at the first LangChain
publication. `@agentdomain/langchain-plugin`, `agentdomain-crewai` and
`agentdomain-autogen` remain unpublished 0.11.0 source candidates. This is a
post-event publication update, not additional implementation claimed during
ETHOnline.

## All Packages 0.11.0 - Source Release

All eight publishables target 0.11.0: `@agentdomain/shared`, `@agentdomain/sdk`,
`@agentdomain/mcp-server`, `@agentdomain/agentkit-plugin`,
`@agentdomain/eliza-plugin`, `@agentdomain/langchain-plugin`,
`agentdomain-crewai` and `agentdomain-autogen`. The source release was prepared
before registry publication; the dated entry above records the verified status.

- CrewAI and AutoGen gain standalone Python package entrypoints, retaining the
  native MCP protocol and read-only/unsigned-plan boundaries.
- Machine-readable docs derive all eight versions from npm and Python manifests.
- Existing third-party dependency pins and earlier release history remain intact.

## SDK/MCP 0.10.0 - 2026-09-13

SDK and MCP 0.10.0 are published on npm with GitHub Actions provenance. The
accompanying frontend and documentation are deployed. The separate LangChain
0.1.0 source candidate is implemented and tested, but its first npm publication
remains pending; it is not included in the published-version claim.

- Adds `inspectAgentIdentity` and `inspectAgentRenewal`: Base safe-block,
  EIP-1898 hash-pinned observations with CCIP Read disabled. Token IDs and atomic
  amounts remain strings; unavailable data is not reported as missing or healthy.
- Adds `prepareAutoRenewChange`, `executeAutoRenewChange` and
  `confirmAutoRenewChange`. Execution requires a host human-approval callback and
  fresh owner/state checks. Confirmation binds matching transaction data after
  the recorded observation block and current safe readback, not proof that a
  particular human approved the plan or that a registrar renewal completed.
- Prevents reentrant duplicate submissions and automatic replay of submitted,
  rejected or uncertain attempts for the same plan object. Explicit reuse after
  `no_change` performs fresh checks. This is not persistent cross-process
  idempotency.
- Adds MCP `inspect_agent_identity`, `inspect_agent_renewal` and
  `prepare_auto_renew_change` to the read-only surface; no execution tool is
  added to that default surface. Existing opt-in write tools remain separate.
  Adds read-only renewal observations to the verification view.
- Adds the real LangChain tools package and Python CrewAI/AutoGen stdio MCP
  examples. Their new flows inspect or prepare unsigned changes without sending
  transactions. CrewAI now uses its official core-native MCP APIs, with Windows
  and Linux native fixture tests completed. Its optional Python recipe retains
  known Chroma advisories. No clean dependency audit is claimed; see the
  [scoped security note](packages/mcp-server/examples/crewai/README.md#security-note).
- Generates machine-readable documentation: full text, documented-route OpenAPI,
  SDK/MCP discovery index and a project-defined discovery document. These are
  source-derived static outputs, not a new backend or remote MCP service.

An enabled auto-renew flag allows authorized renewal operators to use funded
vault balances without per-renewal signatures; the actual registrar quote may
exceed the minimum. Disabling stops new reservations, not completion and charging
of an existing one. A zero-value setting transaction can still incur gas.

The SDK moves from pre-1.0 `0.9.x` to `0.10.0`; existing `^0.9.0` ranges do not
select it. Install `@agentdomain/sdk@0.10.0` and `@agentdomain/mcp-server@0.10.0`
explicitly when adopting these features.

## SDK and shared 0.9.1 - 2026-09-08

SDK and shared 0.9.1 were published to npm on September 8. The SDK 0.10.0
release retains these existing fixes; they are not new final-day renewal work.
The shared package remains 0.9.1, and MCP remained 0.9.0 for this patch release.
No new fee or MCP, AgentKit or Eliza feature was introduced by this patch.

- Fixes the duplicate payment-signature prompt for request-bound x402 checkout:
  create one EIP-3009 payment authorization using the issued request binding,
  preserving the full accepted requirement and its `extra` metadata unchanged.
  Separate wallet authentication can still require a signature.
- Validates bound Base USDC payment requirements, recipient, EIP-712 domain,
  amount, timeout, request binding, and optional ISO `quoteExpiresAt` before
  payment signing. Treats `registrationQuote` as an opaque string; it is echoed,
  not decoded, reconstructed, or used to reprice the request.
- Adds the reusable public `registrationPaymentRejectionSchema` in shared and
  exports SDK `RegistrationPaymentRejectedError` with code
  `REGISTRATION_PAYMENT_REJECTED`, `serverCode`, `message`, `handle`, and
  `settlementAttempted: false`. Only an explicit HTTP `4xx` response other than
  `408` satisfying the rejection contract qualifies; an error status alone does
  not. HTTP `5xx`, timeouts, and unconfirmed conflicts retain
  `RegistrationPendingError` and recovery information. Neither error authorizes
  automatic replacement signatures or paid-request retries.
- Updates registration documentation with payer-authenticated popup/dashboard
  notices, channel-specific dismissal, and expiry semantics. These are public
  HTTP endpoints, not new SDK notice methods.

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
