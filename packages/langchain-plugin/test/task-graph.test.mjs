import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('typed LangChain lint builds upstream declarations on a clean checkout', async () => {
  const graph = JSON.parse(await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.lint, 'tsc --noEmit');
  assert.deepEqual(graph.tasks['@agentdomain/langchain-plugin#lint'].dependsOn, [
    '^lint',
    '^build',
  ]);
  assert.ok(graph.tasks.build.dependsOn.includes('^build'));
  assert.deepEqual(graph.tasks.lint.dependsOn, ['^lint']);
});
