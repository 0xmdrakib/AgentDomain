import {
  ATTEMPT_PREFIX,
  COMPLETION_PREFIX,
  REGISTRATION_NOTICE_PREFIX,
  REGISTRATION_PAGE_SIZE,
  REGISTRATION_LIST_PAGES_PER_POLL,
  REGISTRATION_DETAILS_PER_POLL,
  REGISTRATION_MAX_DISCOVERY_OFFSET,
  REGISTRATION_POLL_MS,
  REGISTRATION_MAX_POLL_MS,
  REGISTRATION_RETRY_JITTER_MS,
  REGISTRATION_BACKOFF_PREFIX,
  type RegistrationAttempt,
  type RegistrationAccepted,
  type RegistrationProgress,
  type RegistrationPaymentRejection,
  registrationAttemptSchema,
  registrationListSchema,
  registrationProgressSchema,
  registrationPath,
  registrationRead,
  readRegistrationSession,
  RegistrationReadError,
  attemptStartedAt,
  matchAttempt,
  isRegistrationTerminal,
  canAdvanceRegistration,
} from './registration-progress';
import {
  readSubmissionReservation,
  releaseUnchargedSubmissionReservation,
  submissionReviewRequired,
  type SubmissionLock,
} from './registration-submission';
import {
  NOTICE_CHANNELS,
  RegistrationNoticesClient,
  noticeClientIdSchema,
  noticeIsCurrent,
  isNoticeRegistrationId,
  type NoticeChannel,
  type RegistrationNotice,
} from './registration-notices';

export type TrackingConnection = 'loading' | 'ready' | 'offline' | 'unauthorized' | 'unavailable';
export interface RegistrationSnapshot {
  wallet: string | null;
  items: RegistrationProgress[];
  attempts: RegistrationAttempt[];
  connection: TrackingConnection;
  hasSavedAttempts: boolean;
  discoveryComplete: boolean;
  discoveryLimited: boolean;
  notices: Record<NoticeChannel, RegistrationNotice[]>;
  noticeConnection: TrackingConnection;
  noticeCursors: Record<NoticeChannel, string | null>;
  noticeNextCursors: Record<NoticeChannel, string | null>;
  noticePending: string[];
  noticeErrors: Partial<Record<NoticeChannel, string>>;
}
export const EMPTY_REGISTRATION_SNAPSHOT: RegistrationSnapshot = {
  wallet: null,
  items: [],
  attempts: [],
  connection: 'loading',
  hasSavedAttempts: false,
  discoveryComplete: false,
  discoveryLimited: false,
  notices: { popup: [], dashboard: [] },
  noticeConnection: 'loading',
  noticeCursors: { popup: null, dashboard: null },
  noticeNextCursors: { popup: null, dashboard: null },
  noticePending: [],
  noticeErrors: {},
};

interface TrackerOptions {
  storage: Storage;
  fetcher?: typeof fetch;
  online?: () => boolean;
  enabled?: () => boolean;
  canNotify?: () => boolean;
  onCompleted?: (item: RegistrationProgress, wallet: string, isCurrent: () => boolean) => void;
  onResolved?: (items: RegistrationProgress[], wallet: string) => void;
  lock?: (key: string, callback: () => void) => Promise<void>;
  submissionLock?: SubmissionLock;
  now?: () => number;
  random?: () => number;
}

export class RegistrationTracker {
  private state = EMPTY_REGISTRATION_SNAPSHOT;
  private listeners = new Set<() => void>();
  private accepted = new Map<string, RegistrationAccepted>();
  private releasedRejections = new Map<string, RegistrationProgress>();
  private deliveredResolutions = new Map<string, RegistrationProgress['status']>();
  private noticeClient: RegistrationNoticesClient;
  private noticeVersion = 0;
  private noticeSynced = new Set<string>();
  private unknownSubmissions = new Set<string>();
  private mutationRetryAt = new Map<string, number>();
  private lifetimeController = new AbortController();
  private listedNotices: RegistrationNotice[] = [];
  private confirmedDismissals = new Set<string>();
  private nextNoticeReadAt = new Map<string, number>();
  private expectedWallet: string | null | undefined;
  private epoch = 0;
  private controller?: AbortController;
  private inFlight?: Promise<boolean>;
  private fetcher: typeof fetch;
  private discoveryOffset = REGISTRATION_PAGE_SIZE;
  private detailOffset = 0;
  private nextReadAt = new Map<string, number>();
  private failures = new Map<string, number>();
  private lastAuthenticatedRead?: { wallet: string; epoch: number; at: number };

  constructor(private options: TrackerOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.noticeClient = new RegistrationNoticesClient(this.fetcher);
  }
  getSnapshot = () => this.state;
  private now = () => (this.options.now ?? Date.now)();
  private jitter = () =>
    Math.floor(
      Math.min(1, Math.max(0, (this.options.random ?? Math.random)())) *
        REGISTRATION_RETRY_JITTER_MS,
    );

  private sharedRetryAt(wallet: string) {
    try {
      const value = Number(this.options.storage.getItem(`${REGISTRATION_BACKOFF_PREFIX}${wallet}`));
      return Number.isSafeInteger(value) && value > this.now() ? value : 0;
    } catch {
      return 0;
    }
  }

  getNextPollDelay = (minimum = REGISTRATION_POLL_MS) => {
    const wallet = this.expectedWallet;
    const next = wallet
      ? Math.max(this.nextReadAt.get(wallet) ?? 0, this.sharedRetryAt(wallet))
      : 0;
    return Math.min(
      REGISTRATION_MAX_POLL_MS,
      Math.max(
        REGISTRATION_POLL_MS,
        Number.isFinite(minimum) ? minimum : REGISTRATION_MAX_POLL_MS,
        next - this.now(),
      ),
    );
  };

