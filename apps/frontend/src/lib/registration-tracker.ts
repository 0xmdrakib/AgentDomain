import {
  ATTEMPT_PREFIX,
  COMPLETION_PREFIX,
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
import { submissionReviewRequired } from './registration-submission';

export type TrackingConnection = 'loading' | 'ready' | 'offline' | 'unauthorized' | 'unavailable';
export interface RegistrationSnapshot {
  wallet: string | null;
  items: RegistrationProgress[];
  attempts: RegistrationAttempt[];
  connection: TrackingConnection;
  hasSavedAttempts: boolean;
  discoveryComplete: boolean;
  discoveryLimited: boolean;
}
export const EMPTY_REGISTRATION_SNAPSHOT: RegistrationSnapshot = {
  wallet: null,
  items: [],
  attempts: [],
  connection: 'loading',
  hasSavedAttempts: false,
  discoveryComplete: false,
  discoveryLimited: false,
};

interface TrackerOptions {
  storage: Storage;
  fetcher?: typeof fetch;
  online?: () => boolean;
  enabled?: () => boolean;
  onCompleted?: (item: RegistrationProgress, wallet: string) => void;
  onResolved?: (items: RegistrationProgress[], wallet: string) => void;
  lock?: (key: string, callback: () => void) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export class RegistrationTracker {
  private state = EMPTY_REGISTRATION_SNAPSHOT;
  private listeners = new Set<() => void>();
  private accepted = new Map<string, RegistrationAccepted>();
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
    return `${attempt.wallet}:${attempt.clientId}`;
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
          const parsed = registrationAttemptSchema.safeParse(
            JSON.parse(this.options.storage.getItem(key) ?? 'null'),
          );
          if (parsed.success) attempts.push(parsed.data);
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
    const key = `${ATTEMPT_PREFIX}${clean.clientId}`;
    const value = JSON.stringify(clean);
    this.options.storage.setItem(key, value);
    if (this.options.storage.getItem(key) !== value)
      throw new Error('Unable to save registration tracking.');
    if (this.expectedWallet === undefined || this.expectedWallet === clean.wallet)
      this.update({ wallet: clean.wallet });
    this.hydrate();
  }

  accept(attempt: RegistrationAttempt, accepted: RegistrationAccepted | null) {
    if (accepted?.domain === attempt.domain) this.accepted.set(this.attemptKey(attempt), accepted);
    void this.refresh();
  }

  matches(attempt: RegistrationAttempt) {
    if (attempt.wallet !== this.state.wallet) return undefined;
    const accepted = this.accepted.get(this.attemptKey(attempt));
    return accepted
      ? this.state.items.find((item) => item.registrationId === accepted.registrationId)
      : matchAttempt(attempt, this.state.items);
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
    this.controller?.abort();
    this.inFlight = undefined;
    this.lastAuthenticatedRead = undefined;
    this.update({ connection: this.expectedWallet ? 'loading' : 'unauthorized' });
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
        this.update({ connection: 'offline' });
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
        // Revision belongs to the workflow; payment/refund observations can change without incrementing it.
        if (!previous || canAdvanceRegistration(previous, item)) {
          const next =
            previous?.completionEventId && !item.completionEventId
              ? { ...item, completionEventId: previous.completionEventId }
              : item;
          merged.set(item.registrationId, next);
          if (previous && !isRegistrationTerminal(previous) && isRegistrationTerminal(item))
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
      // Discover purchases from the payer's server list, including another browser's work.
      for (const item of this.state.items) {
        if (
          isRegistrationTerminal(item) ||
          this.state.attempts.some((attempt) => attempt.domain === item.domain)
        )
          continue;
        this.remember({
          wallet: session.wallet,
          domain: item.domain,
          clientId: `${Date.parse(item.startedAt)}-${item.registrationId}`,
        });
      }
      for (const attempt of [...this.state.attempts]) {
        const item = this.matches(attempt);
        if (!item || !isRegistrationTerminal(item)) continue;
        if (item.status === 'completed') await this.complete(item, session.wallet, epoch);
        if (epoch !== this.epoch) return false;
        resolved.set(item.registrationId, item);
        this.options.storage.removeItem(`${ATTEMPT_PREFIX}${attempt.clientId}`);
        this.accepted.delete(this.attemptKey(attempt));
      }
      this.hydrate();
      if (resolved.size) this.options.onResolved?.([...resolved.values()], session.wallet);
      return !detailUnavailable;
    } catch (error) {
      if (epoch === this.epoch) {
        if (payer && !(error instanceof RegistrationReadError && error.kind === 'unauthorized'))
          await this.deferRead(error, payer);
        if (epoch !== this.epoch) return false;
        this.update({
          connection: error instanceof RegistrationReadError ? error.kind : 'unavailable',
        });
      }
      return false;
    }
  }

  private async complete(item: RegistrationProgress, wallet: string, epoch: number) {
    const key = `${COMPLETION_PREFIX}${wallet}:${item.registrationId}`;
    const claim = () => {
      if (epoch !== this.epoch || this.options.storage.getItem(key)) return;
      // A stable registration key also covers a temporarily missing completionEventId.
      this.options.storage.setItem(key, item.completionEventId ?? 'completed');
      this.options.onCompleted?.(item, wallet);
    };
    if (this.options.lock) await this.options.lock(key, claim);
    else claim();
  }
}
