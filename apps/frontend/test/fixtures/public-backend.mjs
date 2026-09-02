import { createServer } from 'node:http';

const id = '00000000-0000-4000-8000-000000000001';
const unavailableId = '00000000-0000-4000-8000-000000000003';
const agent = {
  id,
  domain: 'example.test',
  basename: 'example.base.eth',
  ensName: null,
  ownerAddress: '0x0000000000000000000000000000000000000001',
  agentIdNft: 1,
  status: 'active',
  framework: 'OpenAI SDK',
  sslStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  displayName: 'Example Agent',
  description:
    'A synthetic public agent identity used only to verify the isolated frontend rendering contract.',
  capabilities: ['Research', 'Automation'],
};

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const path = url.pathname.replace('/api/v1/public/', '');
  response.setHeader('Content-Type', 'application/json');
  if (request.headers.cookie || request.headers.authorization) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: 'Unexpected private request context' }));
    return;
  }
  if (url.searchParams.get('q') === 'upstream-error') {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'Synthetic upstream failure' }));
    return;
  }
  if (path === `agents/${unavailableId}`) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'Synthetic upstream failure' }));
    return;
  }
  if (path === `agents/${id}` || path === 'agents/by-domain') {
    response.end(
      JSON.stringify({
        agent,
        seo: {
          description: agent.description,
          canonical:
            path === 'agents/by-domain'
              ? 'https://example.test'
              : `https://agentdomain.app/agents/${id}`,
          indexable: false,
        },
      }),
    );
  } else if (path === 'registry') {
    response.end(
      JSON.stringify({
        items: [
          {
            id,
            domain: agent.domain,
            basename: agent.basename,
            ensName: null,
            walletAddress: agent.ownerAddress,
            framework: agent.framework,
            description: agent.description,
            capabilities: agent.capabilities,
            x402Endpoint: null,
            supportTier: 'enterprise',
            createdAt: agent.createdAt,
          },
        ],
        total: 1,
        hasMore: false,
      }),
    );
  } else if (path === 'sitemap-agents.xml') {
    response.setHeader('Content-Type', 'application/xml');
    response.end(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://agentdomain.app/agents/${id}</loc></url></urlset>`,
    );
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  }
});

server.listen(Number(process.argv[2] ?? 3909), '127.0.0.1', () =>
  console.log('Synthetic public DTO fixture ready on loopback.'),
);
