import { z } from 'zod';
import { API_TIMEOUT_MS } from './transport-policy';
import { RegistrationReadError, registrationRetryAfterMs } from './registration-progress';

export const NOTICE_PAGE_SIZE = 20;
export const NOTICE_CHANNELS = ['popup', 'dashboard'] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];
export const noticeClientIdSchema = z
  .string()
  .regex(/^\d{13}[.-][0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .transform((id) => id.toLowerCase().replace('.', '-'));
const registrationId = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
export const isNoticeRegistrationId = (id: string) => registrationId.safeParse(id).success;
const walletSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .transform((s) => s.toLowerCase());
const noticeId = z
  .string()
  .refine((id) =>
    id.startsWith('registration:')
      ? registrationId.safeParse(id.slice(13)).success
      : id.startsWith('client:') && noticeClientIdSchema.safeParse(id.slice(7)).success,
  )
  .transform((id) =>
    id.startsWith('client:')
      ? `client:${noticeClientIdSchema.parse(id.slice(7))}`
      : id.toLowerCase(),
  );
const noticeSchema = z
  .object({
    noticeId,
    source: z.enum(['registration', 'client']),
    registrationId: registrationId.nullable(),
    domain: z
      .string()
      .min(3)
      .max(253)
      .regex(/^[a-z0-9.-]+$/i)
      .nullable(),
    channel: z.enum(NOTICE_CHANNELS),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    status: z.enum(['registration', 'submission_unknown']),
    statusUrl: z.string().nullable(),
  })
  .superRefine((item, ctx) => {
    if (
      !item.noticeId.startsWith(`${item.source}:`) ||
      (item.source === 'registration' && item.noticeId !== `registration:${item.registrationId}`) ||
      (item.registrationId === null) !== (item.status === 'submission_unknown') ||
      (item.registrationId === null) !== (item.statusUrl === null) ||
      Date.parse(item.expiresAt) <= Date.parse(item.createdAt)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid notice identity' });
    }
  });
export type RegistrationNotice = z.infer<typeof noticeSchema>;
const pageSchema = z.object({
  items: z.array(noticeSchema).max(NOTICE_PAGE_SIZE),
  nextCursor: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export type RegistrationNoticePage = z.infer<typeof pageSchema>;

function verifyItems(items: RegistrationNotice[], wallet: string, channel?: NoticeChannel) {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.channel}:${item.noticeId}`;
    if (seen.has(key) || (channel && item.channel !== channel))
      throw new RegistrationReadError('unavailable');
    seen.add(key);
    if (item.statusUrl !== null) {
      const expected = `/api/v1/registrations/${item.registrationId}`;
      const url = new URL(item.statusUrl, 'https://notice.invalid');
      if (
        !item.statusUrl.startsWith(`${expected}?`) ||
        url.origin !== 'https://notice.invalid' ||
        url.pathname !== expected ||
        url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.get('expectedPayer')?.toLowerCase() !== wallet
      )
        throw new RegistrationReadError('unauthorized');
    }
  }
  return items;
}

/** Notice endpoints share the authenticated progress contract, including on mutations. */
export class RegistrationNoticesClient {
  constructor(private fetcher: typeof fetch = fetch) {}

  private async request(
    wallet: string,
    path: string,
    signal?: AbortSignal,
    method?: 'POST' | 'PUT' | 'DELETE',
    body?: object,
  ) {
    wallet = walletSchema.parse(wallet);
    const url = new URL(path, 'https://notice.invalid');
    url.searchParams.set('expectedPayer', wallet);
    const response = await this.fetcher(`${url.pathname}${url.search}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)])
        : AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 || response.status === 403)
      throw new RegistrationReadError('unauthorized', response.status);
    if (!response.ok)
      throw new RegistrationReadError(
        'unavailable',
        response.status,
        registrationRetryAfterMs(
          response.headers.get('retry-after'),
          Date.now(),
          response.headers.get('date'),
        ),
      );
    if (response.headers.get('x-authenticated-wallet')?.toLowerCase() !== wallet)
      throw new RegistrationReadError('unauthorized');
    return response;
  }

  async list(wallet: string, channel: NoticeChannel, cursor: string | null, signal?: AbortSignal) {
    const query = new URLSearchParams({ channel, limit: String(NOTICE_PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);
    const response = await this.request(wallet, `/api/v1/registration-notices?${query}`, signal);
    const page = pageSchema.parse(await response.json());
    verifyItems(page.items, wallet.toLowerCase(), channel);
    return page;
  }

  async create(wallet: string, id: string, clientId?: string, signal?: AbortSignal) {
    const body = {
      registrationId: registrationId.parse(id),
      ...(clientId ? { clientId: noticeClientIdSchema.parse(clientId) } : {}),
    };
    const response = await this.request(
      wallet,
      '/api/v1/registration-notices',
      signal,
      'POST',
      body,
    );
    return verifyItems(
      z.object({ items: z.array(noticeSchema) }).parse(await response.json()).items,
      wallet.toLowerCase(),
    );
  }

  async submission(wallet: string, clientId: string, domain: string, signal?: AbortSignal) {
    // The backend route exports PUT on the collection, not a /submissions route.
    const response = await this.request(wallet, '/api/v1/registration-notices', signal, 'PUT', {
      clientId: noticeClientIdSchema.parse(clientId),
      domain,
    });
    return verifyItems(
      z.object({ items: z.array(noticeSchema) }).parse(await response.json()).items,
      wallet.toLowerCase(),
    );
  }

  async dismiss(wallet: string, id: string, channel: NoticeChannel, signal?: AbortSignal) {
    const path = `/api/v1/registration-notices/${encodeURIComponent(noticeId.parse(id))}?channel=${channel}`;
    const response = await this.request(wallet, path, signal, 'DELETE');
    if (response.status !== 204) throw new RegistrationReadError('unavailable');
  }
}

export function noticeIsCurrent(notice: RegistrationNotice, now = Date.now()) {
  return Date.parse(notice.createdAt) <= now && Date.parse(notice.expiresAt) > now;
}
