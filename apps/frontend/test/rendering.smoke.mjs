import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { frontendRoot } from '../scripts/verify-assets.mjs';

const brand = JSON.parse(readFileSync(resolve(frontendRoot, 'src/lib/brand-assets.json'), 'utf8'));
const assetManifest = JSON.parse(
  readFileSync(resolve(frontendRoot, 'brand-assets.manifest.json'), 'utf8'),
);

// Run explicitly against the local frontend with test/fixtures/public-backend.mjs.
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:3108');
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:')
  throw new Error('Smoke tests are loopback-only.');
const id = '00000000-0000-4000-8000-000000000001';

test('public profile SSR uses sanitized DTOs without forwarding request credentials', async () => {
  const response = await fetch(new URL(`/agents/${id}`, origin), {
    headers: { cookie: 'synthetic-session=fixture-only', authorization: 'Bearer fixture-only' },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /example\.test/);
  assert.match(html, /Owner management is private/);
  assert.match(html, /noindex, follow/);
  assert.doesNotMatch(html, /providerIdentity|synthetic-session|fixture-only/);
});

test('registry and sitemap render backend-projected public records', async () => {
  const registry = await fetch(new URL('/registry', origin));
  assert.equal(registry.status, 200);
  assert.match(await registry.text(), /Enterprise/);
  const sitemap = await fetch(new URL('/sitemap-agents.xml', origin));
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /application\/xml/);
  assert.match(await sitemap.text(), new RegExp(id));
});

test('true missing identity returns 404 and API origin cannot execute business handlers', async () => {
  const missing = await fetch(new URL('/agents/00000000-0000-4000-8000-000000000002', origin));
  assert.equal(missing.status, 404);
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await fetch(new URL('/api/v1/agents/register', origin), { method });
    assert.equal(response.status, 404);
  }
});

test('backend outage remains an error instead of an empty registry', async () => {
  const response = await fetch(new URL('/registry?q=upstream-error', origin));
  const body = await response.text();
  assert.doesNotMatch(body, /No agents found/);
  assert.ok(
    response.status >= 500 ||
      body.includes('PublicBackendError') ||
      body.includes('temporarily unavailable'),
  );
});

test('all public page families publish the new share image and correctly typed icons', async () => {
  for (const path of [
    '/',
    '/register',
    '/registry',
    '/ai-agent-identity',
    '/privacy',
    '/terms',
    '/dashboard',
    `/agents/${id}`,
  ]) {
    const response = await fetch(new URL(path, origin), {
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(
      head.includes(
        `property="og:image" content="https://agentdomain.app${brand.assets.socialCard}"`,
      ),
      path,
    );
    assert.ok(
      head.includes(
        `name="twitter:image" content="https://agentdomain.app${brand.assets.socialCard}"`,
      ),
      path,
    );
    assert.ok(
      head.includes(`property="og:image:width" content="${brand.socialImage.width}"`),
      path,
    );
    assert.ok(
      head.includes(`property="og:image:height" content="${brand.socialImage.height}"`),
      path,
    );
    assert.ok(head.includes(`href="${brand.assets.favicon}"`), path);
    assert.ok(head.includes('sizes="96x96"'), path);
    assert.ok(head.includes(`href="${brand.assets.appleTouchIcon}"`), path);
    assert.doesNotMatch(
      head,
      /image\/x-icon|\/brand\/(?:brand-mark|social-card|app-icon-256|apple-touch-icon)\.png/,
    );
  }
});

test('docs redirects preserve paths on the canonical docs origin', async () => {
  for (const [path, destination] of [
    ['/docs', 'https://docs.agentdomain.app/'],
    ['/docs/guides/email', 'https://docs.agentdomain.app/guides/email'],
  ]) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' });
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get('location'), destination, path);
  }
});

test('all 41 supplied images are served byte-for-byte and legacy URLs redirect to their replacements', async () => {
  const images = Object.keys(assetManifest.files).filter((file) =>
    file.startsWith('public/brand/agentdomain-brand/'),
  );
  assert.equal(images.length, 41);
  for (const file of images) {
    const response = await fetch(new URL(file.slice('public'.length), origin));
    assert.equal(response.status, 200, file);
    assert.match(
      response.headers.get('content-type') ?? '',
      file.endsWith('.svg') ? /image\/svg\+xml/ : /image\/png/,
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      readFileSync(resolve(frontendRoot, file)),
      file,
    );
  }
  for (const [path, asset] of Object.entries(brand.legacyAliases)) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' });
    assert.equal(response.status, 308, path);
    assert.equal(
      new URL(response.headers.get('location'), origin).pathname,
      brand.assets[asset],
      path,
    );
  }
});
