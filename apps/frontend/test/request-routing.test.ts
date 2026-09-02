import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

function request(path: string, options: { host?: string; method?: string; body?: string } = {}) {
  const method = options.method ?? 'GET';
  return new NextRequest(`https://frontend.test${path}`, {
    method,
    headers: { host: options.host ?? 'agentdomain.app' },
    body: options.body,
  });
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
}

test('GET and HEAD canonical redirects preserve paths and queries', () => {
  for (const [path, host, destination] of [
    ['/docs', 'agentdomain.app', 'https://docs.agentdomain.app/'],
    [
      '/docs/guides/email?ref=public',
      'agentdomain.app',
      'https://docs.agentdomain.app/guides/email?ref=public',
    ],
    ['/api?format=json', 'agentdomain.app', 'https://api.agentdomain.app/api/v1?format=json'],
    ['/', 'api.agentdomain.app', 'https://api.agentdomain.app/api/v1'],
    ['/api/', 'api.agentdomain.app', 'https://api.agentdomain.app/api/v1'],
    ['/registry?page=2', 'www.agentdomain.app', 'https://agentdomain.app/registry?page=2'],
    ['/docs/start', 'www.agentdomain.app', 'https://docs.agentdomain.app/start'],
    [
      '/api/v1/public/registry',
      'www.agentdomain.app',
      'https://api.agentdomain.app/api/v1/public/registry',
    ],
  ] as const) {
    for (const method of ['GET', 'HEAD']) {
      const response = middleware(request(path, { host, method }));
      assert.equal(response.status, 308, `${method} ${host}${path}`);
      assert.equal(response.headers.get('location'), destination, `${method} ${host}${path}`);
    }
  }
});

test('redirect-only routes reject unsafe methods without consuming or replaying bodies', async () => {
  for (const [path, host] of [
    ['/docs/private?next=https://attacker.test', 'agentdomain.app'],
    ['/api?next=https://attacker.test', 'agentdomain.app'],
    ['/anything', 'www.agentdomain.app'],
    ['/', 'api.agentdomain.app'],
  ] as const) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const input = request(path, {
        host,
        method,
        body: method === 'OPTIONS' ? undefined : 'credential=must-not-move',
      });
      const response = middleware(input);
      assert.equal(response.status, 405, `${method} ${host}${path}`);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(response.headers.get('location'), null);
      assertNoStore(response);
      assert.equal(input.bodyUsed, false);
      assert.deepEqual(await response.json(), {
        error: 'METHOD_NOT_ALLOWED',
        message: 'This route accepts GET and HEAD only.',
      });
    }
  }
});

test('frontend-controlled API namespaces return consistent no-store JSON 404s', async () => {
  for (const [path, host] of [
    ['/api/v2', 'agentdomain.app'],
    ['/api/private', 'agentdomain.app'],
    ['/health', 'api.agentdomain.app'],
    ['/api/v1/private', 'agentdomain-frontend-preview.example.workers.dev'],
  ] as const) {
    const response = middleware(request(path, { host }));
    assert.equal(response.status, 404, `${host}${path}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assertNoStore(response);
    assert.deepEqual(await response.json(), {
      error: 'NOT_FOUND',
      message: 'This API route does not exist.',
    });
  }

  const head = middleware(request('/unknown', { host: 'api.agentdomain.app', method: 'HEAD' }));
  assert.equal(head.status, 404);
  assert.equal(await head.text(), '');
  assertNoStore(head);
});

test('known versioned API paths remain available to the dedicated edge route', () => {
  for (const host of ['agentdomain.app', 'api.agentdomain.app']) {
    for (const path of ['/api/v1', '/api/v1/agents/register']) {
      const response = middleware(request(path, { host }));
      assert.equal(response.headers.get('x-middleware-next'), '1', `${host}${path}`);
    }
  }
});

test('fixed canonical destinations never reflect an untrusted Host header', () => {
  const response = middleware(
    request('/api?next=https://attacker.test', { host: 'attacker.test' }),
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://api.agentdomain.app/api/v1?next=https://attacker.test',
  );
});
