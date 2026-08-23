import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseBuilderCodeAttribution } from '@agentdomain/sdk';

const builderCode = 'agentdomain_mcp_test';
const vaultAddress = '0x2222222222222222222222222222222222222222';
const openResources = [];

afterEach(async () => {
  while (openResources.length > 0) {
    await openResources.pop()();
  }
});

async function startApi() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');

    if (request.method === 'GET' && request.url?.startsWith('/api/v1/domains/availability')) {
      response.end(JSON.stringify({ available: true, domain: 'reader.xyz' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/v1/agents/agent-id/renewal/withdraw') {
      response.end(
        JSON.stringify({
          chainId: 8453,
          to: vaultAddress,
          data: '0x1234',
          value: '0',
          functionName: 'withdraw',
          args: { tokenId: '42', amount: '1000000' },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  openResources.push(() => new Promise((resolve) => server.close(resolve)));
  return { apiUrl: `http://127.0.0.1:${address.port}/api/v1`, requests };
}

async function startMcp(apiUrl, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      AGENTDOMAIN_API_URL: apiUrl,
      AGENTDOMAIN_NETWORK: 'base',
      ...env,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'agentdomain-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  openResources.push(async () => {
    await client.close();
  });
  return client;
}

function parseToolJson(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

describe('MCP Builder Code configuration', () => {
  it('keeps read tools available and fails clearly only when a direct Base write needs config', async () => {
    const { apiUrl, requests } = await startApi();
    const client = await startMcp(apiUrl, { AGENTDOMAIN_BUILDER_CODE: '' });

    const availability = parseToolJson(
      await client.callTool({
        name: 'check_domain_availability',
        arguments: { name: 'reader', tld: 'xyz' },
      }),
    );
    assert.equal(availability.available, true);

    const withdrawal = await client.callTool({
      name: 'withdraw_renewal_vault',
      arguments: { agentId: 'agent-id', amountUsdc: '1' },
    });
    assert.equal(withdrawal.isError, true);
    assert.match(withdrawal.content[0].text, /AGENTDOMAIN_BUILDER_CODE/);
    assert.deepEqual(requests, ['GET /api/v1/domains/availability?name=reader&tld=xyz']);
  });

  it('propagates configured Builder Code to the SDK direct-write result without live services', async () => {
    const { apiUrl, requests } = await startApi();
    const client = await startMcp(apiUrl, { AGENTDOMAIN_BUILDER_CODE: builderCode });

    const transaction = parseToolJson(
      await client.callTool({
        name: 'withdraw_renewal_vault',
        arguments: { agentId: 'agent-id', amountUsdc: '1' },
      }),
    );

    assert.equal(transaction.to, vaultAddress);
    assert.deepEqual(parseBuilderCodeAttribution(transaction.data), { a: builderCode });
    assert.deepEqual(requests, ['POST /api/v1/agents/agent-id/renewal/withdraw']);
  });
});
