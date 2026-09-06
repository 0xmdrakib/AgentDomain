'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { toast, Toaster } from 'sonner';
import { useRouter } from 'next/navigation';
import { RegistrationTracker, EMPTY_REGISTRATION_SNAPSHOT } from '@/lib/registration-tracker';
import {
  ATTEMPT_PREFIX,
  COMPLETION_PREFIX,
  REGISTRATION_CHANGED_EVENT,
  REGISTRATION_POLL_MS,
  REGISTRATION_BACKOFF_PREFIX,
  REGISTRATION_NOTICE_PREFIX,
} from '@/lib/registration-progress';
import { REGISTRATION_SUBMISSION_PREFIX } from '@/lib/registration-submission';
import { RegistrationNotification } from './registration-updates';

const TrackerContext = createContext<RegistrationTracker | null>(null);
const isApplicationHost = () =>
  ['agentdomain.app', 'www.agentdomain.app', 'localhost', '127.0.0.1', '[::1]'].includes(
    window.location.hostname,
  );
const browserStorage: Storage = {
  get length() {
    return window.localStorage.length;
  },
  key: (index) => window.localStorage.key(index),
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
  clear: () => {
    /* The tracker never clears unrelated browser state. */
  },
};

export function RegistrationTrackerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [tracker] = useState<RegistrationTracker>(
    () =>
      new RegistrationTracker({
        storage: browserStorage,
        online: () => navigator.onLine,
        enabled: isApplicationHost,
        canNotify: () => document.visibilityState === 'visible',
        lock: (key, callback) =>
          navigator.locks ? navigator.locks.request(key, callback) : Promise.resolve(callback()),
        onCompleted: (item, wallet) => {
          const id = `registration:${wallet}:${item.registrationId}`;
          toast.success(`${item.domain} registration complete`, {
            id,
            action: item.agentId
              ? {
                  label: 'View identity',
                  onClick: () => {
                    if (!toast.getToasts().some((active) => active.id === id)) return;
                    router.push(`/agents/${encodeURIComponent(item.agentId!)}`);
                  },
                }
              : undefined,
          });
        },
        onResolved: (items, wallet) => {
          window.dispatchEvent(
            new CustomEvent(REGISTRATION_CHANGED_EVENT, {
              detail: { wallet, agentIds: items.map((item) => item.agentId) },
            }),
          );
        },
      }),
  );

  useEffect(() => {
    // Customer identity hosts must not become purchase-management surfaces.
    if (!isApplicationHost()) return;
    let timer: number | undefined;
    let stopped = false;
    const dismissRegistrationToasts = (wallet: string | null) => {
      for (const { id } of toast.getToasts()) {
        if (typeof id !== 'string' || !id.startsWith('registration:')) continue;
        if (wallet && id.startsWith(`registration:${wallet}:`)) continue;
        toast.dismiss(id);
      }
    };
    const refresh = () => {
      if (stopped) return;
      void tracker.refresh().finally(schedule);
    };
    const sessionChanged = () => {
      tracker.invalidate();
      refresh();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key?.startsWith(REGISTRATION_NOTICE_PREFIX)) {
        tracker.hydrate();
        return;
      }
      if (
        event.key?.startsWith(ATTEMPT_PREFIX) ||
        event.key?.startsWith(COMPLETION_PREFIX) ||
        event.key?.startsWith(REGISTRATION_BACKOFF_PREFIX) ||
        event.key?.startsWith(REGISTRATION_SUBMISSION_PREFIX)
      )
        refresh();
    };
    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      const snapshot = tracker.getSnapshot();
      const wallet = snapshot.connection === 'unauthorized' ? null : snapshot.wallet;
      dismissRegistrationToasts(wallet);
      if (
        snapshot.connection === 'unauthorized' ||
        (!snapshot.attempts.length && snapshot.discoveryComplete)
      )
        return;
      const delay = Math.min(
        ...(!snapshot.discoveryComplete || !snapshot.attempts.length
          ? [REGISTRATION_POLL_MS / 1000]
          : []),
        ...snapshot.attempts.map(
          (attempt) => tracker.matches(attempt)?.pollAfterSeconds ?? REGISTRATION_POLL_MS / 1000,
        ),
      );
      timer = window.setTimeout(refresh, tracker.getNextPollDelay(delay * 1000));
    };
    const unsubscribe = tracker.subscribe(schedule);
    tracker.hydrate();
    refresh();
    window.addEventListener('agentdomain:session-changed', sessionChanged);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('storage', storageChanged);
    return () => {
      stopped = true;
      unsubscribe();
      dismissRegistrationToasts(null);
      window.clearTimeout(timer);
      tracker.invalidate();
      window.removeEventListener('agentdomain:session-changed', sessionChanged);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('storage', storageChanged);
    };
  }, [tracker]);

  return (
    <TrackerContext.Provider value={tracker}>
      <RegistrationNotification />
      {children}
      <Toaster position="bottom-right" theme="light" richColors />
    </TrackerContext.Provider>
  );
}

export function useRegistrationTracker() {
  const tracker = useContext(TrackerContext);
  if (!tracker) throw new Error('Registration tracker is not mounted.');
  return tracker;
}

export function useRegistrationSnapshot() {
  const tracker = useRegistrationTracker();
  return useSyncExternalStore(
    tracker.subscribe,
    tracker.getSnapshot,
    () => EMPTY_REGISTRATION_SNAPSHOT,
  );
}
