import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  updatePrimaryEmailAction,
  createEmailAliasAction,
  deleteEmailAliasAction,
} from '../dist/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const agentId = '22222222-2222-4222-8222-222222222222';
const requestId = '11111111-1111-4111-8111-111111111111';
const settings = {
  AGENTDOMAIN_API_URL: 'https://api.example.test/api/v1',
  AGENTDOMAIN_API_KEY: 'fixture',
};
const runtime = { getSetting: (name) => settings[name] };
for (const [tool, action] of [
  [updatePrimaryEmailAction, 'primary-rename'],
  [createEmailAliasAction, 'alias-create'],
  [deleteEmailAliasAction, 'alias-delete'],
]) {
  test(`${action} keeps pending/review states distinct from completed actions`, async () => {
    for (const phase of [
      'pending',
      'projected',
      'uncertain',
      'rejected',
      'cancelled',
      'completed',
    ]) {
      const body = { change: { requestId, action, target: 'billing@example.test', phase } };
      globalThis.fetch = async () =>
        Response.json(body, { status: phase === 'completed' ? 200 : 202 });
      const result = await tool.handler(runtime, {
        content: { text: `agentId: ${agentId} username: billing email: billing@example.test` },
      });
      assert.deepEqual(result.data, body);
      assert.ok(result.text.includes(phase));
      assert.ok(result.text.includes(requestId));
      assert.doesNotMatch(result.text, /Created email alias|Deleted email alias/);
    }
  });
}