  /** Cached read readiness only; checkout must independently revalidate its current payer/session. */
  isReadyForPayer = (wallet: string) => {
    const normalized = wallet.toLowerCase();
    return (
      this.expectedWallet === normalized &&
      this.state.wallet === normalized &&
      this.state.connection === 'ready' &&
      this.lastAuthenticatedRead?.wallet === normalized &&
      this.lastAuthenticatedRead.epoch === this.epoch &&
      this.now() >= this.lastAuthenticatedRead.at &&
      this.now() - this.lastAuthenticatedRead.at <= REGISTRATION_POLL_MS &&
      !this.sharedRetryAt(normalized) &&
      !(this.failures.get(normalized) ?? 0)
    );
  };

  isSubmissionUnconfirmed = (attempt: RegistrationAttempt, now = this.now()) =>
    attempt.wallet === this.state.wallet &&
    !this.matches(attempt) &&
    !this.accepted.has(this.attemptKey(attempt)) &&
    submissionReviewRequired(attempt, this.options.storage, now);

  private attemptKey(attempt: RegistrationAttempt) {
    const canonical = noticeClientIdSchema.safeParse(attempt.clientId);
    return `${attempt.wallet}:${canonical.success ? canonical.data : attempt.clientId}`;
  }

  isNoticeDismissed(attempt: RegistrationAttempt) {
    const key = this.attemptKey(attempt);
    try {
      return [key, `${attempt.wallet}:${attempt.clientId}`, key.replace(/:(\d{13})-/, ':$1.')].some(
        (alias) =>
          this.options.storage.getItem(`${REGISTRATION_NOTICE_PREFIX}${alias}`) === 'dismissed',
      );
    } catch {
      return false;
    }
  }

  // Compatibility for existing callers; dismissal never removes operational attempts/reservations.
  async dismissNotices(attempts: RegistrationAttempt[]) {
    for (const attempt of attempts) {
      if (attempt.wallet !== this.state.wallet) continue;
      const id = this.matches(attempt)?.registrationId;
      const notice = this.state.notices.popup.find(
        (item) =>
          item.noticeId === `client:${attempt.clientId}` || (id && item.registrationId === id),
      );
      if (notice) await this.dismissNotice(notice.noticeId, 'popup');
    }
  }

  isPopupEligible = (registrationId: string) =>
    this.state.connection !== 'unauthorized' &&
    this.state.noticeConnection === 'ready' &&
    !this.state.noticePending.length &&
    this.state.notices.popup.some(
      (notice) => notice.registrationId === registrationId && noticeIsCurrent(notice, this.now()),
    );

  expireNotices = () => {
    const notices = { ...this.state.notices };
    let changed = false;
    for (const channel of NOTICE_CHANNELS) {
      notices[channel] = notices[channel].filter((notice) => noticeIsCurrent(notice, this.now()));
      changed ||= notices[channel].length !== this.state.notices[channel].length;
    }
    if (changed) this.update({ notices });
  };

  private async noticeFailure(error: unknown, wallet: string, epoch: number) {
    if (epoch !== this.epoch) return;
    const unauthorized = error instanceof RegistrationReadError && error.kind === 'unauthorized';
    if (unauthorized) {
      this.invalidate();
      this.update({ connection: 'unauthorized', noticeConnection: 'unauthorized' });
      return;
    }
    if (
      error instanceof RegistrationReadError &&
      (error.status === 429 || error.retryAfterMs !== undefined)
    )
      await this.deferRead(error, wallet);
    if (epoch !== this.epoch) return;
    this.update({
      noticeConnection: unauthorized ? 'unauthorized' : 'unavailable',
      notices: { popup: [], dashboard: [] },
      ...(unauthorized ? { connection: 'unauthorized' as const } : {}),
    });
  }

  async dismissNotice(id: string, channel: NoticeChannel) {
    const wallet = this.expectedWallet;
    const key = `${channel}:${id}`;
    if (
      !wallet ||
      this.state.noticeConnection !== 'ready' ||
      this.state.noticePending.length ||
      !this.state.notices[channel].some((item) => item.noticeId === id)
    )
      return false;
    const epoch = this.epoch;
    this.noticeVersion++;
    this.update({
      noticePending: [key],
      noticeErrors: { ...this.state.noticeErrors, [channel]: undefined },
    });
    try {
      this.checkMutationCooldown(wallet);
      await this.noticeClient.dismiss(wallet, id, channel, this.lifetimeController.signal);
      if (epoch !== this.epoch) return false;
      const notice = this.state.notices[channel].find((item) => item.noticeId === id);
      if (notice)
        this.confirmedDismissals.add(`${wallet}:${channel}:${this.noticePurchaseKey(notice)}`);
      this.noticeVersion++;
      this.update({
        notices: {
          ...this.state.notices,
          [channel]: this.filterNotices(this.state.notices[channel]),
        },
      });
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      if (error instanceof RegistrationReadError && error.kind === 'unauthorized')
        await this.noticeFailure(error, wallet, epoch);
      else {
        this.deferMutation(error, wallet);
        if (epoch === this.epoch)
          this.update({
            noticeErrors: {
              ...this.state.noticeErrors,
              [channel]: 'Dismissal was not confirmed. Try again later.',
            },
          });
      }
      return false;
    } finally {
      if (epoch === this.epoch) this.update({ noticePending: [] });
    }
  }

