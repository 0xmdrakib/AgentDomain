'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Match public navigation without prefetching the owner dashboard. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { inspectAgentRenewal } from '@agentdomain/sdk';
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { baseScanLink, inspectionFailure, observationTime } from '@/lib/identity-observation';
import {
  renewalDuration,
  renewalJson,
  renewalUsdc,
  type RenewalObservation,
} from '@/lib/renewal-observation';

export function RenewalReadiness({
  tokenId,
  expectedOwner,
}: {
  tokenId: string;
  expectedOwner?: string;
}) {
  const [result, setResult] = useState<RenewalObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const inFlight = useRef(false);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  async function inspect() {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++sequence.current;
    setRunning(true);
    setResult(null);
    setError(null);
    setFeedback('');
    try {
      const observed = await inspectAgentRenewal({
        tokenId,
        ...(expectedOwner ? { expectedOwner } : {}),
      });
      if (request === sequence.current) setResult(observed);
    } catch (failure) {
      if (request === sequence.current) setError(inspectionFailure(failure));
    } finally {
      if (request === sequence.current) {
        inFlight.current = false;
        setRunning(false);
      }
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(renewalJson(result));
      setFeedback('Renewal JSON copied');
    } catch {
      setFeedback('Clipboard unavailable');
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([renewalJson(result)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agentdomain-renewal-observation.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback('Download started');
  }

  const found = result?.status === 'found' ? result : null;
  const block = result?.identity.block;
  const summary = running
    ? 'Reading renewal state'
    : error
      ? 'Renewal check unavailable'
      : !result
        ? 'Not checked'
        : !found
          ? 'Identity no longer found'
          : !found.consistent
            ? 'Renewal records differ'
            : found.identity.checks.expectedOwnerMatches === false
              ? 'Expected wallet differs'
              : 'Vault records consistent';
  const mismatch =
    found && (!found.consistent || found.identity.checks.expectedOwnerMatches === false);

  return (
    <section
      aria-labelledby="renewal-readiness-title"
      className="mt-6 min-w-0 border-t border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="renewal-readiness-title" className="text-lg font-semibold">
          Renewal readiness
        </h2>
        <Button
          type="button"
          variant="outline"
          disabled={running}
          className="min-w-40"
          onClick={() => {
            void inspect();
          }}
        >
          {running ? (
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {running ? 'Checking renewal' : 'Check renewal'}
        </Button>
      </div>
      <p
        role="status"
        className={`mt-3 text-sm ${mismatch ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {summary}
      </p>
      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 border-l-2 border-destructive py-2 pl-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      {result && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Fresh RPC observation. Minimum fee is not a registrar quote. Timing eligibility
              excludes funding and registrar completion.
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void copy();
                }}
                title="Copy renewal JSON"
                aria-label="Copy renewal JSON"
              >
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={download}
                title="Download renewal JSON"
                aria-label="Download renewal JSON"
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
          {found && (
            <>
              <dl className="mt-5 grid min-w-0 gap-5 border-y border-border py-5 sm:grid-cols-3">
                <Field label="Available USDC" mono>
                  {renewalUsdc(found.vault.availableAtomicUsdc)}
                </Field>
                <Field label="Reserved USDC" mono>
                  {renewalUsdc(found.vault.reservedAtomicUsdc)}
                </Field>
                <Field label="Minimum fee (not a quote)" mono>
                  {found.vault.minimumFeeAtomicUsdc === '0'
                    ? 'Not configured'
                    : renewalUsdc(found.vault.minimumFeeAtomicUsdc)}
                </Field>
              </dl>
              <dl className="grid min-w-0 gap-x-10 gap-y-4 py-5 md:grid-cols-2">
                <Field label="Auto-renew">
                  {found.vault.autoRenewEnabled ? 'Enabled' : 'Disabled'}
                </Field>
                <Field label="Native timing / flags">
                  {found.vault.isRenewable ? 'Eligible' : 'Not eligible'}
                </Field>
                <Field label="Renewal window">
                  {renewalDuration(found.vault.renewalWindowSeconds)}
                </Field>
                <Field label="Renewal duration">
                  {renewalDuration(found.vault.renewalDurationSeconds)}
                </Field>
                <Field label="Within renewal window">
                  {found.checks.withinRenewalWindow ? 'Yes' : 'No'}
                </Field>
                <Field label="Available covers minimum">
                  {!found.checks.minimumFeeConfigured
                    ? 'Minimum not configured'
                    : found.checks.availableCoversMinimum
                      ? 'Yes (minimum only)'
                      : 'No'}
                </Field>
                <Field label="Last onchain renewal">
                  {found.vault.lastRenewedAt === '0'
                    ? 'Not recorded'
                    : observationTime(found.vault.lastRenewedAt)}
                </Field>
                <Field label="Pending renewal">
                  {found.vault.pendingRenewal
                    ? renewalUsdc(found.vault.pendingRenewal.amountAtomicUsdc)
                    : 'None observed'}
                </Field>
                {found.vault.pendingRenewal && (
                  <>
                    <Field label="Reservation started">
                      {observationTime(found.vault.pendingRenewal.reservedAt)}
                    </Field>
                    <Field label="Reserved identity expiry">
                      {observationTime(found.vault.pendingRenewal.expiresAt)}
                    </Field>
                  </>
                )}
                <Field label="Observed domain">{found.identity.identity.domain}</Field>
                <Field label="Observed lifecycle">
                  <span className="capitalize">{found.identity.lifecycle}</span>
                </Field>
                <div className="min-w-0 md:col-span-2">
                  <Field label="Observed NFT owner" mono>
                    {found.identity.nftOwner}
                  </Field>
                </div>
              </dl>
              {found.vault.pendingRenewal && (
                <p className="mb-4 text-xs text-amber-800">
                  Disabling auto-renew does not cancel this pending reservation.
                </p>
              )}
              <ul
                className="grid gap-x-10 border-y border-border py-3 md:grid-cols-2"
                aria-label="Renewal consistency checks"
              >
                <Consistency label="Identity records" value={found.checks.identityConsistent} />
                <Consistency label="Canonical contracts" value={found.checks.canonicalContracts} />
                <Consistency label="Vault parameters" value={found.checks.parametersConsistent} />
                <Consistency
                  label="Reservation records"
                  value={found.checks.reservationConsistent}
                />
                <Consistency label="Lifecycle / timing" value={found.checks.lifecycleConsistent} />
              </ul>
            </>
          )}
          {block && (
            <>
              <div className="mt-5 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Renewal observation block</h3>
                <Button asChild variant="outline" size="icon">
                  <a
                    href={baseScanLink('block', block.hash)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View renewal block on BaseScan"
                    aria-label="View renewal block on BaseScan"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                </Button>
              </div>
              <dl className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
                <Field label="Network">Base (8453)</Field>
                <Field label="Safe block number" mono>
                  {block.number}
                </Field>
                <Field label="Safe block time">{observationTime(block.timestamp)}</Field>
                <div className="min-w-0 md:col-span-2">
                  <Field label="Safe block hash" mono>
                    {block.hash}
                  </Field>
                </div>
                <div className="min-w-0 md:col-span-2">
                  <Field label="Canonical renewal vault" mono>
                    {result.vaultAddress}
                  </Field>
                </div>
              </dl>
            </>
          )}
          {found && (
            <a
              href="/dashboard"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
            >
              Manage in dashboard
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
          )}
        </>
      )}
      <p role="status" className="min-h-6 pt-2 text-right text-xs text-muted-foreground">
        {feedback}
      </p>
    </section>
  );
}

function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}
      >
        {children}
      </dd>
    </div>
  );
}

function Consistency({ label, value }: { label: string; value: boolean }) {
  return (
    <li className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <span className={`shrink-0 text-xs ${value ? 'text-emerald-800' : 'text-destructive'}`}>
        {value ? 'Consistent' : 'Differs'}
      </span>
    </li>
  );
}
