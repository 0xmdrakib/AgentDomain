import { publicAgentResponseSchema, publicRegistrySchema } from './backend-contracts';
import { API_TIMEOUT_MS } from './transport-policy';

export const PUBLIC_API_TIMEOUT_MS = API_TIMEOUT_MS;
export const PRODUCTION_PUBLIC_API_BASE = 'https://api.agentdomain.app/api/v1';

export type PublicBackendOperation = 'agent' | 'domain' | 'registry' | 'sitemap';
export type PublicBackendFailureStage =
  'transport' | 'redirect' | 'upstream_status' | 'content_type' | 'decode' | 'schema';

export interface PublicBackendFailureEvent {
  event: 'frontend.public_backend_failure';
  operation: PublicBackendOperation;
  stage: PublicBackendFailureStage;
  status: number;
  reference: string;
}

export type PublicBackendFailureReporter = (event: PublicBackendFailureEvent) => void;

export class PublicBackendError extends Error {
  constructor(
    public readonly status: number,
    public readonly operation: PublicBackendOperation,
    public readonly stage: PublicBackendFailureStage,
    public readonly reference: string,
  ) {
    super(`Public identity data is temporarily unavailable. Reference: ${reference}`);
    this.name = 'PublicBackendError';
  }
}

function createFailureReference() {
  return `AD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function defaultFailureReporter(event: PublicBackendFailureEvent) {
  console.error(JSON.stringify(event));
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
  reporter: PublicBackendFailureReporter = defaultFailureReporter,
) {
  function fail(
    operation: PublicBackendOperation,
    stage: PublicBackendFailureStage,
    status: number,
  ): never {
    const error = new PublicBackendError(status, operation, stage, createFailureReference());
    try {
      reporter({
        event: 'frontend.public_backend_failure',
        operation,
        stage,
        status,
        reference: error.reference,
      });
    } catch {
      // Observability must never replace the sanitized application failure.
    }
    throw error;
  }

  // Only fixed public endpoint paths enter this transport. Request cookies/headers never do.
  async function request(
    operation: PublicBackendOperation,
    path: string,
    query?: URLSearchParams,
  ): Promise<Response> {
    const base = publicApiBase(value, runtime);
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/v1/public/')) {
      throw new Error('Invalid public API endpoint.');
    }
    if (query) url.search = query.toString();
    const headers = {
      Accept: path.endsWith('.xml') ? 'application/xml' : 'application/json',
    };
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(PUBLIC_API_TIMEOUT_MS),
      });
    } catch {
      fail(operation, 'transport', 503);
    }
    if (response.status >= 300 && response.status < 400) {
      fail(operation, 'redirect', response.status);
    }
    return response;
  }

  async function json(
    operation: PublicBackendOperation,
    path: string,
    query?: URLSearchParams,
    allowNotFound = false,
  ) {
    const response = await request(operation, path, query);
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) fail(operation, 'upstream_status', response.status);
    if (!response.headers.get('content-type')?.includes('application/json')) {
      fail(operation, 'content_type', 502);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      fail(operation, 'decode', 502);
    }
  }

  function parse<T>(
    operation: PublicBackendOperation,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) fail(operation, 'schema', 502);
    return result.data;
  }

  return {
    async agent(id: string) {
      if (!publicAgentResponseSchema.shape.agent.shape.id.safeParse(id).success) return null;
      const value = await json('agent', `public/agents/${encodeURIComponent(id)}`, undefined, true);
      return value === null ? null : parse('agent', publicAgentResponseSchema, value);
    },
    async domain(host: string) {
      const value = await json(
        'domain',
        'public/agents/by-domain',
        new URLSearchParams({ host }),
        true,
      );
      return value === null ? null : parse('domain', publicAgentResponseSchema, value);
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
      return parse(
        'registry',
        publicRegistrySchema,
        await json('registry', 'public/registry', query),
      );
    },
    async sitemap() {
      const response = await request('sitemap', 'public/sitemap-agents.xml');
      if (!response.ok) fail('sitemap', 'upstream_status', response.status);
      if (!response.headers.get('content-type')?.includes('application/xml'))
        fail('sitemap', 'content_type', 502);
      try {
        return await response.text();
      } catch {
        fail('sitemap', 'decode', 502);
      }
    },
  };
}
