import { publicAgentResponseSchema, publicRegistrySchema } from './backend-contracts';
import { API_TIMEOUT_MS } from './transport-policy';

export const PUBLIC_API_TIMEOUT_MS = API_TIMEOUT_MS;
export const PRODUCTION_PUBLIC_API_BASE = 'https://api.agentdomain.app/api/v1';

export class PublicBackendError extends Error {
  constructor(public readonly status: number) {
    super('Public identity data is temporarily unavailable.');
    this.name = 'PublicBackendError';
  }
}

export function publicApiBase(value: string | undefined, runtime: string | undefined): URL {
  const configured = value || PRODUCTION_PUBLIC_API_BASE;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('FRONTEND_PUBLIC_API_URL must be a valid HTTPS /api/v1 URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(runtime !== 'production' && loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, '') !== '/api/v1'
  )
    throw new Error('FRONTEND_PUBLIC_API_URL must be a credential-free HTTPS /api/v1 URL.');
  url.pathname = '/api/v1/';
  if (runtime === 'production' && url.href !== `${PRODUCTION_PUBLIC_API_BASE}/`) {
    throw new Error('Production public API base must use api.agentdomain.app/api/v1.');
  }
  return url;
}

export function createPublicBackend(
  value: string | undefined,
  runtime = 'production',
  fetcher = fetch,
) {
  // Only fixed public endpoint paths enter this transport. Request cookies/headers never do.
  async function request(path: string, query?: URLSearchParams): Promise<Response> {
    const base = publicApiBase(value, runtime);
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/v1/public/')) {
      throw new Error('Invalid public API endpoint.');
    }
    if (query) url.search = query.toString();
    try {
      const headers = {
        Accept: path.endsWith('.xml') ? 'application/xml' : 'application/json',
      };
      return await fetcher(url, {
        method: 'GET',
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(PUBLIC_API_TIMEOUT_MS),
      });
    } catch {
      throw new PublicBackendError(503);
    }
  }

  async function json(path: string, query?: URLSearchParams, allowNotFound = false) {
    const response = await request(path, query);
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new PublicBackendError(response.status);
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new PublicBackendError(502);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new PublicBackendError(502);
    }
  }

  function parse<T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new PublicBackendError(502);
    return result.data;
  }

  return {
    async agent(id: string) {
      if (!publicAgentResponseSchema.shape.agent.shape.id.safeParse(id).success) return null;
      const value = await json(`public/agents/${encodeURIComponent(id)}`, undefined, true);
      return value === null ? null : parse(publicAgentResponseSchema, value);
    },
    async domain(host: string) {
      const value = await json('public/agents/by-domain', new URLSearchParams({ host }), true);
      return value === null ? null : parse(publicAgentResponseSchema, value);
    },
    async registry(options: {
      q?: string;
      framework?: string;
      capability?: string;
      limit: number;
      offset: number;
    }) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options))
        if (value !== undefined) query.set(key, String(value));
      return parse(publicRegistrySchema, await json('public/registry', query));
    },
    async sitemap() {
      const response = await request('public/sitemap-agents.xml');
      if (!response.ok) throw new PublicBackendError(response.status);
      if (!response.headers.get('content-type')?.includes('application/xml'))
        throw new PublicBackendError(502);
      return response;
    },
  };
}
