# AgentDomain documentation

Public documentation for AgentDomain. This package is a standalone Astro 7 and Starlight 0.41
static site hosted with Cloudflare Workers Static Assets.

## Local development

Install from the public repository root so the single reviewed workspace lockfile is used:

```bash
pnpm install --frozen-lockfile
pnpm --filter @agentdomain/docs dev
```

## Verification

```bash
pnpm --filter @agentdomain/docs check
```

The check validates the public content boundary, frontmatter, internal links, approved brand
asset hashes, TypeScript, focused contract tests, the production build, search output, sitemap,
robots policy, security headers, canonical URL, and generated HTML.

## Cloudflare hosting

`wrangler.jsonc` is the deployment source of truth:

- Worker: `agentdomain-docs`
- Canonical domain: `docs.agentdomain.app`
- Preview: `workers.dev` and preview URLs enabled with `noindex` response headers
- Hosting: static assets only, with no runtime Worker script or secret bindings

Deployment is intentionally explicit:

```bash
pnpm --filter @agentdomain/docs deploy
```

Only approved CI or an authorized operator should run deployment. No provider credential belongs
in this repository or in browser-visible configuration.

## Publication boundary

Documentation may describe public API behavior, authentication, idempotency, limits, and
user-visible lifecycle states. It must not contain operator routes, secret configuration names,
private runbooks, infrastructure topology, storage or queue algorithms, or backend recovery
procedures. `pnpm validate:content` enforces this boundary before build.
