import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicBackend,
  PRODUCTION_PUBLIC_API_BASE,
  publicApiBase,
  PublicBackendError,
  PUBLIC_API_TIMEOUT_MS,
} from '../src/lib/backend-transport';
import { publicAgentResponseSchema, managementViewSchema } from '../src/lib/backend-contracts';
import { getRequestHost, normalizeHost } from '../src/lib/custom-domain';

const id = '00000000-0000-4000-8000-000000000001';
const wallet = '0x0000000000000000000000000000000000000001';
const fixture = {
  agent: {
    id,
    domain: 'example.test',
    basename: null,
    ensName: null,
    ownerAddress: wallet,
    agentIdNft: 1,
    status: 'active',
    framework: null,
    sslStatus: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    displayName: 'Example',
    description: null,
    capabilities: [],
  },
  seo: { description: null, canonical: `https://agentdomain.app/agents/${id}`, indexable: false },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('production server reads use only the exact credential-free public API origin', async () => {
  let calls = 0;
  const backend = createPublicBackend(undefined, 'production', async (url, options) => {
    calls++;
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://api.agentdomain.app');
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'manual');
    return json({ items: [], total: 0, hasMore: false });
  });
  await backend.registry({ q: 'exact + query', limit: 12, offset: 0 });
  assert.equal(calls, 1);
  assert.equal(PRODUCTION_PUBLIC_API_BASE, 'https://api.agentdomain.app/api/v1');
});

test('public base is fixed, credential-free and HTTPS except local development', () => {
  assert.throws(
    () => publicApiBase('not-a-url-with-private-input', 'production'),
    (error: unknown) => error instanceof Error && !error.message.includes('private-input'),
  );
  for (const value of [
    'http://api.test/api/v1',
    'https://user:pass@api.test/api/v1',
    'https://api.test/api/v1?token=a',
    'https://api.test/api/v1#x',
    'https://api.test/other',
  ])
    assert.throws(() => publicApiBase(value, 'production'));
  assert.equal(publicApiBase(undefined, 'production').href, 'https://api.agentdomain.app/api/v1/');
  assert.throws(() => publicApiBase('https://api.test/api/v1', 'production'));
  assert.equal(
    publicApiBase('https://api.test/api/v1', 'development').href,
    'https://api.test/api/v1/',
  );
  assert.equal(publicApiBase('http://127.0.0.1:3909/api/v1', 'development').port, '3909');
  assert.throws(() => publicApiBase('http://127.0.0.1:3909/api/v1', 'production'));
});

test('public reads use only fixed routes, no credentials, redirects, cache or retries', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return json(fixture);
  };
  const backend = createPublicBackend('https://api.test/api/v1', 'development', fetcher);
  assert.deepEqual(await backend.agent(id), fixture);
  await backend.domain('attacker.test/?redirect=https://evil.test');
  assert.equal(calls[0].url, `https://api.test/api/v1/public/agents/${id}`);
  assert.equal(new URL(calls[1].url).origin, 'https://api.test');
  for (const { options } of calls) {
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'manual');
    assert.equal(options?.cache, 'no-store');
    assert.ok(options?.signal);
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
  }
  assert.equal(PUBLIC_API_TIMEOUT_MS, 10_000);
});

test('only genuine public 404 becomes not-found; failures never become empty data', async () => {
  assert.equal(
    await createPublicBackend('https://api.test/api/v1', 'development', async () =>
      json({}, 404),
    ).agent(id),
    null,
  );
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(
      createPublicBackend('https://api.test/api/v1', 'development', async () =>
        json({}, status),
      ).agent(id),
      (error: unknown) => error instanceof PublicBackendError && error.status === status,
    );
  }
  let calls = 0;
  await assert.rejects(
    createPublicBackend('https://api.test/api/v1', 'development', async () => {
      calls++;
      throw new Error('upstream credential detail');
    }).agent(id),
    /temporarily unavailable/,
  );
  assert.equal(calls, 1);
});

test('redirect responses fail closed without a second request or exposing the destination', async () => {
  const events: unknown[] = [];
  let calls = 0;
  await assert.rejects(
    createPublicBackend(
      'https://api.test/api/v1',
      'development',
      async () => {
        calls++;
        return new Response(null, {
          status: 307,
          headers: { Location: 'https://private-provider.test/customer-id' },
        });
      },
      (event) => events.push(event),
    ).registry({ limit: 12, offset: 0 }),
    (error: unknown) =>
      error instanceof PublicBackendError && error.stage === 'redirect' && error.status === 307,
  );
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(events).includes('private-provider'), false);
  assert.deepEqual(Object.keys(events[0] as object).sort(), [
    'event',
    'operation',
    'reference',
    'stage',
    'status',
  ]);
});

