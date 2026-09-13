import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { scripts, dependencies } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('standalone Astro and machine-docs commands build the public schema first', () => {
  assert.equal(dependencies['@agentdomain/shared'], 'workspace:*');
  assert.equal(scripts['build:dependencies'], 'pnpm --filter @agentdomain/shared build');
  for (const command of ['dev', 'build', 'typecheck', 'test', 'validate:output']) {
    assert.ok(
      scripts[command].startsWith('pnpm run build:dependencies && '),
      `${command} must not depend on another workspace task having built shared`,
    );
  }
});

test('production and preview entrypoints retain validation and release gates', () => {
  assert.equal(
    scripts['build:cloudflare:production'],
    'node ../../scripts/seo/indexnow.mjs verify --site=docs --production && pnpm run check',
  );
  assert.equal(
    scripts.check,
    'pnpm run validate:content && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run validate:output',
  );
  assert.match(scripts.preview, /^pnpm run build && wrangler dev --env preview$/);
  assert.match(scripts.deploy, /^pnpm run check && /);
});
