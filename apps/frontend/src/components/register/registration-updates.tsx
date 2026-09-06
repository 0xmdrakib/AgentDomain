'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock3, Loader2, CircleAlert, ArrowRight, X } from 'lucide-react';
import { useRegistrationSnapshot, useRegistrationTracker } from './registration-tracker-provider';
import {
  attemptStartedAt,
  durationLabel,
  registrationCopy,
  registrationEstimateCopy,
  registrationPaymentStatus,
  registrationNoticeEligible,
  registrationStageLabel,
  type RegistrationAccepted,
  type RegistrationProgress,
} from '@/lib/registration-progress';
import { SUBMISSION_UNCONFIRMED_MESSAGE } from '@/lib/registration-submission';

function useRegistrationRows() {
  const snapshot = useRegistrationSnapshot();
  const tracker = useRegistrationTracker();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!snapshot.attempts.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.attempts.length]);
  const seen = new Set<string>();
  const rows = snapshot.attempts
    .map((attempt) => ({
      key: attempt.clientId,
      attempt,
      domain: attempt.domain,
      startedAt: attemptStartedAt(attempt),
      progress: tracker.matches(attempt),
      accepted: tracker.getAcceptance(attempt),
      dismissed: tracker.isNoticeDismissed(attempt),
      unconfirmed: now !== null && tracker.isSubmissionUnconfirmed(attempt, now),
    }))
    .filter((row) => {
      const key = row.progress?.registrationId ?? row.domain;
      if (row.progress?.status === 'completed' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    rows,
    connection: snapshot.connection,
  };
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
      <span>{registrationEstimateCopy(estimate, elapsed)}</span>
    </span>
  );
}

const paymentLabels: Record<RegistrationProgress['paymentStatus'], string> = {
  unknown: 'Payment status unavailable',
  pending: 'Payment pending',
  settled: 'Payment confirmed',
  not_charged: 'Not charged',
  refunded: 'Payment refunded',
};

function RegistrationStatusDetails({
  progress,
  accepted,
}: {
  progress?: RegistrationProgress;
  accepted?: RegistrationAccepted;
}) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{paymentLabels[registrationPaymentStatus(progress, accepted)]}</span>
      {progress && registrationPaymentStatus(progress, accepted) !== 'unknown' && (
        <span>Current step: {registrationStageLabel(progress.stage)}</span>
      )}
    </p>
  );
}

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

function UnconfirmedSubmissionNotice() {
  return (
    <div className="space-y-2 text-xs text-muted-foreground" data-registration-unconfirmed>
      <p>{SUBMISSION_UNCONFIRMED_MESSAGE}</p>
      <a
        href="mailto:contact@agentdomain.app"
        className="inline-block font-medium text-primary underline underline-offset-4"
      >
        Contact support
      </a>
    </div>
  );
}

export function RegistrationNotification() {
  const { rows, connection } = useRegistrationRows();
  const tracker = useRegistrationTracker();
  const notices = rows.filter(
    (row) => !row.dismissed && registrationNoticeEligible(row.progress, row.accepted),
  );
  const row = notices[0];
  if (!row || connection === 'unauthorized') return null;
  const settled = registrationPaymentStatus(row.progress, row.accepted) === 'settled';
  const processing = settled && (!row.progress || row.progress.status === 'processing');
  return (
    <aside
      aria-label="Registration notification"
      className="fixed right-3 top-20 z-40 max-h-[calc(100dvh-6rem)] w-[calc(100%-1.5rem)] min-w-[min(18rem,calc(100%-1.5rem))] max-w-sm overflow-y-auto rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg sm:right-6 sm:top-24"
      data-registration-notification
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {processing ? (
            <Loader2
              className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <CircleAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Registration update</p>
          <p className="wrap-anywhere text-sm font-semibold">{row.domain}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss registration notification"
          title="Dismiss registration notification"
          className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => tracker.dismissNotices(notices.map((notice) => notice.attempt))}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 space-y-2">
        <p role="status" className="wrap-anywhere text-sm">
          {registrationCopy(row.progress, row.accepted)}
        </p>
        <RegistrationStatusDetails progress={row.progress} accepted={row.accepted} />
        {settled && <ProgressTime startedAt={row.startedAt} progress={row.progress} />}
        <ConnectionNotice connection={connection} />
        {row.unconfirmed && <UnconfirmedSubmissionNotice />}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Link
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/dashboard"
        >
          View progress <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        {notices.length > 1 && (
          <span className="text-xs text-muted-foreground">+{notices.length - 1} more</span>
        )}
      </div>
    </aside>
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
            {registrationPaymentStatus(row.progress, row.accepted) !== 'settled' ||
            (row.progress &&
              ['failed', 'refunded', 'action_required'].includes(row.progress.status)) ? (
              <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            )}
            <div className="min-w-0 space-y-2">
              <h3 className="wrap-anywhere font-semibold">{row.domain}</h3>
              <p role="status" className="text-sm">
                {registrationCopy(row.progress, row.accepted)}
              </p>
              <RegistrationStatusDetails progress={row.progress} accepted={row.accepted} />
              {registrationPaymentStatus(row.progress, row.accepted) === 'settled' && (
                <ProgressTime startedAt={row.startedAt} progress={row.progress} />
              )}
              {row.unconfirmed && <UnconfirmedSubmissionNotice />}
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
