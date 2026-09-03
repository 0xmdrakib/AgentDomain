import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { auditSourceGraph, inspectSource, sourceFiles, root } from '../scripts/source-graph.mjs';
import { assertBuildBoundary } from '../scripts/check-build.mjs';
import { hashInput, verifyAssets } from '../scripts/verify-assets.mjs';
import { validateFrontendProductionEnvironment } from '../scripts/production-release-gate.mjs';

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readRepository = (path) => readFileSync(resolve(root, '../..', path), 'utf8');
const readJsonc = (path) => {
  const result = ts.parseConfigFileTextToJson(path, read(path));
  if (result.error) throw new Error(`Invalid JSONC: ${path}`);
  return result.config;
};

test('source graph closes over only frontend and reviewed public SDK/shared source', () => {
  const result = auditSourceGraph();
  assert.deepEqual(result.errors, []);
  assert.ok(result.files.length > 55);
});

test('source audit rejects private imports, server actions, sessions and unreviewed env access', () => {
  for (const source of [
    "import { agentsRepo } from '@/db';",
    "export * from '@/services/email';",
    "import type { Agent } from '@/db';",
    "const db = import('@/db');",
    "type Db = typeof import('@/db');",
    'const x = import(name);',
    "import fs from 'node:fs';",
    "'use server';",
    'process.env.SESSION_SECRET;',
    "process.env['DATABASE_URL'];",
    "import { cookies } from 'next/headers';",
  ])
    assert.ok(inspectSource(source).errors.length > 0, source);
  assert.deepEqual(inspectSource('const example = "process.env.SESSION_SECRET";').errors, []);
});

test('frontend has no business API, private implementation, admin or docs source tree', () => {
  for (const directory of [
    'src/app/api',
    'src/app/admin',
    'src/app/docs',
    'src/components/admin',
    'src/db',
    'src/proxy.ts',
    'src/services',
    'src/storage',
  ])
    assert.equal(existsSync(resolve(root, directory)), false, directory);
  const handlers = sourceFiles(resolve(root, 'src/app')).filter((file) =>
    file.endsWith('route.ts'),
  );
  assert.deepEqual(
    handlers.map((file) => relative(root, file).replaceAll('\\', '/')),
    ['src/app/sitemap-agents.xml/route.ts'],
  );
});

test('package is private Apache-2.0 source with pinned Cloudflare adapter versions', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.dependencies.next, '16.3.4');
  assert.equal(manifest.devDependencies['eslint-config-next'], '16.3.4');
  assert.equal(manifest.devDependencies['@opennextjs/cloudflare'], '1.20.5');
  assert.equal(manifest.devDependencies.wrangler, '4.128.0');
  assert.match(manifest.scripts['build:cloudflare'], /opennextjs-cloudflare build/);
  assert.match(manifest.scripts['build:cloudflare'], /@agentdomain\/shared build/);
  assert.match(manifest.scripts['build:cloudflare'], /@agentdomain\/sdk build/);
  assert.match(manifest.scripts.preview, /--env preview/);
  assert.match(manifest.scripts.deploy, /--env=""/);
  assert.doesNotMatch(
    JSON.stringify(manifest.dependencies),
    /@agentdomain\/storage|aws-sdk|google-cloud|drizzle|ioredis|qstash|postgres|"pg"/,
  );
  assert.doesNotMatch(manifest.scripts.build, /turbo|apps\/web|\.\.\//);
  assert.equal(JSON.parse(read('tsconfig.json')).extends, undefined);
});

test('artifact boundary rejects API functions, backend traces and environment files', () => {
  assert.doesNotThrow(() =>
    assertBuildBoundary(
      ['/page', '/agents/[id]/page', '/sitemap-agents.xml/route'],
      ['/app/apps/frontend/src/app/page.tsx'],
    ),
  );
  for (const route of [
    '/api/v1/agents/register/route',
    '/api/health/route',
    '/admin/page',
    '/docs/page',
    '/jobs/route',
  ])
    assert.throws(() => assertBuildBoundary([route], []));
  for (const file of [
    '/app/apps/frontend/src/db/index.ts',
    '/app/packages/storage/dist/index.js',
    '/app/node_modules/@aws-sdk/client-s3/index.js',
    '/app/frontend.env',
    '/app/.env.local',
  ])
    assert.throws(() => assertBuildBoundary([], [file]));
});

