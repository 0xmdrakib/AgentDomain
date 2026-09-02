import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  DOCS_ROOT,
  EXPECTED_DOCS,
  findForbiddenMatches,
  parseFrontmatter,
  parseJsonc,
  routeForDoc,
  validateDocs,
  validateInternalLinks,
} from '../scripts/validate-content.mjs';
import { validateHtmlUrls } from '../scripts/validate-output.mjs';

test('the complete public docs contract validates', async () => {
  const result = await validateDocs();
  assert.deepEqual(result, { files: 20, routes: 20, approvedAssets: 4 });
});

test('forbidden infrastructure and operator details are detected', () => {
  assert.deepEqual(findForbiddenMatches('DynamoDB and /api/v1/admin/agents'), [
    'private admin route',
    'obsolete or internal provider',
  ]);
  assert.deepEqual(findForbiddenMatches('DATABASE_URL and process.env'), [
    'backend environment variable',
    'runtime environment access',
  ]);
  assert.deepEqual(findForbiddenMatches('Private planning and internal topology'), [
    'internal planning or topology narrative',
  ]);
});

test('frontmatter requires a useful description and no duplicate H1', () => {
  assert.throws(
    () => parseFrontmatter('---\ntitle: Bad\ndescription: short\n---\n', 'bad.mdx'),
    /at least 20 characters/,
  );
  assert.throws(
    () =>
      parseFrontmatter(
        '---\ntitle: Bad\ndescription: This description is long enough.\n---\n# Duplicate\n',
        'bad.mdx',
      ),
    /duplicate H1/,
  );
});

test('internal links resolve only to published routes', () => {
  const routes = new Set(EXPECTED_DOCS.map(routeForDoc));
  assert.doesNotThrow(() => validateInternalLinks('[Start](/quickstart/)', 'ok.mdx', routes));
  assert.throws(
    () => validateInternalLinks('[Private](/operations/)', 'bad.mdx', routes),
    /has no page/,
  );
  assert.throws(
    () => validateInternalLinks('[Relative](..\/private)', 'bad.mdx', routes),
    /root-relative/,
  );
});

test('built HTML requires an exact canonical origin and local brand assets', () => {
  const canonical = (href) => `<link rel="canonical" href="${href}">`;

  assert.doesNotThrow(() =>
    validateHtmlUrls(
      canonical('https://docs.agentdomain.app/quickstart/'),
      'quickstart/index.html',
    ),
  );
  assert.throws(
    () =>
      validateHtmlUrls(
        canonical('https://docs.agentdomain.app.evil.example/quickstart/'),
        'quickstart/index.html',
      ),
    /canonical docs URL is invalid/,
  );
  assert.throws(
    () =>
      validateHtmlUrls(
        `${canonical('https://docs.agentdomain.app/')}<img src="https://agentdomain.app/brand/logo.png">`,
        'index.html',
      ),
    /remote frontend brand dependency is forbidden/,
  );
  assert.throws(
    () =>
      validateHtmlUrls(
        canonical('https://attacker@docs.agentdomain.app/quickstart/'),
        'quickstart/index.html',
      ),
    /credential-free HTTPS URLs/,
  );
});

test('Cloudflare configuration is static-only and pinned', async () => {
  const configFile = join(DOCS_ROOT, 'wrangler.jsonc');
  const config = parseJsonc(await readFile(configFile, 'utf8'), configFile);
  assert.equal(config.name, 'agentdomain-docs');
  assert.equal(config.compatibility_date, '2026-09-01');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.observability.enabled, true);
  assert.equal(config.main, undefined);
  assert.deepEqual(config.routes, [{ pattern: 'docs.agentdomain.app', custom_domain: true }]);
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.deepEqual(config.env.preview, {
    name: 'agentdomain-docs-preview',
    workers_dev: false,
    preview_urls: false,
    routes: [],
  });
});

test('docs CSP enables only the WebAssembly and worker capabilities required by Pagefind', async () => {
  const headers = await readFile(join(DOCS_ROOT, 'public', '_headers'), 'utf8');
  assert.match(headers, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
  assert.match(headers, /worker-src 'self' blob:/);
  assert.doesNotMatch(headers, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/m);
});

test('package cannot be published to npm', async () => {
  const pkg = JSON.parse(await readFile(join(DOCS_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.repository.url, 'https://github.com/0xmdrakib/AgentDomain.git');
});

test('unreleased framework integrations remain code-free coming-soon placeholders', async () => {
  for (const framework of ['langchain', 'crewai']) {
    const source = await readFile(
      join(DOCS_ROOT, 'src', 'content', 'docs', 'frameworks', `${framework}.mdx`),
      'utf8',
    );
    assert.match(source, /## Coming soon/);
    assert.match(source, /has not been released/);
    assert.doesNotMatch(source, /```|npm\s+(?:install|add)|@agentdomain\/|\bimport\s+/);
  }

  const docsConfig = await readFile(join(DOCS_ROOT, 'astro.config.mjs'), 'utf8');
  assert.match(docsConfig, /label: 'LangChain \(Coming soon\)'/);
  assert.match(docsConfig, /label: 'CrewAI \(Coming soon\)'/);

  const sharedConstants = await readFile(
    join(DOCS_ROOT, '..', '..', 'packages', 'shared', 'src', 'constants.ts'),
    'utf8',
  );
  assert.doesNotMatch(sharedConstants, /['"](?:langchain|crewai)['"]/);
});
