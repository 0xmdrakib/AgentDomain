# AI Assistance Disclosure

AgentDomain used OpenAI Codex to assist ETHOnline 2026 work on resumable
registration, identity/renewal inspection, owner-approved auto-renew controls,
LangChain/CrewAI/AutoGen integrations and machine-readable documentation.
This is not represented as unaided human coding.

## Human Direction

The founder defines the product and its user problems, approves scope and product
decisions, and directs the requirements for reliable registration recovery and
useful, independently inspectable lifecycle information. Inspection and framework
planning are read-only; registration and owner-wallet execution are separate
authorized workflows. The founder owns final approval, hands-on testing and the
human-narrated demo. An agent's tool output is not permission to sign or spend.

Founder testing and the final voice recording are not asserted complete here.
Before submission, the founder must exercise the actual implemented flow,
understand its trust limitations, approve the final claims, and record their own
spoken demo using their original voice and actual product footage. AI-generated
video or narration must not substitute for that contribution.

## Assisted Work

- Repository inspection and implementation planning for the public registration
  and inspection interfaces.
- Code generation, editing and review under the approved scope.
- Automated test cases, local validation and failure-path analysis.
- Usage documentation, the pre-existing/new-work distinction and this disclosure.

Assisted areas include registration SDK/recovery code, shared public response
contracts, frontend progress/payment/notification handling and tests in commits
`f14392b` and `c4f477c`. The final-day work includes the standalone inspection SDK,
renewal SDK, the `/verify` observations, MCP inspection/unsigned planning tools,
the three executable framework integrations, generated documentation and their
tests. Exact
source and commit boundaries are listed in
[BUILT_DURING_ETHONLINE.md](BUILT_DURING_ETHONLINE.md); final release evidence is
not assumed complete from these descriptions.

## Public Task Specifications

For registration, the instructions were to make progress resumable, isolate it
to the correct payer, distinguish explicit payment rejection from uncertain
outcomes, and recover through authenticated reads without automatically paying
again. Tests and UI states must expose those distinctions.

For inspection, the instructions were to expose `inspectAgentIdentity` through
a read-only, idempotent MCP tool and a verification view; accept a domain or token
ID and optional expected owner; use Base mainnet without platform authentication;
never accept model-selected RPC endpoints, sign, write or fetch metadata; and
accurately explain the limits of RPC observations. Tests must verify those
boundaries, including missing identities and failed or inconsistent reads.

For renewal, the task was to read the existing vault at the identity's canonical
block hash, distinguish minimum fee from registrar quote, and prepare exact
unsigned setting changes. Wallet execution requires a host human-approval
callback and fresh checks. A confirmed flag transaction is not a completed
domain renewal, and disabling does not cancel a pending reservation.

For frameworks and documentation, the task was to use real framework APIs,
restrict the new agent flows to inspection/unsigned planning, and generate
machine-readable references from reviewed public sources. Tests use controlled
RPC data and fake wallets where needed, not live paid execution. CrewAI's native
MCP path has Windows fixture tests; Linux qualification and dependency review
remain release gates, and no full security audit is claimed. SDK/MCP 0.10.0 and LangChain 0.1.0 are unpublished
source candidates, and the new UI/docs changes are not yet deployed.

These are feature-specific public specifications, not copies of operational
planning or production configuration. No credentials, customer information,
private code or unrelated development history are included. Only the reviewed
event extensions and their actual evidence should be represented as the new contribution.
