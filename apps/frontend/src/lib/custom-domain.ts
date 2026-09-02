const PLATFORM_HOSTS = new Set([
  'agentdomain.app',
  'www.agentdomain.app',
  'localhost',
  '127.0.0.1',
  '[::1]',
]);
export const CANONICAL_PLATFORM_HOST = 'agentdomain.app';

export function normalizeHost(value: string | null): string | null {
  if (!value || /[\\/@\s,]/.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function getRequestHost(headers: Pick<Headers, 'get'>): string | null {
  return normalizeHost(headers.get('host'));
}

export function getCustomDomainHost(headers: Pick<Headers, 'get'>): string | null {
  const host = getRequestHost(headers);
  if (!host || PLATFORM_HOSTS.has(host) || /\.(workers\.dev|localhost)$/.test(host)) return null;
  return host;
}

export function isPlatformAlias(host: string | null): boolean {
  return host === 'www.agentdomain.app';
}