test('failure telemetry is bounded, correlated and never contains request or provider details', async () => {
  const events: unknown[] = [];
  const secret = 'provider-secret-customer-id-00000000-0000-4000-8000-000000000001';
  let thrown: unknown;
  try {
    await createPublicBackend(
      'https://api.test/api/v1',
      'development',
      async () => {
        throw new Error(secret);
      },
      (event) => events.push(event),
    ).registry({ q: secret, limit: 12, offset: 0 });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof PublicBackendError);
  assert.match(thrown.reference, /^AD-[A-F0-9]{8}$/);
  assert.equal(thrown.operation, 'registry');
  assert.equal(thrown.stage, 'transport');
  assert.deepEqual(events, [
    {
      event: 'frontend.public_backend_failure',
      operation: 'registry',
      stage: 'transport',
      status: 503,
      reference: thrown.reference,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /provider-secret|customer-id|00000000/);
});

test('telemetry reporter failures cannot replace the sanitized backend error', async () => {
  await assert.rejects(
    createPublicBackend(
      'https://api.test/api/v1',
      'development',
      async () => new Response('<html>private provider response</html>'),
      () => {
        throw new Error('telemetry transport detail');
      },
    ).agent(id),
    (error: unknown) =>
      error instanceof PublicBackendError &&
      error.stage === 'content_type' &&
      !error.message.includes('provider response') &&
      !error.message.includes('telemetry transport'),
  );
});

test('malformed DTOs/content types fail closed and internal fields are rejected', async () => {
  assert.equal(
    publicAgentResponseSchema.safeParse({
      ...fixture,
      agent: { ...fixture.agent, metadataJson: { internal: true } },
    }).success,
    false,
  );
  for (const response of [
    json({ agent: {} }),
    new Response('<html>error</html>'),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(
      createPublicBackend('https://api.test/api/v1', 'development', async () => response).agent(id),
      PublicBackendError,
    );
  }
  let calls = 0;
  assert.equal(
    await createPublicBackend('https://api.test/api/v1', 'development', async () => {
      calls++;
      return json(fixture);
    }).agent('../private'),
    null,
  );
  assert.equal(calls, 0);
});

test('registry query and sitemap stay public with no local substitutes', async () => {
  let requested = '';
  const backend = createPublicBackend('https://api.test/api/v1', 'development', async (url) => {
    requested = String(url);
    if (requested.endsWith('.xml'))
      return new Response('<urlset/>', { headers: { 'content-type': 'application/xml' } });
    return json({ items: [], total: 0, hasMore: false });
  });
  await backend.registry({ q: 'test', limit: 12, offset: 24 });
  assert.equal(requested, 'https://api.test/api/v1/public/registry?q=test&limit=12&offset=24');
  assert.equal(await backend.sitemap(), '<urlset/>');
  await assert.rejects(
    createPublicBackend('https://api.test/api/v1', 'development', async () =>
      json({}, 404),
    ).sitemap(),
    PublicBackendError,
  );
});

test('management projection rejects provider-only inbox fields and supports shared DNS data', () => {
  const value = {
    agent: { id, walletAddress: wallet, metadataUri: 'ipfs://example' },
    dns: [
      {
        id: 'record',
        type: 'TXT',
        name: '@',
        value: 'example',
        data: { text: 'example' },
        ttl: 3600,
      },
    ],
    inbox: {
      id: 'inbox',
      agentId: id,
      emailAddress: 'agent@example.test',
      verificationStatus: 'Success',
      dkimConfigured: true,
      spfConfigured: true,
      dmarcConfigured: true,
      createdAt: fixture.agent.createdAt,
    },
    publicConfig: {
      usdc: wallet,
      renewalVault: null,
      metadataGateway: 'https://gateway.lighthouse.storage/ipfs',
      builderCode: null,
    },
  };
  assert.equal(managementViewSchema.safeParse(value).success, true);
  assert.equal(
    managementViewSchema.safeParse({
      ...value,
      inbox: { ...value.inbox, providerIdentity: 'private-provider-id' },
    }).success,
    false,
  );
});

test('custom-domain selection trusts only the standard request Host header', () => {
  const headers = new Headers({
    host: 'example.test',
    'x-forwarded-host': 'ignored.test',
  });
  assert.equal(getRequestHost(headers), 'example.test');
  for (const host of ['evil.test/path', 'user@evil.test', 'evil.test,other.test', 'evil.test?x=1'])
    assert.equal(normalizeHost(host), null);
});
