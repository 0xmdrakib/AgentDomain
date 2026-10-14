import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AgentDomain } from '../dist/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const apiUrl = 'https://custom.example.test/prefix/api/v1';
const payer = '0x1111111111111111111111111111111111111111';
const signature = `0x${'ab'.repeat(65)}`;
const walletClient = { account: { address: payer }, signTypedData: async () => signature };
const fixture = {
  available: true,
  inbox: {},
  addresses: [],
  address: {
    id: 'alias',
    agentId: 'agent',
    emailAddress: 'alias@example.test',
    kind: 'alias',
    status: 'active',
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  messages: [],
  message: 'Updated',
  deleted: true,
  data: '0x',
  keys: [],
};

// Each reported index.ts sink is covered here; funding's second sink is exercised below.
const flows = [
  [
    'availability',
    (ad, id) => ad.checkAvailability(id, { tld: id }),
    '/domains/availability',
    'GET',
  ],
  ['send', (ad, id) => ad.sendEmail(id, { to: id, subject: id, text: id }), '/email/send', 'POST'],
  ['batch', (ad, id) => ad.sendEmailBatch(id, { messages: [] }), '/email/batch', 'POST'],
  ['webhook', (ad, id) => ad.setEmailWebhook(id, { url: id }), '/email/webhook', 'PUT'],
  ['rename', (ad, id) => ad.updatePrimaryEmail(id, 'alias'), '/email', 'PATCH'],
  ['alias create', (ad, id) => ad.createEmailAlias(id, 'alias'), '/email/aliases', 'POST'],
  ['alias delete', (ad, id) => ad.deleteEmailAlias(id, id), '/email/aliases', 'DELETE'],
  ['list mail', (ad, id) => ad.listEmail(id), '/email', 'GET'],
  ['delete mail', (ad, id) => ad.deleteEmailMessage(id, id), '/email/:id', 'DELETE'],
  [
    'DNS create',
    (ad, id) => ad.createDnsRecord(id, { type: 'A', name: '@', value: id }),
    '/dns',
    'POST',
  ],
  ['DNS update', (ad, id) => ad.updateDnsRecord(id, id, {}), '/dns/:id', 'PATCH'],
  ['DNS delete', (ad, id) => ad.deleteDnsRecord(id, id), '/dns/:id', 'DELETE'],
  ['DNS export', (ad, id) => ad.exportDnsZone(id), '/dns/export', 'GET'],
  ['DNS batch', (ad, id) => ad.previewDnsBatch(id, []), '/dns/batch', 'POST'],
  ['DNS import', (ad, id) => ad.previewDnsImport(id, id), '/dns/import', 'POST'],
  ['fund', (ad, id) => ad.fundRenewalVault(id, '1'), '/renewal/fund', 'POST'],
  ['withdraw', (ad, id) => ad.withdrawFromVault(id, '1'), '/renewal/withdraw', 'POST'],
  ['visibility', (ad, id) => ad.setRegistryVisibility(id, true), '/plan', 'PATCH'],
  [
    'schedule plan',
    (ad, id) => ad.scheduleServicePlanRenewal(id, { plan: 'starter' }),
    '/plan',
    'PATCH',
  ],
  ['agent read', (ad, id) => ad.getAgentById(id), '', 'GET'],
  ['DNS read', (ad, id) => ad.listDnsRecords(id), '/dns', 'GET'],
  ['DNS capabilities', (ad, id) => ad.getDnsCapabilities(id), '/dns/capabilities', 'GET'],
  ['mail usage', (ad, id) => ad.getEmailUsage(id), '/email/usage', 'GET'],
  ['webhook read', (ad, id) => ad.getEmailWebhook(id), '/email/webhook', 'GET'],
  ['webhook rotate', (ad, id) => ad.rotateEmailWebhookSecret(id), '/email/webhook', 'PATCH'],
  ['renewal read', (ad, id) => ad.getRenewalStatus(id), '/renewal/status', 'GET'],
  ['SSL', (ad, id) => ad.reconfigureSsl(id), '/ssl', 'POST'],
  ['plan read', (ad, id) => ad.getServicePlan(id), '/plan', 'GET'],
  [
    'plan purchase',
    (ad, id) => ad.purchaseServicePlan({ agentId: id, plan: 'starter' }),
    '/plan',
    'POST',
  ],
];

for (const [name, invoke, suffix, method] of flows) {
  test(`${name}: untrusted data cannot change the configured origin or escape its path segment`, async () => {
    for (const id of [
      'https://169.254.169.254/latest?x=1#fragment',
      '../../admin',
      '//evil.test\\route',
      '%2e%2e%2fadmin',
      'ordinary-id',
    ]) {
      let calls = 0;
      globalThis.fetch = async (input, init = {}) => {
        calls++;
        const url = new URL(input);
        const encoded = encodeURIComponent(id);
        assert.equal(url.origin, new URL(apiUrl).origin);
        assert.equal(url.hash, '');
        assert.equal(init.method ?? 'GET', method);
        assert.equal(
          url.pathname,
          '/prefix/api/v1' +
            (name === 'availability'
              ? suffix
              : `/agents/${encoded}${suffix.replace(':id', encoded)}`),
        );
        if (name === 'availability') {
          assert.equal(url.searchParams.get('name'), id);
          assert.equal(url.searchParams.get('tld'), id);
        } else {
          assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture');
        }
        if (name === 'alias delete') assert.equal(url.searchParams.get('emailAddress'), id);
        if (name === 'webhook') assert.equal(JSON.parse(init.body).url, id);
        return Response.json(fixture);
      };
      await invoke(
        new AgentDomain({ apiUrl, apiKey: 'fixture', walletClient, builderCode: 'test' }),
        id,
      );
      assert.equal(calls, 1);
    }
  });
}

test('constructor configuration preserves custom prefixes and every documented local HTTP host', async () => {
  for (const base of [
    apiUrl,
    'http://localhost:3000/api/v1',
    'http://127.0.0.1:3000/api/v1',
    'http://[::1]:3000/api/v1',
  ]) {
    const options = { apiUrl: base + '/' };
    const ad = new AgentDomain(options);
    options.apiUrl = 'https://evil.test';
    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).href, `${base}/domains/availability?name=agent&tld=xyz`);
      return Response.json(fixture);
    };
    await ad.checkAvailability('agent', { tld: 'xyz' });
  }
});