  async pageNotices(channel: NoticeChannel, latest = false) {
    const wallet = this.expectedWallet;
    const cursor = latest ? null : this.state.noticeNextCursors[channel];
    if (
      !wallet ||
      (!latest && !cursor) ||
      this.state.noticePending.length ||
      this.state.noticeConnection !== 'ready' ||
      this.sharedRetryAt(wallet) ||
      (this.failures.has(wallet) && (this.nextReadAt.get(wallet) ?? 0) > this.now())
    )
      return;
    const epoch = this.epoch;
    const version = ++this.noticeVersion;
    this.update({ noticePending: [`page:${channel}`] });
    try {
      const page = await this.noticeClient.list(
        wallet,
        channel,
        cursor,
        this.lifetimeController.signal,
      );
      if (epoch !== this.epoch || version !== this.noticeVersion) return;
      this.update({
        notices: { ...this.state.notices, [channel]: this.filterNotices(page.items) },
        noticeCursors: { ...this.state.noticeCursors, [channel]: cursor },
        noticeNextCursors: { ...this.state.noticeNextCursors, [channel]: page.nextCursor },
      });
    } catch (error) {
      await this.noticeFailure(error, wallet, epoch);
    } finally {
      if (epoch === this.epoch) this.update({ noticePending: [] });
    }
  }

  private noticePurchaseKey(notice: RegistrationNotice) {
    if (notice.registrationId) return `registration:${notice.registrationId}`;
    const attempt = this.state.attempts.find(
      (item) => notice.noticeId === `client:${item.clientId}`,
    );
    const id =
      attempt &&
      (this.matches(attempt)?.registrationId ?? this.getAcceptance(attempt)?.registrationId);
    return id ? `registration:${id}` : notice.noticeId;
  }

  private filterNotices(items: RegistrationNotice[]) {
    const grouped = new Map<string, RegistrationNotice>();
    for (const notice of items) {
      const key = this.noticePurchaseKey(notice);
      const prefix = `${this.state.wallet}:${notice.channel}:`;
      const dismissedAlias = this.state.attempts.some((attempt) => {
        const id =
          this.matches(attempt)?.registrationId ?? this.getAcceptance(attempt)?.registrationId;
        return (
          id &&
          key === `registration:${id}` &&
          this.confirmedDismissals.has(`${prefix}client:${attempt.clientId}`)
        );
      });
      if (dismissedAlias) this.confirmedDismissals.add(`${prefix}${key}`);
      if (
        !noticeIsCurrent(notice, this.now()) ||
        this.confirmedDismissals.has(`${this.state.wallet}:${notice.channel}:${key}`) ||
        (notice.channel === 'popup' &&
          this.state.attempts.some(
            (attempt) =>
              this.isNoticeDismissed(attempt) &&
              (notice.noticeId === `client:${attempt.clientId}` ||
                notice.registrationId === this.matches(attempt)?.registrationId),
          ))
      )
        continue;
      const previous = grouped.get(key);
      // A canonical notice may arrive before its client alias link response. Group only proven identities.
      if (!previous || (notice.source === 'registration' && previous.source !== 'registration'))
        grouped.set(key, notice);
    }
    return [...grouped.values()];
  }

  private async readNotices(wallet: string, epoch: number, signal: AbortSignal, force = false) {
    if (this.state.noticePending.length || this.sharedRetryAt(wallet)) return;
    if (
      !force &&
      this.state.noticeConnection === 'ready' &&
      (this.nextNoticeReadAt.get(wallet) ?? 0) > this.now()
    )
      return;
    // Two notice pages per ten seconds leave room for the existing financial-status read budget.
    this.nextNoticeReadAt.set(wallet, this.now() + 2 * REGISTRATION_POLL_MS);
    const version = this.noticeVersion;
    try {
      const notices = { ...this.state.notices };
      const next = { ...this.state.noticeNextCursors };
      const listed: RegistrationNotice[] = [];
      for (const channel of NOTICE_CHANNELS) {
        const page = await this.noticeClient.list(
          wallet,
          channel,
          this.state.noticeCursors[channel],
          signal,
        );
        if (epoch !== this.epoch || version !== this.noticeVersion) return;
        listed.push(...page.items);
        notices[channel] = this.filterNotices(page.items);
        next[channel] = page.nextCursor;
      }
      this.listedNotices = listed;
      this.update({ notices, noticeNextCursors: next, noticeConnection: 'ready' });
    } catch (error) {
      if (
        epoch === this.epoch &&
        version === this.noticeVersion &&
        error instanceof RegistrationReadError &&
        error.status === 400
      )
        this.update({ noticeCursors: { popup: null, dashboard: null } });
      if (version === this.noticeVersion) await this.noticeFailure(error, wallet, epoch);
    }
  }

  private checkMutationCooldown(wallet: string) {
    const retryAt = this.mutationRetryAt.get(wallet) ?? 0;
    if (retryAt > this.now())
      throw new RegistrationReadError('unavailable', 429, retryAt - this.now());
  }

  private deferMutation(error: unknown, wallet: string) {
    if (error instanceof RegistrationReadError && error.kind === 'unauthorized') return;
    const delay = error instanceof RegistrationReadError ? error.retryAfterMs : undefined;
    this.mutationRetryAt.set(wallet, this.now() + Math.max(REGISTRATION_POLL_MS, delay ?? 0));
  }

  private async syncNoticeMutation<T>(epoch: number, operation: () => Promise<T>) {
    this.noticeVersion++;
    this.update({ noticePending: ['sync'] });
    try {
      return await operation();
    } finally {
      if (epoch === this.epoch) this.update({ noticePending: [] });
    }
  }

