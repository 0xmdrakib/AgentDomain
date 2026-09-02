# AgentDomain Frontend

This package is the public source of truth for the AgentDomain web frontend. It contains the
presentation layer, public transport contracts, approved brand assets, and Cloudflare Workers
deployment configuration. Business APIs, administration tooling, persistence, provider
credentials, and operational implementation do not belong in this package.

The package is Apache-2.0 licensed and remains `private: true` so it cannot be published to npm by
mistake. AgentDomain names and artwork remain subject to the repository's trademark notice.

## Public Architecture

- `agentdomain.app` and `www.agentdomain.app` are Cloudflare Worker Custom Domains owned by the
  production frontend Worker.
- The private API edge owns the more-specific `agentdomain.app/api*` route, which takes precedence
  over the root frontend Custom Domain.
- Browser API requests remain same-origin under `/api/v1`; the frontend Worker never implements
  business API handlers.
- Server-rendered public reads use the credential-free public base
  `https://api.agentdomain.app/api/v1` and only fixed `/public/*` endpoints.
- Custom-domain rendering uses the standard request `Host` header. The frontend does not accept
  trusted forwarding headers or shared edge secrets.
- Documentation is authoritative at `https://docs.agentdomain.app`. `/docs` and
  `/docs/:path*` are permanent, path-preserving redirects and no docs content is duplicated here.

## Environment Boundary

`frontend.env` is local-only and ignored. `frontend.env.example` is the tracked, value-free
inventory. Deployed settings belong in Cloudflare configuration; never commit real values.

| Variable                               | Visibility              | Purpose                                                                                                |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `FRONTEND_PUBLIC_API_URL`              | Server only, non-secret | Optional local-development API override. Production is pinned to `https://api.agentdomain.app/api/v1`. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Browser public          | WalletConnect project identifier.                                                                      |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`       | Browser public          | Cloudflare Turnstile site key.                                                                         |

Anything prefixed with `NEXT_PUBLIC_` is shipped to browsers and must never contain a secret. The
frontend source and build checks reject unreviewed environment variables, server sessions,
business API routes, private provider packages, administration routes, and environment files in
artifacts.

## Development

From the public repository root:

```bash
pnpm --filter @agentdomain/frontend dev
pnpm --filter @agentdomain/frontend test
pnpm --filter @agentdomain/frontend typecheck
pnpm --filter @agentdomain/frontend lint
pnpm --filter @agentdomain/frontend build
```

`next dev` is used for normal iteration. `initOpenNextCloudflareForDev()` keeps local Next.js
development compatible with the Worker adapter.

## Cloudflare Workers

The deployment is pinned to Next.js `16.3.4`, `@opennextjs/cloudflare` `1.20.5`, and Wrangler
`4.128.0`. OpenNext emits `.open-next/worker.js` and `.open-next/assets`; `nodejs_compat` and Worker
observability are enabled.

```bash
pnpm --filter @agentdomain/frontend build:cloudflare
pnpm --filter @agentdomain/frontend preview
pnpm --filter @agentdomain/frontend deploy
```

- `build:cloudflare` verifies assets and source isolation, builds OpenNext, then scans both Next.js
  and Worker artifacts.
- `preview` uses the separate `agentdomain-frontend-preview` environment. It has no production
  routes and uses Cloudflare preview/Workers URLs.
- `deploy` targets `agentdomain-frontend` and its two production Custom Domains. Deployment
  credentials and account configuration are supplied outside this repository.

The public Wrangler file intentionally contains no API route, account identifier, secret,
database, queue, storage, or privileged binding.

## Brand Assets

`public/brand/agentdomain-brand/` is the complete approved 41-image kit and is tracked directly.
`src/lib/brand-assets.json` is the canonical URL/legacy-alias mapping, while
`src/lib/brand-assets.ts` provides typed application exports.

`brand-assets.manifest.json` pins every image, mapping, and ownership file by SHA-256.
`scripts/verify-assets.mjs` rejects missing, modified, extra, non-regular, or symlinked brand files.
No build step copies from another repository and no artwork is transformed.

The shared social card is `logo-for-link-embed.png`; `logo-for-x-bg.png` is the profile banner.
Legacy asset URLs are permanent redirects to canonical files.

## Security Checks

The test and build gates verify that:

- the source graph closes over this frontend plus reviewed public SDK/shared packages;
- no administration page/component or in-app docs source exists;
- browser APIs stay same-origin and server reads use the fixed public API host;
- custom-domain selection trusts only the standard `Host` header;
- CSP network and image origins are bounded to required wallet, Base, Turnstile, font, and media
  services;
- standard Next configuration supplies headers and redirects without unsupported Node middleware;
- authenticated and API-origin responses remain `no-store`;
- generated artifacts contain no business API, private backend dependency, environment file, or
  administration implementation; and
- production and preview Worker routing remain separated.

Changes to public routes, browser-visible variables, network origins, transport schemas, brand
files, or Cloudflare configuration must update the corresponding tests in the same change.
