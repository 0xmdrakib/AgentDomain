import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseFrontmatter } from '../scripts/validate-content.mjs';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const primary = 'AgentDomain is the agent-native identity and communications infrastructure.';
const descriptor = 'Programmable identity and communication infrastructure for AI agents.';

test('docs overview and site description include identity and communication without an autonomy-only audience', async () => {
  const overview = parseFrontmatter(
    await read('apps/docs/src/content/docs/index.mdx'),
    'index.mdx',
  );
  assert.equal(overview.description, descriptor);
  assert.ok(
    overview.body
      .trimStart()
      .split('\n')
      .some((line) => line === primary),
  );
  const copy = overview.body.replace(/\s+/g, ' ');
  assert.match(
    copy,
    /Developers can integrate directly through APIs and SDKs, people can guide agents/,
  );
  assert.match(copy, /autonomous workflows can operate within configured permissions/);
  assert.doesNotMatch(copy, /identities for autonomous agents|autonomous identity stack/);
  const config = await read('apps/docs/astro.config.mjs');
  assert.ok(config.includes(`'${descriptor}'`));
});

test('machine-readable introduction and product READMEs preserve the approved category', async () => {
  const llms = await read('apps/docs/public/llms.txt');
  assert.ok(llms.includes(`> ${primary}`));
  assert.match(
    llms.replace(/\s+/g, ' '),
    /developers, people guiding agents, and permissioned autonomous workflows/,
  );
  for (const path of [
    'README.md',
    'AI_DISCLOSURE.md',
    'apps/docs/README.md',
    'apps/frontend/README.md',
    'packages/sdk/README.md',
  ]) {
    assert.ok((await read(path)).includes(primary), path);
  }
});