test('wallet and key identifiers are encoded without enabling API-key authentication on owner routes', async () => {
  const id = '../../admin?x=1#fragment';
  const ad = new AgentDomain({ apiUrl, apiKey: 'must-not-be-sent' });
  const paths = [`/agents/by-wallet/${encodeURIComponent(id)}`, `/keys/${encodeURIComponent(id)}`];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, apiUrl + paths[calls++]);
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    return Response.json(fixture);
  };
  await ad.getAgentsByWallet(id);
  await ad.revokeApiKey(id);
  assert.equal(calls, 2);
});

test('DNS export scope stays a single query value even for untyped JavaScript callers', async () => {
  const scope = 'user&other=1#fragment';
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('scope'), scope);
    assert.equal(url.searchParams.has('other'), false);
    assert.equal(url.hash, '');
    return new Response('zone');
  };
  assert.equal(await new AgentDomain({ apiUrl }).exportDnsZone('agent', scope), 'zone');
});

test('dot-only agent, message, DNS and registration identifiers are rejected before fetch', async () => {
  globalThis.fetch = () => assert.fail('Dot segments must never reach fetch');
  const ad = new AgentDomain({
    apiUrl,
    apiKey: 'fixture',
    registrationAuth: 'session',
    registrationExpectedPayer: payer,
  });
  for (const id of ['.', '..']) {
    await assert.rejects(ad.getAgentById(id), /dot segments/);
    await assert.rejects(ad.deleteEmailMessage('agent', id), /dot segments/);
    await assert.rejects(ad.deleteDnsRecord('agent', id), /dot segments/);
    await assert.rejects(ad.getRegistration(id), /dot segments/);
  }
});

test('registration read uses the trusted base, encoded ID, payer binding and redirect rejection', async () => {
  const id = 'https://169.254.169.254/metadata?x=1#fragment';
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, new URL(apiUrl).origin);
    assert.equal(url.pathname, `/prefix/api/v1/registrations/${encodeURIComponent(id)}`);
    assert.equal(url.searchParams.get('expectedPayer'), payer);
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    return Response.json({}, { status: 404 });
  };
  const ad = new AgentDomain({
    apiUrl,
    registrationAuth: 'session',
    registrationExpectedPayer: payer,
  });
  await assert.rejects(ad.getRegistration(id), /HTTP 404/);
});

test('funding challenge and signed retry keep the same encoded destination and authorization', async () => {
  const id = '../../admin?x=1';
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${apiUrl}/agents/${encodeURIComponent(id)}/renewal/fund`);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture');
    calls++;
    if (calls === 1)
      return Response.json(
        {
          scheme: 'eip3009',
          chainId: 8453,
          asset: payer,
          payTo: payer,
          maxAmountRequired: '1000000',
          maxTimeoutSeconds: 300,
        },
        { status: 402 },
      );
    const body = JSON.parse(init.body);
    assert.equal(body.amount, '1');
    assert.equal(body.signature, signature);
    assert.equal(body.authorization.value, '1000000');
    assert.equal(body.authorization.to, payer);
    return Response.json(fixture);
  };
  await new AgentDomain({ apiUrl, apiKey: 'fixture', walletClient }).fundRenewalVault(id, '1');
  assert.equal(calls, 2);
});
