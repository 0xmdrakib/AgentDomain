# Contributing to AgentDomain

Thank you for improving AgentDomain's public developer experience.

## Pull requests

Keep each pull request focused and explain the public behavior it changes. Add
or update tests and documentation when a public contract changes.

Before opening a pull request:

1. Run the public-boundary check and relevant tests.
2. Confirm no credentials, private keys, customer data, populated environment
   files, or generated artifacts are included.
3. Confirm new dependencies are necessary, license-compatible, and represented
   in the lockfile.
4. Confirm browser-visible settings contain public values only.
5. Confirm documentation links and examples work as written.

Never put a secret in browser-delivered configuration or client-side code. Keep
environment files untracked and committed examples value-free.

## Security reports

Do not disclose vulnerabilities in an issue or pull request. Follow
[SECURITY.md](SECURITY.md) for confidential reporting.
