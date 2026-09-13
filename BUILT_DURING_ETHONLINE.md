# Built During ETHOnline 2026

## Event Contributions

This Continuity entry adds resumable registration, independent identity and
renewal inspection, owner-approved auto-renew controls, three framework
integrations and machine-readable documentation. [PREEXISTING.md](PREEXISTING.md)
separates the pre-event platform, earlier event commits and final-day additions.

SDK/MCP **0.10.0** and LangChain **0.1.0** are source release candidates, **not yet
published**. The new frontend and docs outputs are **not yet deployed**. Final
commit, package/deployment verification and the founder's recorded demo remain
submission gates.

## 1. Resumable, Wallet-Safe Registration

[`f14392b280d117380cdf9a92b78f0bd37f78b619`](https://github.com/0xmdrakib/AgentDomain/commit/f14392b280d117380cdf9a92b78f0bd37f78b619),
**2026-09-06T01:18:16Z**, adds asynchronous registration and reusable recovery
handles in `packages/sdk/src/registration.ts`. New public methods include
`submitRegistration`, `getRegistration`, `getRegistrations`,
`waitForRegistration` and `recoverRegistration`. Frontend tracking and notices
keep progress associated with the correct payer and survive interrupted sessions.

[`c4f477c617f5832df618a508e5769bdf44a738a9`](https://github.com/0xmdrakib/AgentDomain/commit/c4f477c617f5832df618a508e5769bdf44a738a9),
**2026-09-08T22:33:10Z**, extends that work with a single request-bound EIP-3009
payment signature, stricter payment validation, explicit rejection versus
uncertainty, proof-bound reservation-release handling, and richer registration
notifications. A payment signature is separate from wallet authentication; this
does not promise that every flow has only one wallet prompt.

The public specification for this scope is to resume status/recovery through
payer-authenticated reads, keep another wallet's session from becoming authority,
and avoid automatically resubmitting an uncertain paid request. Registration
still uses the commercial API. These extensions improve existing checkout; they
do not create x402, the registry contract or a new registration contract.

Event-specific source and test evidence:

- SDK implementation in `packages/sdk/src/registration.ts` and `src/index.ts`;
  acceptance/progress/rejection contracts in `packages/shared/src/`.
- SDK tests: `registration.test.mjs`, `registration-payment-rejection.test.mjs`
  and `x402-v2.test.mjs` under `packages/sdk/test/`.
- Frontend progress, submission, tracker and notice logic under
  `apps/frontend/src/lib/`; registration tracker and updates components under
  `apps/frontend/src/components/register/`.
- Frontend regression/browser tests include registration progress/submission,
  payment outcomes, notices, uncharged reservations and reference retry under
  `apps/frontend/test/`. Synthetic API fixtures demonstrate client failure paths
  and must be labeled as fixtures in any recording.
- Updated registration, SDK and API documentation accompanies these commits.

The commit links establish event-period source history. Listing these test files
does not substitute for the final executed release-test results.

## 2. Independent Agent Identity Inspection

Built on the September 12 snapshot `4ac0d284e603a2289c248a981821ee975899e699`,
this adds `inspectAgentIdentity`, the MCP tool `inspect_agent_identity`, and a
verification view. It reads the custom AgentDomain ERC-721 registry on Base;
it is not an ERC-8004 registry implementation. Earlier event registration work
is reused without being counted again as new inspection code.

### Minimal Public Specification

- Accept exactly one registered domain or decimal token ID, with an optional
  expected-owner comparison. Do not accept RPC URLs, alternate chains, signers
  or platform credentials as MCP tool arguments.
- Read identity fields and consistency checks at one Base `safe` block hash
  using EIP-1898 canonical reads, with CCIP Read disabled; return JSON-safe
  values with chain, registry and block provenance.
- Distinguish a missing identity from an unavailable RPC or invalid request.
- Compare ownership, domain, metadata URI and lifecycle observations without
  signing, sending a transaction, calling the platform API or fetching metadata.
- Treat the result as an RPC observation. It is not consensus/SPV verification,
  a DNS ownership proof, KYC, or proof that linked Basename/ENS labels resolve.
- Preserve the MCP server's read-only defaults and publish reproducible tests,
  usage documentation and a truthful before/after demonstration.

### Implementation Evidence

- SDK: `packages/sdk/src/identity-inspection.ts` and its package-root export;
  dedicated `identity-inspection*.test.mjs` tests cover ordinary reads, errors,
  offchain-lookup rejection and same-height fork binding.
- MCP: `packages/mcp-server/src/index.ts` calls the SDK before constructing any
  authenticated platform client. `test/identity-inspection.test.mjs` exercises
  the real SDK through stdio with an offline RPC interceptor, including the
  default Multicall3 read path and missing-token revert. Existing read-only
  tests cover default availability and annotations.
- Verification view: `apps/frontend/src/app/verify/`,
  `apps/frontend/src/components/verify/`, and
  `apps/frontend/src/lib/identity-observation.ts`, with focused observation tests.
- Documentation: the existing SDK and MCP pages under
  `apps/docs/src/content/docs/sdk/`, focused documentation tests, this minimal
  specification and the linked disclosures.

An internally consistent, active identity is not an endorsement. The optional
expected-owner comparison remains distinct from internal consistency; linked
name labels, metadata contents and real-world identity are not verified.

## 3. Renewal Observation And Owner-Controlled Settings

`packages/sdk/src/renewal-workflow.ts` adds `inspectAgentRenewal`,
`prepareAutoRenewChange`, `executeAutoRenewChange` and `confirmAutoRenewChange`.
Identity and the existing RenewalVault are read at the same canonical block
hash. Available and reserved USDC, minimum fee, timing, pending reservations and
consistency checks remain separate; amounts and IDs use decimal strings.

Preparation produces an unsigned, attributed `setAutoRenew` transaction after
owner/state checks. Execution requires a trusted host human-approval callback,
revalidates before a single wallet submission, and preserves uncertain outcomes
without retrying. Explicit reuse after `no_change` checks fresh state. Confirmation
requires a matching transaction after the plan's observation block and current
safe readback; it confirms a flag change, not human approval or registrar renewal.

Enabling permits authorized renewal operators to use funded balances without
per-renewal signatures, at a quote that may exceed the minimum. Disabling stops
new reservations but does not cancel or prevent charging an existing one. The
private renewal engine is reused, not exported or presented as new public code.

Evidence: SDK `renewal-workflow*.test.mjs` (real ABI/RPC fixtures and fake wallet
execution), MCP `test/renewal-workflow.test.mjs`, and the frontend's read-only
`renewal-readiness.tsx` and `renewal-observation.test.ts`. No live wallet write is
claimed by those tests.

## 4. Three Executable Framework Integrations

| Framework                                                 | New public work                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [LangChain](packages/langchain-plugin)                    | Typed tools using real `@langchain/core`, with host opt-in for unsigned planning and invocation/schema tests. |
| [CrewAI](packages/mcp-server/examples/crewai)             | Python stdio MCP inspection/planning using official core-native APIs, without `crewai-tools`.                 |
| [Microsoft AutoGen](packages/mcp-server/examples/autogen) | Native Python `McpWorkbench` example with allowlisted tool discovery/calls and explicit owner-review output.  |

The new framework flows inspect identity/renewal and optionally return unsigned
plans. They expose no auto-renew execution tool, signer or model-provided approval
authority. Python frameworks are separately installed dependencies, not new npm
implementations of those frameworks. Existing guide pages were updated rather
than counted as entirely new integrations by themselves.

Tests use real framework APIs and the Node MCP/SDK with controlled RPC fixtures,
without paid models or live transactions. The new native CrewAI Windows run
passed 18 tests with 33 real MCP child processes, all closed. Twelve checks
trapped 32 actual Chroma entrypoints with zero calls. These results belong to the
new native path, not the older adapter; Linux qualification remains pending.

Its mandatory Chroma dependency has four known advisories under review, not
only server risks. [Upstream issue #6717](https://github.com/chroma-core/chroma/issues/6717)
also describes Python-client code execution through a poisoned collection's
embedding configuration. This exact recipe uses no Chroma client, collections,
embeddings, server or memory. See the example's
[scoped security note](packages/mcp-server/examples/crewai/README.md#security-note).
That limited test coverage does not establish a clean dependency audit or the
safety of other Chroma usage.
Native Python evidence lives in `packages/mcp-server/test/crewai-integration.*`
and `test/autogen.integration.test.mjs`, alongside the examples' tests.

## 5. Generated Machine-Readable Documentation

The static docs build now derives `llms-full.txt`, `openapi.json`, `api-index.json`
and `.well-known/agentdomain.json` from allowlisted docs, reviewed HTTP mappings,
public schemas and package sources. Source hashes and workspace versions identify
the build; they are not npm publication evidence. OpenAPI covers documented HTTP
routes only, not invented REST equivalents of onchain SDK functions. Discovery
is project-defined, not an A2A agent card or remote MCP endpoint.

Implementation and reproducibility checks are in `apps/docs/scripts/machine-docs.mjs`,
`public-api-contract.mjs`, `validate-machine-docs.mjs` and `apps/docs/test/`.
The existing docs site and short `llms.txt` are reused, not new platforms.

## Release And Demo Evidence

The old/new distinction above is backed by actual source and event commits.
Final committed feature SHA, complete executed release checks, published versions
and deployment evidence will be recorded after verification. Framework fixtures
demonstrate read-only/unsigned flows, not live registrar renewals. The demo must
show actual use with the founder's original voice, not AI-generated video or
narration; that recording is not asserted complete here.

No sponsor integration, new contract deployment, open-sourcing of the commercial
backend, final submission or award is claimed. Final source review, clean setup,
human testing and the spoken demo remain submission gates.
