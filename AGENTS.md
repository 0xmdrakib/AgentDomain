# AgentDomain Public Repository Instructions

## Ownership

- This repository owns the product frontend, public documentation, SDKs, public
  shared contracts, integrations, examples and verified contract artifacts.
- Keep backend implementations, private infrastructure, admin/operator surfaces,
  internal planning, credentials and customer data out of this repository.
- Preserve the Apache-2.0 license and the public boundary checks. Do not copy
  private repository rules, internal notes or environment values into this tree.

## Public Version Releases

- For every authorized public package version release, complete the release
  checklist in `CONTRIBUTING.md` without waiting for a separate reminder to add
  a public tag, release notes or a GitHub release.
- Keep publishable package versions aligned when the release is coordinated.
  Do not change third-party dependency versions merely to match our version.
- Before tagging, select a reviewed source commit and verify a signed release
  tag or its target commit using GitHub's cryptographic verification result.
  GitHub must report `verification.verified: true`; do not declare the signature
  gate complete from a commit message, local identity, green CI or npm/PyPI
  provenance. GitHub rebase merges produce unsigned replacement commits, so
  they are not a substitute for a verified release anchor.
- Create the matching tag using the established `npm-v<version>` convention for
  coordinated package releases, publish accurate release notes, and mark the
  newest stable release Latest. Do not mark a prerelease or older maintenance
  release Latest. Record the actual source commits when different packages were
  published from different, verified equivalent package trees.
- Verify the remote tag, release, registry versions, artifact checksums and
  available provenance before reporting completion. A partial publication or
  missing signature is unfinished and must be stated clearly.
- Never silently move or delete an already published tag, rewrite public history,
  backdate a commit, republish an immutable package version, weaken verification,
  or introduce broad credentials just to obtain a badge. Obtain explicit approval
  for a published-tag/history change or a required account/security grant.
- Preserve meaningful feature commits. Use a signing-capable release process
  rather than squashing unrelated work simply to obtain a signature. No signing
  key or secret belongs in this repository.

## Verification

- Before every public push, run `pnpm ci:public`, focused regression tests, a
  secret scan, and the package checks relevant to the change. Keep release and
  deployment environments separate from pull-request validation.
- Inspect the exact diff, do not revert unrelated user changes, and remove only
  task branches whose work is verified as preserved on `main`.
