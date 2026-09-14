import assert from 'node:assert/strict';
import test from 'node:test';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:8790');
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') {
  throw new Error('Worker smoke tests are loopback-only.');
}

const routes = [
  ['/ai-agent-identity', 'AI Agent Identity'],
  ['/domains-for-ai-agents', 'Domains for AI Agents'],
  ['/onchain-agent-identity', 'Onchain'],
  ['/autonomous-agent-renewals', 'Renewals'],
  ['/email-for-ai-agents', 'Email'],
  ['/dns-for-ai-agents', 'DNS'],
  ['/domain-registration-api', 'Registration'],
  ['/x402-agent-payments', 'x402'],
  ['/integrations/mcp', 'MCP'],
  ['/integrations/coinbase-agentkit', 'AgentKit'],
];

for (const [path, title] of routes) {
  test(`generated Worker serves ${path}, not a cached or soft 404`, async () => {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<h1\b/);
    const pageTitle = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    assert.ok(pageTitle?.toLowerCase().includes(title.toLowerCase()), pageTitle);
    assert.doesNotMatch(html, /<h1[^>]*>Page not found<\/h1>/);
    assert.match(html, /All rights reserved\./);
  });
}

test('unknown solution and integration paths still return real 404 responses', async () => {
  for (const path of ['/not-a-real-solution', '/integrations/not-a-real-integration']) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 404);
  }
});
