# Contributing to AgentDomain

Thank you for improving AgentDomain's public developer experience.

## Repository ownership

- `apps/frontend` is the source of truth for the public frontend.
- `apps/docs` is the source of truth for public documentation.
- `packages` and `apps/mcp-server` contain the public packages and integrations.
- Changes in this repository must stay within the public surfaces listed above.

Public code must depend only on documented public contracts. Never include
credentials, customer data, internal operational material, or generated deployment
state in a pull request.

## Local setup

Requirements are Node.js 22.12 or newer and pnpm 10 or newer.

```bash
pnpm install --frozen-lockfile
pnpm check:public-boundary
pnpm ci:public
```

Use a local, ignored `frontend.env` only when frontend development requires it.
The committed `frontend.env.example` must contain names and comments only; every
assignment must remain empty. Never put a secret in a `NEXT_PUBLIC_*` or other
browser-visible setting.

## Pull requests

Keep each pull request focused and explain the public behavior it changes. Add
or update tests and public documentation with contract changes. Before opening
the pull request:

1. Run the public-boundary check and relevant tests.
2. Confirm no secret, environment file, private key, private repository name, or
   private implementation path is present.
3. Confirm new dependencies are necessary, licensed compatibly, and represented
   in the public lockfile.
4. Confirm frontend and docs changes work without access to a private checkout.
5. Confirm generated output, local caches, `.codex`, `.wrangler`, and deployment
   credentials are not committed.

Fork pull requests receive read-only CI permissions and no deployment secrets.
Deployment configuration and production changes require a separate maintainer
review and are never performed by pull-request CI.

## Security reports

Do not disclose vulnerabilities in an issue or pull request. Follow
[SECURITY.md](SECURITY.md) for private reporting.
