'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, Loader2, CircleAlert } from 'lucide-react';
import { useRegistrationSnapshot, useRegistrationTracker } from './registration-tracker-provider';
import {
  attemptStartedAt,
  durationLabel,
  registrationCopy,
  type RegistrationProgress,
} from '@/lib/registration-progress';

function useRegistrationRows() {
  const snapshot = useRegistrationSnapshot();
  const tracker = useRegistrationTracker();
  const seen = new Set<string>();
  const rows = snapshot.attempts
    .map((attempt) => ({
      key: attempt.clientId,
      domain: attempt.domain,
      startedAt: attemptStartedAt(attempt),
      progress: tracker.matches(attempt),
    }))
    .filter((row) => {
      const key = row.progress?.registrationId ?? row.domain;
      if (row.progress?.status === 'completed' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { rows, connection: snapshot.connection, hasSavedAttempts: snapshot.hasSavedAttempts };
}

function ProgressTime({
  startedAt,
  progress,
}: {
  startedAt: number;
  progress?: RegistrationProgress;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = progress ? Date.parse(progress.startedAt) : startedAt;
  const elapsed = now === null ? null : Math.max(0, (now - start) / 1000);
  const estimate = progress?.estimatedDurationSeconds;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 className="h-3 w-3" aria-hidden />
        Elapsed {elapsed === null ? '...' : durationLabel(elapsed)}
      </span>
      <span>
        {estimate == null
          ? 'Timing varies; no estimate available.'
          : `Historical typical duration: ${durationLabel(estimate)}${elapsed !== null && elapsed > estimate ? '. Taking longer than typical.' : '.'}`}
      </span>
    </span>
  );
}

const paymentLabels: Record<RegistrationProgress['paymentStatus'], string> = {
  unknown: 'Payment confirmation pending',
  pending: 'Payment pending',
  settled: 'Payment settled',
  not_charged: 'Not charged',
  refunded: 'Payment refunded',
};

function ConnectionNotice({
  connection,
}: {
  connection: ReturnType<typeof useRegistrationRows>['connection'];
}) {
  if (connection === 'ready' || connection === 'loading') return null;
  return (
    <p className="text-xs text-muted-foreground">
      {connection === 'unauthorized'
        ? 'Updates paused. Sign in with the paying wallet to resume; do not pay again.'
        : connection === 'offline'
          ? 'Offline. Your registration is still being tracked; updates resume when connected.'
          : 'Updates temporarily unavailable. Your last known status is preserved; do not pay again.'}
    </p>
  );
}

export function RegistrationBanner() {
  const { rows, connection, hasSavedAttempts } = useRegistrationRows();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      document.documentElement.style.setProperty(
        '--registration-banner-height',
        `${element.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--registration-banner-height');
    };
  }, []);
  const row = rows[0];
  return (
    <div ref={ref} className="sticky top-0 z-40 w-full" data-registration-banner>
      {row && (
        <div className="border-b border-emerald-800/20 bg-background">
          <div className="container flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p role="status" className="flex items-start gap-2 text-sm font-medium">
                {row.progress?.status === 'action_required' || row.progress?.status === 'failed' ? (
                  <CircleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <Loader2
                    className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
                    aria-hidden
                  />
                )}
                <span className="wrap-anywhere">
                  {row.domain}: {registrationCopy(row.progress)}
                  {rows.length > 1 ? ` (+${rows.length - 1} more)` : ''}
                </span>
              </p>
              <ProgressTime startedAt={row.startedAt} progress={row.progress} />
              <ConnectionNotice connection={connection} />
            </div>
            <Link
              className="shrink-0 text-sm font-medium text-primary underline underline-offset-4"
              href="/dashboard"
            >
              {connection === 'unauthorized' ? 'Sign in to view progress' : 'View progress'}
            </Link>
          </div>
        </div>
      )}
      {!row && hasSavedAttempts && (
        <div className="border-b border-border bg-background">
          <div className="container flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <p role="status">
              Registration updates paused. Connect and sign in with the paying wallet; do not pay
              again.
            </p>
            <Link href="/dashboard" className="text-primary underline">
              View progress
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardRegistrationUpdates() {
  const { rows, connection } = useRegistrationRows();
  const { discoveryLimited } = useRegistrationSnapshot();
  if (!rows.length && !discoveryLimited) return null;
  return (
    <section className="mb-8 space-y-3" aria-label="Registration updates">
      <h2 className="text-lg font-semibold">Registration updates</h2>
      <ConnectionNotice connection={connection} />
      {discoveryLimited && (
        <p className="text-sm text-muted-foreground">
          Some older purchases could not be checked. Contact support if an expected registration is
          missing; do not pay again.
        </p>
      )}
      {rows.map((row) => (
        <article
          key={row.key}
          className="rounded-lg border border-border bg-card p-4"
          data-registration-pending
        >
          <div className="flex items-start gap-3">
            {row.progress &&
            ['failed', 'refunded', 'action_required'].includes(row.progress.status) ? (
              <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            )}
            <div className="min-w-0 space-y-2">
              <h3 className="wrap-anywhere font-semibold">{row.domain}</h3>
              <p role="status" className="text-sm">
                {registrationCopy(row.progress)}
              </p>
              <p className="text-xs text-muted-foreground">
                {paymentLabels[row.progress?.paymentStatus ?? 'unknown']}
              </p>
              <ProgressTime startedAt={row.startedAt} progress={row.progress} />
              {row.progress?.agentId && (
                <Link
                  href={`/agents/${encodeURIComponent(row.progress.agentId)}`}
                  className="inline-block text-sm text-primary underline underline-offset-4"
                >
                  View identity
                </Link>
              )}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
