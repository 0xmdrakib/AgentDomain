import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AgentDomain } from '../dist/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const agentId = '22222222-2222-4222-8222-222222222222';
const requestId = '11111111-1111-4111-8111-111111111111';
const ad = () => new AgentDomain({ apiUrl: 'https://api.example.test/api/v1', apiKey: 'fixture' });
const address = {
  id: 'alias-fixture',
  agentId,
  emailAddress: 'billing@example.test',
  kind: 'alias',
  status: 'active',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
};
const change = (action, phase = 'pending') => ({
  requestId,
  action,
  target: address.emailAddress,
  phase,
});
const response = (value, status = 200) => Response.json(value, { status });
const actions = [
  {
    action: 'primary-rename',
    method: 'PATCH',
    invoke: (client, options) => client.updatePrimaryEmail(agentId, 'billing', options),
    legacy: { inbox: {}, addresses: [address], message: 'Updated' },
    status: 200,
  },
  {
    action: 'alias-create',
    method: 'POST',
    invoke: (client, options) => client.createEmailAlias(agentId, 'billing', options),
    legacy: { address, addresses: [address] },
    status: 201,
  },
  {
    action: 'alias-delete',
    method: 'DELETE',
    invoke: (client, options) => client.deleteEmailAlias(agentId, address.emailAddress, options),
    legacy: { deleted: true, addresses: [] },
    status: 200,
  },
];

for (const item of actions) {
  test(`${item.action}: retained completed response and async phase remain distinct`, async () => {
    globalThis.fetch = async () => response(item.legacy, item.status);
    assert.deepEqual(await item.invoke(ad()), item.legacy);
    for (const phase of [
      'pending',
      'fenced',
      'applying',
      'native_applied',
      'projected',
      'uncertain',
      'rejected',
      'cancelled',
      'completed',
    ]) {
      const result = { change: change(item.action, phase) };
      globalThis.fetch = async (_url, init) => {
        assert.equal(init.method, item.method);
        assert.equal(new Headers(init.headers).get('Idempotency-Key'), requestId);
        return response(result, phase === 'completed' ? 200 : 202);
      };
      assert.deepEqual(await item.invoke(ad(), { idempotencyKey: requestId }), result);
    }
  });

  test(`${item.action}: malformed or contradictory async success is rejected`, async () => {
    for (const [value, status] of [
      [{}, 202],
      [{ change: {} }, 202],
      [{ change: change(item.action, 'completed') }, 202],
      [{ change: change(item.action, 'projected') }, 200],
      [
        { change: { ...change(item.action), requestId: '33333333-3333-4333-8333-333333333333' } },
        202,
      ],
      [{ change: { ...change(item.action), action: 'unknown-action' } }, 202],
    ]) {
      globalThis.fetch = async () => response(value, status);
      await assert.rejects(item.invoke(ad(), { idempotencyKey: requestId }));
    }
  });

  test(`${item.action}: no automatic replay after an unknown response; explicit retry preserves UUID`, async () => {
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(new Headers(init.headers).get('Idempotency-Key'));
      if (requests.length === 1) throw new TypeError('Synthetic connection lost');
      return response({ change: change(item.action) }, 202);
    };
    const client = ad();
    await assert.rejects(item.invoke(client, { idempotencyKey: requestId }), /connection lost/);
    assert.equal(requests.length, 1);
    await item.invoke(client, { idempotencyKey: requestId });
    assert.deepEqual(requests, [requestId, requestId]);
  });

  test(`${item.action}: invalid UUID never reaches fetch and backend errors remain failures`, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return response(item.legacy, item.status);
    };
    await assert.rejects(item.invoke(ad(), { idempotencyKey: 'not-a-uuid' }));
    assert.equal(calls, 0);
    for (const status of [409, 503]) {
      globalThis.fetch = async () => response({ message: 'Address change unavailable' }, status);
      await assert.rejects(item.invoke(ad()), /Address change unavailable/);
    }
  });

  test(`${item.action}: UUID casing preserves the same logical request`, async () => {
    const uppercase = 'ABCDEFAB-1234-4123-8123-ABCDEFABCDEF';
    const canonical = uppercase.toLowerCase();
    globalThis.fetch = async (_input, init) => {
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), canonical);
      return response({ change: { ...change(item.action), requestId: canonical } }, 202);
    };
    const result = await item.invoke(ad(), { idempotencyKey: uppercase });
    assert.equal(result.change.requestId, canonical);
  });
}

test('listEmail preserves pending status, validates new fields, and sends explicit sync choice', async () => {
  const value = {
    inbox: {},
    messages: [],
    addressChange: change('alias-create'),
    mailStatus: { state: 'unchecked' },
  };
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).searchParams.get('sync'), 'false');
    return response(value);
  };
  assert.deepEqual(await ad().listEmail(agentId, { sync: false }), value);
  const unavailable = { ...value, addressChange: { phase: 'unavailable' } };
  globalThis.fetch = async () => response(unavailable);
  assert.deepEqual(await ad().listEmail(agentId, { sync: false }), unavailable);
  globalThis.fetch = async () => response({ ...value, addressChange: { phase: 'completed' } });
  await assert.rejects(ad().listEmail(agentId));
  globalThis.fetch = async () => response({ inbox: {}, messages: [] });
  assert.deepEqual(await ad().listEmail(agentId), { inbox: {}, messages: [] });
});

test('getAgentById retains its unrelated response contract', async () => {
  const agent = { id: agentId, domain: 'example.test' };
  globalThis.fetch = async () => response(agent);
  assert.deepEqual(await ad().getAgentById(agentId), agent);
});
