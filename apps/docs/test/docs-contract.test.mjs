import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  DOCS_ROOT,
  EXPECTED_DOCS,
  findForbiddenMatches,
  parseFrontmatter,
  routeForDoc,
  validateDocs,
  validateInternalLinks,
} from '../scripts/validate-content.mjs';

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

test('Cloudflare configuration is static-only and pinned', async () => {
  const config = JSON.parse(await readFile(join(DOCS_ROOT, 'wrangler.jsonc'), 'utf8'));
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
    workers_dev: true,
    preview_urls: true,
    routes: [],
  });
});

test('package cannot be published to npm', async () => {
  const pkg = JSON.parse(await readFile(join(DOCS_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.repository.url, 'https://github.com/0xmdrakib/AgentDomain.git');
});
