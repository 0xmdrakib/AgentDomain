'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Loader2,
  X,
} from 'lucide-react';
import { useRegistrationSnapshot, useRegistrationTracker } from './registration-tracker-provider';
import {
  durationLabel,
  registrationCopy,
  registrationEstimateCopy,
  registrationPaymentStatus,
  registrationStageLabel,
  type RegistrationAccepted,
  type RegistrationProgress,
} from '@/lib/registration-progress';
import {
  noticeIsCurrent,
  type NoticeChannel,
  type RegistrationNotice,
} from '@/lib/registration-notices';
import { SUBMISSION_UNCONFIRMED_MESSAGE } from '@/lib/registration-submission';

function useRegistrationRows(channel: NoticeChannel) {
  const snapshot = useRegistrationSnapshot();
  const tracker = useRegistrationTracker();
  return snapshot.noticeConnection !== 'ready' || snapshot.connection === 'unauthorized'
    ? []
    : snapshot.notices[channel]
        .filter((notice) => noticeIsCurrent(notice))
        .map((notice) => {
          const progress = snapshot.items.find(
            (item) =>
              item.registrationId === notice.registrationId &&
              (notice.domain === null || item.domain === notice.domain),
          );
          const attempt = snapshot.attempts.find(
            (item) =>
              notice.noticeId === `client:${item.clientId}` ||
              (notice.registrationId !== null &&
                tracker.getAcceptance(item)?.registrationId === notice.registrationId),
          );
          return {
            notice,
            progress,
            accepted: attempt ? tracker.getAcceptance(attempt) : undefined,
          };
        });
}
type Row = ReturnType<typeof useRegistrationRows>[number];

function ProgressTime({ progress }: { progress: RegistrationProgress }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now === null ? null : Math.max(0, (now - Date.parse(progress.startedAt)) / 1000);
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 className="h-3 w-3" aria-hidden />
        Elapsed {elapsed === null ? '...' : durationLabel(elapsed)}
      </span>
      <span>{registrationEstimateCopy(progress.estimatedDurationSeconds, elapsed)}</span>
    </p>
  );
}

const paymentLabels: Record<RegistrationProgress['paymentStatus'], string> = {
  unknown: 'Payment status unavailable',
  pending: 'Payment pending',
  settled: 'Payment confirmed',
  not_charged: 'Not charged',
  refunded: 'Payment refunded',
};

function StatusIcon({
  progress,
  accepted,
}: {
  progress?: RegistrationProgress;
  accepted?: RegistrationAccepted;
}) {
  if (progress?.status === 'completed')
    return <Check className="h-4 w-4 text-emerald-700" aria-hidden />;
  if (
    registrationPaymentStatus(progress, accepted) === 'settled' &&
    (!progress || progress.status === 'processing')
  )
    return (
      <Loader2
        className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
    );
  return <CircleAlert className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

function NoticeDetails({ row }: { row: Row }) {
  const { notice, progress, accepted } = row;
  const unknown = notice.status === 'submission_unknown' && !progress && !accepted;
  const payment = registrationPaymentStatus(progress, accepted);
  const paymentLabel =
    payment === 'unknown' && progress?.stage === 'payment'
      ? progress.messageCode === 'PAYMENT_AUTHORIZATION_CHECK_PENDING'
        ? 'Authorization check pending'
        : progress.messageCode === 'PAYMENT_AUTHORIZATION_REVIEW_REQUIRED'
          ? 'Authorization needs review'
          : paymentLabels[payment]
      : paymentLabels[payment];
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <p role="status" className="text-sm">
        {unknown
          ? SUBMISSION_UNCONFIRMED_MESSAGE
          : progress || accepted
            ? registrationCopy(progress, accepted)
            : 'Registration status is being checked. Do not pay again.'}
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{paymentLabel}</span>
        {progress && payment !== 'unknown' && progress.status !== 'completed' && (
          <span>Current step: {registrationStageLabel(progress.stage)}</span>
        )}
      </p>
      {progress?.status === 'processing' && payment === 'settled' && (
        <ProgressTime progress={progress} />
      )}
      {(unknown || progress?.status === 'action_required') && (
        <a
          href="mailto:contact@agentdomain.app"
          className="inline-block text-xs font-medium text-primary underline underline-offset-4"
        >
          Contact support
        </a>
      )}
      {progress?.agentId && (
        <Link
          href={`/agents/${encodeURIComponent(progress.agentId)}`}
          className="inline-block text-sm text-primary underline underline-offset-4"
        >
          View identity
        </Link>
      )}
    </div>
  );
}

