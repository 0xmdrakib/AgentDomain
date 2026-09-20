import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AgentDomainActionProvider } from '../dist/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const requestId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const wallet = {
  getAddress: () => '0x1111111111111111111111111111111111111111',
  signMessage: async () => `0x${'11'.repeat(65)}`,
};
for (const [name, action] of [
  ['update_primary_email', 'primary-rename'],
  ['create_email_alias', 'alias-create'],
  ['delete_email_alias', 'alias-delete'],
]) {
  test(`${name} reports the actual async phase without a completion claim`, async () => {
    const provider = new AgentDomainActionProvider({ apiUrl: 'https://api.example.test/api/v1' });
    const tool = provider.getActions().find((entry) => entry.name === name);
    for (const phase of [
      'pending',
      'projected',
      'uncertain',
      'rejected',
      'cancelled',
      'completed',
    ]) {
      const body = { change: { requestId, action, target: 'billing@example.test', phase } };
      globalThis.fetch = async (_input, init) => {
        assert.equal(new Headers(init.headers).get('Idempotency-Key'), requestId);
        return Response.json(body, { status: phase === 'completed' ? 200 : 202 });
      };
      const args = tool.schema.parse({
        agentId,
        username: 'billing',
        emailAddress: 'billing@example.test',
        idempotencyKey: requestId,
      });
      assert.deepEqual(JSON.parse(await tool.invoke(wallet, args)), body);
    }
  });
}