  private async reconcileNotice(wallet: string, epoch: number, signal: AbortSignal) {
    // One idempotent write per poll. Completed history must never create rollout notices.
    if (
      this.state.noticePending.length ||
      this.state.noticeConnection !== 'ready' ||
      (this.mutationRetryAt.get(wallet) ?? 0) > this.now()
    )
      return;
    for (const attempt of this.state.attempts) {
      if (!noticeClientIdSchema.safeParse(attempt.clientId).success) continue;
      const key = this.attemptKey(attempt);
      const item = this.matches(attempt);
      const id = item?.registrationId ?? this.accepted.get(key)?.registrationId;
      const syncKey = `${key}:${id ?? 'unknown'}`;
      if (this.noticeSynced.has(syncKey)) continue;
      const existing = this.listedNotices;
      const linked = id && existing.some((notice) => notice.registrationId === id);
      const unlinked = existing.some(
        (notice) => notice.noticeId === `client:${attempt.clientId}` && !notice.registrationId,
      );
      if (!this.isNoticeDismissed(attempt) && ((linked && !unlinked) || (!id && unlinked))) {
        this.noticeSynced.add(syncKey);
        continue;
      }
      try {
        this.checkMutationCooldown(wallet);
        if (this.isNoticeDismissed(attempt)) {
          const targets = [`client:${attempt.clientId}`, ...(id ? [`registration:${id}`] : [])];
          const target = targets.find(
            (target) => !this.noticeSynced.has(`dismiss:${key}:${target}`),
          );
          if (target) {
            await this.syncNoticeMutation(epoch, () =>
              this.noticeClient.dismiss(wallet, target, 'popup', signal),
            );
            if (epoch !== this.epoch) return;
            this.noticeSynced.add(`dismiss:${key}:${target}`);
          }
          if (targets.some((target) => !this.noticeSynced.has(`dismiss:${key}:${target}`))) return;
        } else if (id && (!item || !isRegistrationTerminal(item))) {
          await this.syncNoticeMutation(epoch, () =>
            this.noticeClient.create(wallet, id, attempt.clientId, signal),
          );
        } else if (!id) {
          let reservation;
          try {
            reservation = readSubmissionReservation(this.options.storage, wallet, attempt.domain);
          } catch {
            continue;
          }
          const possiblySent =
            this.unknownSubmissions.has(key) ||
            (reservation?.clientId === attempt.clientId &&
              reservation.phase === 'possibly_paid' &&
              submissionReviewRequired(attempt, this.options.storage, this.now()));
          if (!possiblySent) continue;
          await this.syncNoticeMutation(epoch, () =>
            this.noticeClient.submission(wallet, attempt.clientId, attempt.domain, signal),
          );
        } else continue;
        if (epoch !== this.epoch) return;
        this.noticeSynced.add(syncKey);
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error instanceof RegistrationReadError && error.kind === 'unauthorized')
          await this.noticeFailure(error, wallet, epoch);
        else {
          this.deferMutation(error, wallet);
          // Invalid/expired sources cannot be repaired by repeating the same write every poll.
          if (
            !this.isNoticeDismissed(attempt) &&
            error instanceof RegistrationReadError &&
            [400, 404, 409].includes(error.status ?? 0)
          )
            this.noticeSynced.add(syncKey);
        }
      }
      return;
    }
    const recovery = this.state.items.find(
      (item) =>
        item.paymentStatus === 'settled' &&
        !isRegistrationTerminal(item) &&
        isNoticeRegistrationId(item.registrationId) &&
        !this.noticeSynced.has(`${wallet}:canonical:${item.registrationId}`) &&
        !this.listedNotices.some((notice) => notice.registrationId === item.registrationId),
    );
    if (!recovery) return;
    const key = `${wallet}:canonical:${recovery.registrationId}`;
    try {
      await this.syncNoticeMutation(epoch, () =>
        this.noticeClient.create(wallet, recovery.registrationId, undefined, signal),
      );
      if (epoch === this.epoch) this.noticeSynced.add(key);
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof RegistrationReadError && error.kind === 'unauthorized')
        await this.noticeFailure(error, wallet, epoch);
      else {
        this.deferMutation(error, wallet);
        if (error instanceof RegistrationReadError && [400, 404, 409].includes(error.status ?? 0))
          this.noticeSynced.add(key);
      }
    }
  }

  private async deferRead(error: unknown, wallet: string) {
    const failures = Math.min((this.failures.get(wallet) ?? 0) + 1, 7);
    this.failures.set(wallet, failures);
    const base = Math.min(REGISTRATION_MAX_POLL_MS, REGISTRATION_POLL_MS * 2 ** (failures - 1));
    const retry = error instanceof RegistrationReadError ? (error.retryAfterMs ?? 0) : 0;
    const until = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.now() + Math.max(base, retry) + this.jitter(),
    );
    this.nextReadAt.set(wallet, Math.max(this.nextReadAt.get(wallet) ?? 0, until));
    if (error instanceof RegistrationReadError && error.status === 429) {
      const key = `${REGISTRATION_BACKOFF_PREFIX}${wallet}`;
      const save = () => {
        try {
          this.options.storage.setItem(key, String(Math.max(until, this.sharedRetryAt(wallet))));
        } catch {
          /* Local cooldown still applies when shared storage is unavailable. */
        }
      };
      if (this.options.lock) await this.options.lock(key, save).catch(save);
      else save();
    }
  }

  private payerRead(path: string, wallet: string, signal: AbortSignal) {
    const retryAt = this.sharedRetryAt(wallet);
    if (retryAt) throw new RegistrationReadError('unavailable', 429, retryAt - this.now());
    return registrationRead(path, this.fetcher, signal, wallet);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(value: Partial<RegistrationSnapshot>) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }

  hydrate() {
    const attempts = this.readAttempts();
    const wallet = this.expectedWallet !== undefined ? this.expectedWallet : this.state.wallet;
    this.update({
      wallet,
      attempts: attempts.filter((item) => item.wallet === wallet),
      hasSavedAttempts: attempts.length > 0,
    });
  }

  private readAttempts() {
    const attempts: RegistrationAttempt[] = [];
    try {
      for (let i = 0; i < this.options.storage.length; i++) {
        const key = this.options.storage.key(i);
        if (!key?.startsWith(ATTEMPT_PREFIX)) continue;
        try {
          const raw = JSON.parse(this.options.storage.getItem(key) ?? 'null');
          const canonical = noticeClientIdSchema.safeParse(raw?.clientId);
          const parsed = registrationAttemptSchema.safeParse(
            canonical.success ? { ...raw, clientId: canonical.data } : raw,
          );
          if (
            parsed.success &&
            !attempts.some((item) => this.attemptKey(item) === this.attemptKey(parsed.data))
          )
            attempts.push(parsed.data);
        } catch {
          /* Ignore corrupt storage, never interpret it as an operation result. */
        }
      }
    } catch {
      /* Checkout separately refuses to submit if its placeholder cannot be saved. */
    }
    return attempts.sort((a, b) => attemptStartedAt(a) - attemptStartedAt(b));
  }

  remember(attempt: RegistrationAttempt) {
    const clean = registrationAttemptSchema.parse(attempt);
    this.releasedRejections.delete(this.attemptKey(clean));
    const key = `${ATTEMPT_PREFIX}${clean.clientId}`;
    const value = JSON.stringify(clean);
    this.options.storage.setItem(key, value);
    if (this.options.storage.getItem(key) !== value)
      throw new Error('Unable to save registration tracking.');
    if (this.expectedWallet === undefined || this.expectedWallet === clean.wallet)
      this.update({ wallet: clean.wallet });
    this.hydrate();
  }

  private removeTerminalAttempt(attempt: RegistrationAttempt) {
    let confirmed = true;
    const keys = Array.from({ length: this.options.storage.length }, (_, index) =>
      this.options.storage.key(index),
    );
    for (const key of keys) {
      if (!key?.startsWith(ATTEMPT_PREFIX)) continue;
      try {
        const raw = this.options.storage.getItem(key);
        const value = JSON.parse(raw ?? 'null');
        const canonical = noticeClientIdSchema.safeParse(value?.clientId);
        const parsed = registrationAttemptSchema.safeParse(
          canonical.success ? { ...value, clientId: canonical.data } : value,
        );
        if (
          parsed.success &&
          parsed.data.wallet === attempt.wallet &&
          parsed.data.domain === attempt.domain &&
          parsed.data.clientId === attempt.clientId &&
          this.options.storage.getItem(key) === raw
        )
          this.options.storage.removeItem(key);
      } catch {
        /* Preserve malformed or concurrently replaced operational state. */
        confirmed = false;
      }
    }
    return confirmed;
  }

  private boundUnchargedRejection(attempt: RegistrationAttempt) {
    if (attempt.wallet !== this.state.wallet || this.accepted.has(this.attemptKey(attempt)))
      return undefined;
    try {
      const saved = readSubmissionReservation(this.options.storage, attempt.wallet, attempt.domain);
      if (
        !saved?.paymentReference ||
        saved.phase !== 'possibly_paid' ||
        saved.clientId !== attempt.clientId
      )
        return undefined;
      const matches = this.state.items.filter(
        (item) =>
          item.domain === attempt.domain &&
          item.status === 'failed' &&
          item.paymentStatus === 'not_charged' &&
          item.messageCode === 'PAYMENT_NOT_SUBMITTED' &&
          item.paymentReference === saved.paymentReference,
      );
      return matches.length === 1 ? matches[0] : undefined;
    } catch {
      return undefined;
    }
  }

  getReleasedRejection(attempt: RegistrationAttempt) {
    if (
      attempt.wallet !== this.state.wallet ||
      attempt.wallet !== this.expectedWallet ||
      this.accepted.has(this.attemptKey(attempt))
    )
      return undefined;
    const receipt = this.releasedRejections.get(this.attemptKey(attempt));
    if (!receipt) return undefined;
    try {
      if (
        readSubmissionReservation(this.options.storage, attempt.wallet, attempt.domain) !== null ||
        this.options.storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`) !== null
      )
        return undefined;
      return this.state.items.find(
        (item) =>
          item.registrationId === receipt.registrationId &&
          item.domain === attempt.domain &&
          item.paymentReference === receipt.paymentReference &&
          item.status === 'failed' &&
          item.paymentStatus === 'not_charged' &&
          item.messageCode === 'PAYMENT_NOT_SUBMITTED',
      );
    } catch {
      return undefined;
    }
  }

  private async releaseUnchargedAttempts(
    observed: RegistrationProgress[],
    wallet: string,
    epoch: number,
  ) {
    const candidates = new Map(
      this.state.attempts.map((attempt) => [this.attemptKey(attempt), attempt]),
    );
    // Older trackers may have removed the attempt while leaving its possibly-paid reservation.
    for (const item of observed) {
      if (
        item.status !== 'failed' ||
        item.paymentStatus !== 'not_charged' ||
        item.messageCode !== 'PAYMENT_NOT_SUBMITTED'
      )
        continue;
      try {
        const saved = readSubmissionReservation(this.options.storage, wallet, item.domain);
        if (
          saved?.phase !== 'possibly_paid' ||
          !saved.paymentReference ||
          saved.paymentReference !== item.paymentReference
        )
          continue;
        if (
          this.state.attempts.some(
            (attempt) =>
              attempt.wallet === saved.wallet &&
              attempt.domain === saved.domain &&
              attempt.clientId !== saved.clientId,
          )
        )
          continue;
        const attempt = registrationAttemptSchema.parse({
          wallet: saved.wallet,
          domain: saved.domain,
          clientId: saved.clientId,
        });
        candidates.set(this.attemptKey(attempt), attempt);
      } catch {
        /* An unreadable reservation is not permission to remove it. */
      }
    }
    for (const attempt of candidates.values()) {
      const item = this.boundUnchargedRejection(attempt);
      if (
        !item ||
        item.status !== 'failed' ||
        item.paymentStatus !== 'not_charged' ||
        item.messageCode !== 'PAYMENT_NOT_SUBMITTED' ||
        this.accepted.has(this.attemptKey(attempt)) ||
        !observed.some(
          (read) =>
            read.registrationId === item.registrationId &&
            read.status === item.status &&
            read.paymentStatus === item.paymentStatus &&
            read.paymentReference === item.paymentReference &&
            read.messageCode === item.messageCode &&
            read.updatedAt === item.updatedAt &&
            read.revision === item.revision,
        )
      )
        continue;
      const released = await releaseUnchargedSubmissionReservation(attempt, item, {
        storage: this.options.storage,
        lock: this.options.submissionLock,
        currentWallet: () => this.expectedWallet,
        isCurrent: () =>
          epoch === this.epoch &&
          this.state.wallet === wallet &&
          this.lastAuthenticatedRead?.epoch === epoch &&
          this.state.connection === 'ready' &&
          this.state.items.includes(item) &&
          !this.accepted.has(this.attemptKey(attempt)),
      });
      if (epoch !== this.epoch) return;
      if (
        !released ||
        !this.state.items.includes(item) ||
        this.accepted.has(this.attemptKey(attempt))
      )
        continue;
      try {
        if (readSubmissionReservation(this.options.storage, wallet, attempt.domain) !== null)
          continue;
        if (
          !this.removeTerminalAttempt(attempt) ||
          this.options.storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`) !== null
        )
          continue;
        this.releasedRejections.set(this.attemptKey(attempt), item);
        this.unknownSubmissions.delete(this.attemptKey(attempt));
      } catch {
        /* Keep the exact local attempt if cleanup cannot be confirmed. */
      }
    }
    this.hydrate();
  }

  accept(attempt: RegistrationAttempt, accepted: RegistrationAccepted | null) {
    if (accepted?.domain === attempt.domain) {
      this.accepted.set(this.attemptKey(attempt), accepted);
      this.update(
        attempt.wallet === this.state.wallet
          ? {
              items: this.state.items.filter(
                (item) =>
                  item.registrationId !== accepted.registrationId ||
                  item.domain !== accepted.domain ||
                  item.paymentStatus !== 'not_charged',
              ),
            }
          : {},
      );
    }
    if (!accepted) this.unknownSubmissions.add(this.attemptKey(attempt));
    void this.refresh();
  }

  /** Only a conclusive signed-request rejection may release this exact local placeholder. */
  reject(attempt: RegistrationAttempt, rejection: RegistrationPaymentRejection) {
    if (
      rejection.status !== 'rejected' ||
      rejection.settlementAttempted !== false ||
      !rejection.code ||
      !rejection.message
    )
      return false;
    const clean = registrationAttemptSchema.parse(attempt);
    const storageKey = `${ATTEMPT_PREFIX}${clean.clientId}`;
    try {
      const raw = this.options.storage.getItem(storageKey);
      if (raw !== null) {
        const saved = registrationAttemptSchema.parse(JSON.parse(raw));
        if (
          saved.wallet !== clean.wallet ||
          saved.domain !== clean.domain ||
          saved.clientId !== clean.clientId
        )
          return false;
        this.options.storage.removeItem(storageKey);
        if (this.options.storage.getItem(storageKey) !== null) return false;
      }
    } catch {
      return false;
    }
    this.accepted.delete(this.attemptKey(clean));
    this.unknownSubmissions.delete(this.attemptKey(clean));
    this.hydrate();
    return true;
  }

  getAcceptance(attempt: RegistrationAttempt) {
    if (attempt.wallet !== this.state.wallet) return undefined;
    return this.accepted.get(this.attemptKey(attempt));
  }

  matches(attempt: RegistrationAttempt) {
    if (attempt.wallet !== this.state.wallet) return undefined;
    const accepted = this.accepted.get(this.attemptKey(attempt));
    return accepted
      ? this.state.items.find((item) => item.registrationId === accepted.registrationId)
      : (this.boundUnchargedRejection(attempt) ??
          this.getReleasedRejection(attempt) ??
          matchAttempt(
            attempt,
            this.state.items.filter((item) => item.paymentStatus !== 'not_charged'),
          ));
  }

  hasPurchase(wallet: string, domain: string) {
    if (this.state.wallet !== wallet.toLowerCase()) return false;
    return (
      this.state.attempts.some((item) => item.domain === domain) ||
      this.state.items.some(
        (item) => item.domain === domain && !['failed', 'refunded'].includes(item.status),
      )
    );
  }

  setExpectedWallet(wallet: string | null) {
    const normalized = wallet?.toLowerCase() ?? null;
    if (this.expectedWallet === normalized) return;
    this.expectedWallet = normalized;
    this.invalidate();
    this.deliveredResolutions.clear();
    this.discoveryOffset = REGISTRATION_PAGE_SIZE;
    this.detailOffset = 0;
    this.update({
      wallet: normalized,
      items: [],
      attempts: [],
      connection: normalized ? 'loading' : 'unauthorized',
      discoveryComplete: false,
      discoveryLimited: false,
    });
    this.hydrate();
    void this.refresh();
  }

  invalidate() {
    this.epoch++;
    this.releasedRejections.clear();
    this.controller?.abort();
    this.lifetimeController.abort();
    this.lifetimeController = new AbortController();
    this.inFlight = undefined;
    this.lastAuthenticatedRead = undefined;
    this.noticeVersion++;
    this.listedNotices = [];
    this.update({
      connection: this.expectedWallet ? 'loading' : 'unauthorized',
      notices: { popup: [], dashboard: [] },
      noticeConnection: 'loading',
      noticePending: [],
      noticeErrors: {},
      noticeCursors: { popup: null, dashboard: null },
      noticeNextCursors: { popup: null, dashboard: null },
    });
  }

  refresh = (): Promise<boolean> => {
    if (this.inFlight) return this.inFlight;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const promise = this.poll(epoch, controller.signal).finally(() => {
      if (this.inFlight === promise) this.inFlight = undefined;
    });
    this.inFlight = promise;
    return promise;
  };

  private async poll(epoch: number, signal: AbortSignal) {
    const payer = this.expectedWallet;
    try {
      if (this.options.enabled && !this.options.enabled()) return false;
      this.hydrate();
      if (this.options.online && !this.options.online()) {
        this.update({
          connection: 'offline',
          noticeConnection: 'offline',
          notices: { popup: [], dashboard: [] },
        });
        return false;
      }
      if (!payer) throw new RegistrationReadError('unauthorized');
      if (this.now() < Math.max(this.nextReadAt.get(payer) ?? 0, this.sharedRetryAt(payer)))
        return false;
      this.nextReadAt.set(payer, this.now() + REGISTRATION_POLL_MS + this.jitter());
      const session = await readRegistrationSession(this.fetcher, signal);
      if (epoch !== this.epoch) return false;
      if (session.wallet !== payer) throw new RegistrationReadError('unauthorized');
      if (session.wallet !== this.state.wallet)
        this.update({ wallet: session.wallet, items: [], attempts: [] });
      this.hydrate();
      const items: RegistrationProgress[] = [];
      let discoveryComplete = this.state.discoveryComplete;
      let discoveryLimited = this.state.discoveryLimited;
      const offsets = [0, this.discoveryOffset].slice(0, REGISTRATION_LIST_PAGES_PER_POLL);
      for (const offset of offsets) {
        if (epoch !== this.epoch) return false;
        const response = await this.payerRead(
          `/api/v1/registrations?limit=${REGISTRATION_PAGE_SIZE}&offset=${offset}`,
          payer,
          signal,
        );
        if (epoch !== this.epoch) return false;
        const page = registrationListSchema.parse(await response.json());
        if (epoch !== this.epoch) return false;
        if (page.hasMore && (page.items.length === 0 || offset + page.items.length >= page.total))
          throw new RegistrationReadError('unavailable');
        items.push(...page.items);
        if (!page.hasMore || offset >= REGISTRATION_MAX_DISCOVERY_OFFSET) {
          discoveryComplete = true;
          discoveryLimited = page.hasMore;
          this.discoveryOffset = REGISTRATION_PAGE_SIZE;
          break;
        }
        if (offset !== 0) this.discoveryOffset = offset + REGISTRATION_PAGE_SIZE;
      }
      const ids = new Set<string>();
      for (const item of this.state.items)
        if (!isRegistrationTerminal(item)) ids.add(item.registrationId);
      for (const channel of NOTICE_CHANNELS)
        for (const notice of this.state.notices[channel])
          if (notice.registrationId) ids.add(notice.registrationId);
      for (const attempt of this.state.attempts) {
        const id =
          this.accepted.get(this.attemptKey(attempt))?.registrationId ??
          this.matches(attempt)?.registrationId ??
          matchAttempt(attempt, items)?.registrationId;
        if (id) ids.add(id);
      }
      const knownIds = [...ids].sort();
      const detailCount = Math.min(knownIds.length, REGISTRATION_DETAILS_PER_POLL);
      let detailUnavailable = false;
      let detailError: unknown;
      for (let index = 0; index < detailCount; index++) {
        if (epoch !== this.epoch) return false;
        const id = knownIds[(this.detailOffset + index) % knownIds.length];
        try {
          const response = await this.payerRead(registrationPath(id), payer, signal);
          if (epoch !== this.epoch) return false;
          const item = registrationProgressSchema.parse(await response.json());
          if (item.registrationId !== id) throw new RegistrationReadError('unavailable');
          items.push(item);
        } catch (error) {
          if (
            error instanceof RegistrationReadError &&
            (error.kind === 'unauthorized' ||
              error.status === 429 ||
              error.retryAfterMs !== undefined)
          )
            throw error;
          detailUnavailable = true;
          detailError = error;
        }
      }
      if (epoch !== this.epoch) return false;
      this.detailOffset = knownIds.length ? (this.detailOffset + detailCount) % knownIds.length : 0;
      const merged = new Map(this.state.items.map((item) => [item.registrationId, item]));
      const resolved = new Map<string, RegistrationProgress>();
      for (const item of items) {
        const previous = merged.get(item.registrationId);
        if (
          item.paymentStatus === 'not_charged' &&
          (previous?.paymentStatus === 'settled' ||
            previous?.paymentStatus === 'refunded' ||
            [...this.accepted.entries()].some(
              ([key, receipt]) =>
                key.startsWith(`${payer}:`) &&
                receipt.registrationId === item.registrationId &&
                receipt.domain === item.domain,
            ))
        )
          continue;
        // Revision belongs to the workflow; payment/refund observations can change without incrementing it.
        if (
          !previous ||
          canAdvanceRegistration(previous, item) ||
          (previous.paymentReference === undefined &&
            item.paymentReference !== undefined &&
            canAdvanceRegistration(previous, { ...item, paymentReference: undefined }))
        ) {
          const next =
            previous?.completionEventId && !item.completionEventId
              ? { ...item, completionEventId: previous.completionEventId }
              : item;
          merged.set(item.registrationId, next);
          if (!isRegistrationTerminal(next)) this.deliveredResolutions.delete(item.registrationId);
          if (previous && previous.status !== item.status && isRegistrationTerminal(item))
            resolved.set(item.registrationId, item);
        }
      }
      if (detailUnavailable) await this.deferRead(detailError, payer);
      else {
        this.failures.delete(payer);
        this.lastAuthenticatedRead = { wallet: payer, epoch, at: this.now() };
      }
      if (epoch !== this.epoch) return false;
      this.update({
        items: [...merged.values()],
        connection: detailUnavailable ? 'unavailable' : 'ready',
        discoveryComplete,
        discoveryLimited,
      });
      if (epoch !== this.epoch) return false;
      if (!detailUnavailable) await this.releaseUnchargedAttempts(items, payer, epoch);
      if (epoch !== this.epoch) return false;
      await this.readNotices(payer, epoch, signal, resolved.size > 0);
      if (epoch !== this.epoch) return false;
      await this.reconcileNotice(payer, epoch, signal);
      if (epoch !== this.epoch) return false;
      for (const attempt of [...this.state.attempts]) {
        const item = this.matches(attempt);
        if (!item || !isRegistrationTerminal(item)) continue;
        resolved.set(item.registrationId, item);
      }
      const resolutions = [...resolved.keys()]
        .map((id) => merged.get(id)!)
        .filter(
          (item) =>
            isRegistrationTerminal(item) &&
            this.deliveredResolutions.get(item.registrationId) !== item.status,
        );
      if (resolutions.length) {
        this.options.onResolved?.(resolutions, session.wallet);
        if (epoch !== this.epoch) return false;
        for (const item of resolutions)
          this.deliveredResolutions.set(item.registrationId, item.status);
      }
      // Data refresh is delivered independently of whether a visible tab can show the toast.
      for (const item of this.state.items) {
        if (item.status === 'completed' && this.isPopupEligible(item.registrationId))
          await this.complete(item, session.wallet, epoch);
        if (epoch !== this.epoch) return false;
      }
      for (const attempt of [...this.state.attempts]) {
        const item = this.matches(attempt);
        if (!item || !isRegistrationTerminal(item)) continue;
        if (
          this.isNoticeDismissed(attempt) &&
          !this.noticeSynced.has(`${this.attemptKey(attempt)}:${item.registrationId}`)
        )
          continue;
        const acknowledged =
          item.status !== 'completed' || (await this.complete(item, session.wallet, epoch));
        if (epoch !== this.epoch) return false;
        if (!acknowledged) continue;
        this.removeTerminalAttempt(attempt);
        this.accepted.delete(this.attemptKey(attempt));
        this.unknownSubmissions.delete(this.attemptKey(attempt));
      }
      this.hydrate();
      const retained = new Set(
        this.state.attempts.map((attempt) => this.matches(attempt)?.registrationId),
      );
      for (const id of this.deliveredResolutions.keys())
        if (!retained.has(id)) this.deliveredResolutions.delete(id);
      return !detailUnavailable;
    } catch (error) {
      if (epoch === this.epoch) {
        if (payer && !(error instanceof RegistrationReadError && error.kind === 'unauthorized'))
          await this.deferRead(error, payer);
        if (epoch !== this.epoch) return false;
        this.update({
          connection: error instanceof RegistrationReadError ? error.kind : 'unavailable',
          noticeConnection: error instanceof RegistrationReadError ? error.kind : 'unavailable',
          notices: { popup: [], dashboard: [] },
        });
      }
      return false;
    }
  }

  private async complete(item: RegistrationProgress, wallet: string, epoch: number) {
    const key = `${COMPLETION_PREFIX}${wallet}:${item.registrationId}`;
    let acknowledged = false;
    const claim = () => {
      if (epoch !== this.epoch) return;
      if (!this.isPopupEligible(item.registrationId)) {
        acknowledged = true;
        return;
      }
      if (this.options.storage.getItem(key)) {
        acknowledged = true;
        return;
      }
      // A hidden tab must leave the saved attempt available for a visible return or refresh.
      if (this.options.canNotify && !this.options.canNotify()) return;
      // A stable registration key also covers a temporarily missing completionEventId.
      this.options.storage.setItem(key, item.completionEventId ?? 'completed');
      this.options.onCompleted?.(
        item,
        wallet,
        () =>
          epoch === this.epoch &&
          this.state.wallet === wallet &&
          this.isPopupEligible(item.registrationId),
      );
      acknowledged = true;
    };
    if (this.options.lock) await this.options.lock(key, claim);
    else claim();
    return acknowledged;
  }
}