function DismissNotice({ notice }: { notice: RegistrationNotice }) {
  const tracker = useRegistrationTracker();
  const { noticePending } = useRegistrationSnapshot();
  const label =
    notice.channel === 'popup'
      ? 'Dismiss registration notification'
      : `Dismiss update for ${notice.domain ?? 'registration'}`;
  const pending = noticePending.includes(`${notice.channel}:${notice.noticeId}`);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={noticePending.length > 0}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      onClick={() => void tracker.dismissNotice(notice.noticeId, notice.channel)}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <X className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function NoticePagination({ channel }: { channel: NoticeChannel }) {
  const tracker = useRegistrationTracker();
  const snapshot = useRegistrationSnapshot();
  const buttonClass =
    'inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50';
  return (
    <>
      {snapshot.noticeCursors[channel] && (
        <button
          type="button"
          className={buttonClass}
          disabled={snapshot.noticePending.length > 0}
          onClick={() => void tracker.pageNotices(channel, true)}
        >
          Latest updates
        </button>
      )}
      {snapshot.noticeNextCursors[channel] && (
        <button
          type="button"
          className={buttonClass}
          disabled={snapshot.noticePending.length > 0}
          onClick={() => void tracker.pageNotices(channel)}
        >
          Older updates <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      )}
    </>
  );
}

export function RegistrationNotification() {
  const rows = useRegistrationRows('popup');
  const { noticeErrors, noticeNextCursors, noticeCursors, noticeConnection } =
    useRegistrationSnapshot();
  const [selected, setSelected] = useState('');
  const row = rows.find((item) => item.notice.noticeId === selected) ?? rows[0];
  if (!row)
    return noticeConnection === 'ready' && noticeCursors.popup ? (
      <aside
        aria-label="Registration notification"
        className="fixed bottom-3 right-3 z-40 rounded-lg border border-border bg-card p-3"
      >
        <NoticePagination channel="popup" />
      </aside>
    ) : null;
  return (
    <aside
      aria-label="Registration notification"
      data-registration-notification
      className="fixed bottom-3 right-3 z-40 max-h-[calc(100dvh-6rem)] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg md:bottom-auto md:right-6 md:top-24"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          <StatusIcon {...row} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            Registration update
            {rows.length > 1 ? `s (${rows.length}${noticeNextCursors.popup ? '+' : ''})` : ''}
          </p>
          <p className="text-sm font-semibold [overflow-wrap:anywhere]">
            {row.notice.domain ?? 'Registration'}
          </p>
        </div>
        <DismissNotice notice={row.notice} />
      </div>
      {rows.length > 1 && (
        <select
          aria-label="Select registration update"
          value={row.notice.noticeId}
          onChange={(event) => setSelected(event.target.value)}
          className="mt-2 h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm"
        >
          {rows.map(({ notice }) => (
            <option key={notice.noticeId} value={notice.noticeId}>
              {notice.domain ?? 'Registration'}
            </option>
          ))}
        </select>
      )}
      <div className="mt-2">
        <NoticeDetails row={row} />
      </div>
      {noticeErrors.popup && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {noticeErrors.popup}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <Link
          href="/dashboard"
          className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          View progress <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <NoticePagination channel="popup" />
      </div>
    </aside>
  );
}

export function DashboardRegistrationUpdates() {
  const rows = useRegistrationRows('dashboard');
  const snapshot = useRegistrationSnapshot();
  const [open, setOpen] = useState(false);
  if (
    snapshot.noticeConnection === 'unauthorized' ||
    snapshot.connection === 'unauthorized' ||
    !snapshot.wallet
  )
    return null;
  if (snapshot.noticeConnection !== 'ready')
    return snapshot.noticeConnection === 'unavailable' ||
      snapshot.noticeConnection === 'offline' ? (
      <p className="mb-4 text-xs text-muted-foreground" role="status">
        Registration updates are unavailable. Do not pay again.
      </p>
    ) : null;
  if (!rows.length && !snapshot.noticeCursors.dashboard) return null;
  return (
    <section
      aria-label="Registration updates"
      className={`mb-6 border-y border-border ${snapshot.notices.popup.length ? 'md:mr-[26rem]' : ''}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="dashboard-registration-notices"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-2 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Registration updates</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {rows.length}
          {snapshot.noticeNextCursors.dashboard ? '+' : ''}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div id="dashboard-registration-notices" className="divide-y divide-border">
          {rows.map((row) => (
            <article key={row.notice.noticeId} data-registration-pending className="py-3">
              <div className="flex items-center gap-2">
                <StatusIcon {...row} />
                <h3 className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
                  {row.notice.domain ?? 'Registration'}
                </h3>
                <DismissNotice notice={row.notice} />
              </div>
              <NoticeDetails row={row} />
            </article>
          ))}
          {snapshot.noticeErrors.dashboard && (
            <p role="alert" className="py-2 text-xs text-destructive">
              {snapshot.noticeErrors.dashboard}
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <NoticePagination channel="dashboard" />
          </div>
        </div>
      )}
    </section>
  );
}