test('approved brand kit and mappings are tracked, self-contained and hash verified', () => {
  assert.deepEqual(verifyAssets(), { files: 44 });
  assert.equal(hashInput('key.txt', Buffer.from('value\r\n')).toString(), 'value\n');
  assert.deepEqual(hashInput('mark.png', Buffer.from([0x0d, 0x0a])), Buffer.from([0x0d, 0x0a]));
  const manifest = JSON.parse(read('brand-assets.manifest.json'));
  assert.equal(
    Object.keys(manifest.files).filter((file) => file.startsWith('public/brand/agentdomain-brand/'))
      .length,
    41,
  );
  const ignore = read('.gitignore');
  assert.doesNotMatch(ignore, /public\/brand|brand-assets\.(?:ts|json)/);
  const brand = JSON.parse(read('src/lib/brand-assets.json'));
  for (const path of Object.keys(brand.legacyAliases))
    assert.equal(existsSync(resolve(root, `public${path}`)), false, path);
});

test('Next config keeps only asset redirects while request routing owns host and API policy', async () => {
  const { default: config } = await import('../next.config.mjs');
  const source = read('next.config.mjs');
  assert.match(source, /src\/lib\/brand-assets\.json/);
  assert.match(source, /initOpenNextCloudflareForDev/);
  assert.match(source, /new URL\('\.\.\/\.\.\/frontend\.env'/);
  assert.match(source, /override:\s*false/);
  assert.doesNotMatch(source, /apps\/web|materialize-assets|rewrites/);
  assert.equal(config.agentRules, false);
  const redirects = await config.redirects();
  const brand = JSON.parse(read('src/lib/brand-assets.json'));
  assert.equal(redirects.length, Object.keys(brand.legacyAliases).length);
  assert.equal(JSON.stringify(redirects).includes('docs.agentdomain.app'), false);
  assert.equal(JSON.stringify(redirects).includes('www.agentdomain.app'), false);
  const middleware = read('src/middleware.ts');
  assert.match(middleware, /https:\/\/docs\.agentdomain\.app/);
  assert.match(middleware, /api\.agentdomain\.app/);
  assert.doesNotMatch(middleware, /\bfetch\s*\(|authorization|cookie/i);
  assert.match(middleware, /'\/api\/:path\*'/);
  assert.match(middleware, /'\/docs\/:path\*'/);
  const headers = await config.headers();
  assert.equal(headers.length, 2);
  const values = Object.fromEntries(headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(values['X-Frame-Options'], 'DENY');
  assert.equal(values['X-Content-Type-Options'], 'nosniff');
  assert.match(values['Strict-Transport-Security'], /includeSubDomains; preload/);
  assert.match(
    values['Content-Security-Policy'],
    /connect-src 'self' https:\/\/mainnet\.base\.org/,
  );
  assert.match(values['Content-Security-Policy'], /connect-src[^;]*https:\/\/api\.web3modal\.org/);
  assert.doesNotMatch(values['Content-Security-Policy'], /connect-src[^;]*\shttps:\s/);
  assert.doesNotMatch(values['Content-Security-Policy'], /img-src[^;]*\shttps:\s/);
  assert.deepEqual(headers[1], {
    source: '/:path*',
    has: [
      {
        type: 'host',
        value: '(?:[a-z0-9-]+-)?agentdomain-frontend-preview\\.[a-z0-9-]+\\.workers\\.dev',
      },
    ],
    headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
  });
});

test('Wrangler owns production custom domains and isolates route-free previews', () => {
  const config = readJsonc('wrangler.jsonc');
  assert.equal(config.name, 'agentdomain-frontend');
  assert.equal(config.main, '.open-next/worker.js');
  assert.equal(config.compatibility_date, '2026-09-01');
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat', 'global_fetch_strictly_public']);
  assert.deepEqual(config.assets, { directory: '.open-next/assets', binding: 'ASSETS' });
  assert.equal(config.observability.enabled, true);
  assert.deepEqual(config.limits, { cpu_ms: 1000 });
  assert.equal(config.upload_source_maps, true);
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [
    { pattern: 'agentdomain.app', custom_domain: true },
    { pattern: 'www.agentdomain.app', custom_domain: true },
  ]);
  assert.equal(config.env.preview.name, 'agentdomain-frontend-preview');
  assert.equal(config.env.preview.workers_dev, false);
  assert.equal(config.env.preview.preview_urls, false);
  assert.deepEqual(config.env.preview.routes, []);
  for (const bindingType of [
    'services',
    'kv_namespaces',
    'durable_objects',
    'd1_databases',
    'r2_buckets',
    'hyperdrive',
  ])
    assert.equal(config[bindingType] ?? config.env.preview[bindingType], undefined, bindingType);
  assert.equal(JSON.stringify(config).includes('api.agentdomain.app'), false);
});

test('static assets carry bounded cache and security headers', () => {
  const headers = read('public/_headers');
  assert.match(headers, /Strict-Transport-Security: max-age=63072000; includeSubDomains; preload/);
  assert.match(headers, /\/_next\/static\/\*/);
  assert.match(headers, /max-age=31536000, immutable/);
  assert.match(headers, /\/brand\/\*/);
  assert.match(headers, /workers\.dev\/\*/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow/);
  assert.doesNotMatch(headers, /Access-Control-Allow-Origin:\s*\*/);
});

test('production release requires complete browser config and the dedicated API origin', () => {
  const valid = {
    FRONTEND_PUBLIC_API_URL: 'https://api.agentdomain.app/api/v1',
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: 'w'.repeat(32),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4synthetic-public-site-key',
  };
  assert.deepEqual(validateFrontendProductionEnvironment(valid), {
    api: 'https://api.agentdomain.app/api/v1',
    walletConnect: true,
    turnstile: true,
  });
  for (const key of Object.keys(valid)) {
    assert.throws(() => validateFrontendProductionEnvironment({ ...valid, [key]: '' }));
  }
  assert.throws(() =>
    validateFrontendProductionEnvironment({
      ...valid,
      FRONTEND_PUBLIC_API_URL: 'https://agentdomain.app/api/v1',
    }),
  );
});

test('browser APIs stay same-origin while server reads use the reviewed public API host', () => {
  const registration = read('src/hooks/use-register-agent.ts');
  assert.match(registration, /const apiUrl = '\/api\/v1'/);
  assert.doesNotMatch(registration, /NEXT_PUBLIC_API_URL/);
  const transport = read('src/lib/backend-transport.ts');
  assert.match(transport, /https:\/\/api\.agentdomain\.app\/api\/v1/);
  const solutions = read('src/lib/solution-pages.ts');
  assert.doesNotMatch(solutions, /https:\/\/agentdomain\.app\/api\/v1/);
  assert.doesNotMatch(solutions, /x-api-key/i);
  assert.doesNotMatch(solutions, /agents\/quote[\s\S]{0,160}method:\s*'POST'/);
  assert.match(solutions, /authorization:\s*'Bearer '\s*\+/);
  const dashboard = read('src/components/dashboard/dashboard-client.tsx');
  assert.doesNotMatch(dashboard, /docs\.agentdomain\.app#(?:api|stacks)/);
  assert.match(dashboard, /docs\.agentdomain\.app\/api-reference\/overview\//);
  assert.match(dashboard, /docs\.agentdomain\.app\/sdk\/typescript\//);
  const email = read('src/components/agents/email-management.tsx');
  assert.match(email, /sync: 'false'/);
  assert.match(email, /inboxStatus\.verificationStatus/);
  assert.doesNotMatch(
    `${transport}\n${read('src/lib/backend-contracts.ts')}\n${email}`,
    /sesVerificationStatus|sesIdentity|processSes/i,
  );
});

test('public source contains no administration or private edge-auth implementation', () => {
  const source = sourceFiles(resolve(root, 'src'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    source,
    /\/api\/v1\/admin|Admin Console|timingSafeEqual|subtle\.sign|x-agentdomain|FRONTEND_[A-Z_]*SECRET|EDGE_[A-Z_]*SECRET/,
  );
});

test('public data failures stay route-specific and expose only bounded references', () => {
  const component = read('src/components/public-data-error.tsx');
  assert.match(read('src/app/error.tsx'), /PublicDataError/);
  assert.match(read('src/app/registry/error.tsx'), /Registry temporarily unavailable/);
  assert.match(read('src/app/agents/[id]/error.tsx'), /Identity temporarily unavailable/);
  assert.match(component, /error\.digest/);
  assert.doesNotMatch(component, /error\.message|error\.stack/);

  const sitemap = read('src/app/sitemap-agents.xml/route.ts');
  assert.match(sitemap, /X-Request-Reference/);
  assert.match(sitemap, /no-store, max-age=0/);
  assert.doesNotMatch(sitemap, /error\.(?:message|stack|cause)/);
});

test('docs links are canonical and the frontend sitemap cannot publish the retired page', () => {
  const source = sourceFiles(resolve(root, 'src'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.match(source, /https:\/\/docs\.agentdomain\.app/);
  assert.doesNotMatch(source, /(?:href|path):?\s*[={]?['"]\/docs(?:['"#])/);
  assert.doesNotMatch(read('src/lib/seo.ts'), /['"]\/docs['"]/);
});

test('frontend env template is blank, reviewed and local values stay ignored', () => {
  assert.equal(existsSync(resolve(root, 'frontend.env')), false);
  assert.equal(
    readRepository('frontend.env.example').replaceAll('\r\n', '\n'),
    [
      'FRONTEND_PUBLIC_API_URL=',
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY=',
      '',
    ].join('\n'),
  );
  const ignore = readRepository('.gitignore');
  assert.match(ignore, /^frontend\.env$/m);
  assert.match(ignore, /^!frontend\.env\.example$/m);
});
