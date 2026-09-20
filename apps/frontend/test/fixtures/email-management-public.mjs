// Test-process preload only. The optimized application and its assets are unchanged.
// Only synthetic public DTO reads are substituted; no private service is contacted.
const id = '00000000-0000-4000-8000-000000000001';
export const fixtureAgent = {
  id,
  domain: 'email-review.example.test',
  basename: null,
  ensName: null,
  ownerAddress: '0x' + '1'.repeat(40),
  agentIdNft: 1,
  status: 'active',
  framework: null,
  sslStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  displayName: 'Email review',
  description: 'Synthetic browser fixture',
  capabilities: [],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'https://api.agentdomain.app') {
    if (
      request.method !== 'GET' ||
      request.headers.has('authorization') ||
      request.headers.has('cookie')
    )
      throw new Error('Unexpected private context in public browser fixture');
    if (url.pathname === `/api/v1/public/agents/${id}`)
      return Response.json({
        agent: fixtureAgent,
        seo: {
          description: fixtureAgent.description,
          canonical: `https://agentdomain.app/agents/${id}`,
          indexable: false,
        },
      });
    if (url.pathname === '/api/v1/public/registry')
      return Response.json({ items: [], total: 0, hasMore: false });
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Browser fixture forbids external server fetches');
  return originalFetch(input, init);
};
