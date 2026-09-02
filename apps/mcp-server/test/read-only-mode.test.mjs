import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const openResources = [];

const readOnlyTools = [
  'check_domain_availability',
  'export_dns_zone',
  'get_agent',
  'get_agent_email_usage',
  'get_dns_capabilities',
  'get_renewal_status',
  'get_service_plan',
  'list_agent_email',
  'list_dns_records',
  'lookup_agent',
  'quote_registration',
  'search_agents',
];

const additiveWriteTools = [
  'create_dns_record',
  'create_email_alias',
  'send_agent_email',
  'send_agent_email_batch',
];

const destructiveWriteTools = [
  'change_dns_records',
  'configure_email_webhook',
  'delete_agent_email',
  'delete_dns_record',
  'delete_email_alias',
  'enable_auto_renew',
  'fund_renewal_vault',
  'import_dns_zone',
  'purchase_service_plan',
  'reconfigure_ssl',
  'register_agent_identity',
  'schedule_service_plan_renewal',
  'set_registry_visibility',
  'update_dns_record',
  'update_primary_email',
  'withdraw_renewal_vault',
];

afterEach(async () => {
  while (openResources.length > 0) {
    await openResources.pop()();
  }
});

function childEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment.AGENTDOMAIN_ENABLE_WRITE_TOOLS;
  delete environment.AGENTDOMAIN_API_KEY;
  delete environment.AGENT_PRIVATE_KEY;
  return { ...environment, ...overrides };
}

async function startApi() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');

    if (request.method === 'GET' && request.url?.startsWith('/api/v1/domains/availability')) {
      response.end(JSON.stringify({ available: true, domain: 'reader.xyz' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/v1/agents/agent-id/email/send') {
      response.end(JSON.stringify({ queued: true, messageId: 'message-id' }));
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

async function startMcp(apiUrl, overrides = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: packageRoot,
    env: childEnvironment({
      AGENTDOMAIN_API_URL: apiUrl,
      AGENTDOMAIN_NETWORK: 'base',
      ...overrides,
    }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'agentdomain-read-only-test', version: '1.0.0' });
  await client.connect(transport);
  openResources.push(() => client.close());
  return client;
}

function toolMap(tools) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

describe('MCP write-tool gate', () => {
  it('keeps default startup read-only even when an ambient API key exists', async () => {
    const { apiUrl, requests } = await startApi();
    const client = await startMcp(apiUrl, { AGENTDOMAIN_API_KEY: 'ambient-test-api-key' });

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), readOnlyTools);

    const blocked = await client.callTool({
      name: 'send_agent_email',
      arguments: {
        agentId: 'agent-id',
        to: 'recipient@example.com',
        subject: 'blocked',
        text: 'This request must never reach the API.',
      },
    });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /Unknown or disabled tool/);
    assert.deepEqual(requests, []);

    const availability = await client.callTool({
      name: 'check_domain_availability',
      arguments: { name: 'reader', tld: 'xyz' },
    });
    assert.equal(availability.isError, undefined);
    assert.deepEqual(requests, ['GET /api/v1/domains/availability?name=reader&tld=xyz']);
  });

  it('advertises and dispatches writes only after the exact explicit opt-in', async () => {
    const { apiUrl, requests } = await startApi();
    const client = await startMcp(apiUrl, {
      AGENTDOMAIN_ENABLE_WRITE_TOOLS: 'true',
      AGENTDOMAIN_API_KEY: 'scoped-test-api-key',
    });

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...readOnlyTools, ...additiveWriteTools, ...destructiveWriteTools].sort(),
    );

    const sent = await client.callTool({
      name: 'send_agent_email',
      arguments: {
        agentId: 'agent-id',
        to: 'recipient@example.com',
        subject: 'allowed',
        text: 'Explicitly enabled test request.',
      },
    });
    assert.equal(sent.isError, undefined);
    assert.deepEqual(requests, ['POST /api/v1/agents/agent-id/email/send']);
  });

  it('accepts exact false as an explicit read-only setting', async () => {
    const { apiUrl, requests } = await startApi();
    const client = await startMcp(apiUrl, { AGENTDOMAIN_ENABLE_WRITE_TOOLS: 'false' });

    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
      readOnlyTools,
    );
    const availability = await client.callTool({
      name: 'check_domain_availability',
      arguments: { name: 'reader', tld: 'xyz' },
    });
    assert.equal(availability.isError, undefined);
    assert.deepEqual(requests, ['GET /api/v1/domains/availability?name=reader&tld=xyz']);
  });

  it('fails startup for malformed opt-in values instead of enabling writes', () => {
    for (const value of ['', 'TRUE', '1', ' true ', 'yes']) {
      const result = spawnSync(process.execPath, ['dist/index.js'], {
        cwd: packageRoot,
        env: childEnvironment({ AGENTDOMAIN_ENABLE_WRITE_TOOLS: value }),
        encoding: 'utf8',
        timeout: 5_000,
      });

      assert.notEqual(result.status, 0, `expected ${JSON.stringify(value)} to fail startup`);
      assert.match(result.stderr, /must be exactly "true" or "false"/);
    }
  });

  it('keeps signing and API credentials out of inline README examples', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const fencedExamples = [...readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
      (match) => match[1],
    );

    assert.ok(fencedExamples.length > 0);
    for (const example of fencedExamples) {
      assert.doesNotMatch(example, /AGENT_PRIVATE_KEY|AGENTDOMAIN_API_KEY/);
    }
  });
});

describe('MCP tool annotations', () => {
  it('publishes complete conservative annotations for every explicitly enabled tool', async () => {
    const { apiUrl } = await startApi();
    const client = await startMcp(apiUrl, { AGENTDOMAIN_ENABLE_WRITE_TOOLS: 'true' });
    const tools = toolMap((await client.listTools()).tools);

    for (const name of readOnlyTools) {
      assert.deepEqual(tools.get(name)?.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }

    for (const name of additiveWriteTools) {
      assert.deepEqual(tools.get(name)?.annotations, {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }

    for (const name of destructiveWriteTools) {
      assert.deepEqual(tools.get(name)?.annotations, {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
  });
});
