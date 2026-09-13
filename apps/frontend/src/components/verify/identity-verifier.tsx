'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { inspectAgentIdentity } from '@agentdomain/sdk';
import {
  AlertTriangle,
  Check,
  CircleCheck,
  CircleMinus,
  CircleX,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Hash,
  LoaderCircle,
  ScanSearch,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  baseScanLink,
  inspectionFailure,
  observationJson,
  observationSummary,
  observationTime,
  type IdentityObservation,
  type IdentityInspectionInput,
  type ObservationTone,
} from '@/lib/identity-observation';

const tones: Record<ObservationTone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-emerald-800',
  warning: 'text-amber-800',
  danger: 'text-destructive',
};

export function IdentityVerifier() {
  const [mode, setMode] = useState<'domain' | 'token'>('domain');
  const [query, setQuery] = useState('');
  const [expectedOwner, setExpectedOwner] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IdentityObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const inFlight = useRef(false);
  const sequence = useRef(0);

  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  function clearObservation() {
    setResult(null);
    setError(null);
    setFeedback('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !query.trim()) return;
    inFlight.current = true;
    const request = ++sequence.current;
    const input: IdentityInspectionInput = {
      ...(mode === 'domain' ? { domain: query.trim() } : { tokenId: query.trim() }),
      ...(expectedOwner.trim() ? { expectedOwner: expectedOwner.trim() } : {}),
    };
    clearObservation();
    setRunning(true);
    try {
      const observation = await inspectAgentIdentity(input);
      if (request === sequence.current) setResult(observation);
    } catch (failure) {
      if (request === sequence.current) setError(inspectionFailure(failure));
    } finally {
      if (request === sequence.current) {
        inFlight.current = false;
        setRunning(false);
      }
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(observationJson(result));
      setFeedback('JSON copied');
    } catch {
      setFeedback('Clipboard unavailable');
    }
  }

  function downloadResult() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([observationJson(result)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agentdomain-identity-observation.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback('Download started');
  }

  return (
    <div className="min-w-0">
      <form onSubmit={submit} className="border-b border-border pb-8">
        <fieldset disabled={running} className="min-w-0">
          <legend className="sr-only">Identity lookup</legend>
          <div
            className="mb-5 inline-grid w-64 max-w-full grid-cols-2 rounded-md border border-input p-1"
            role="group"
            aria-label="Lookup mode"
          >
            {(['domain', 'token'] as const).map((value) => {
              const Icon = value === 'domain' ? Globe : Hash;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  className={`flex h-9 items-center justify-center gap-2 rounded text-sm transition-colors disabled:opacity-60 ${mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                  onClick={() => {
                    setMode(value);
                    setQuery('');
                    clearObservation();
                  }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {value === 'domain' ? 'Domain' : 'Token ID'}
                </button>
              );
            })}
          </div>
          <div className="grid min-w-0 items-end gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="identity-query">{mode === 'domain' ? 'Domain' : 'Token ID'}</Label>
              <Input
                id="identity-query"
                name={mode === 'domain' ? 'domain' : 'tokenId'}
                required
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                inputMode={mode === 'token' ? 'numeric' : 'text'}
                value={query}
                placeholder={mode === 'domain' ? 'example.xyz' : '1'}
                className="h-12 bg-card/60"
                onChange={(event) => {
                  setQuery(event.target.value);
                  clearObservation();
                }}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="identity-expected-owner">
                Expected wallet{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="identity-expected-owner"
                name="expectedOwner"
                value={expectedOwner}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x..."
                className="h-12 bg-card/60 font-mono text-sm"
                onChange={(event) => {
                  setExpectedOwner(event.target.value);
                  clearObservation();
                }}
              />
            </div>
            <Button type="submit" disabled={running || !query.trim()} className="h-12 min-w-44">
              {running ? (
                <LoaderCircle
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Search className="h-4 w-4" aria-hidden />
              )}
              {running ? 'Checking' : 'Check identity'}
            </Button>
          </div>
        </fieldset>
      </form>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {running
          ? 'Checking identity'
          : (error ?? (result ? observationSummary(result).label : ''))}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-3 border-l-2 border-destructive py-3 pl-4 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Check unavailable</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}
      {!result && !error && (
        <div
          className="flex min-h-56 flex-col items-center justify-center gap-3 py-10 text-muted-foreground"
          aria-busy={running}
        >
          {running ? (
            <LoaderCircle className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <ScanSearch className="h-7 w-7" aria-hidden />
          )}
          <p className="text-sm">{running ? 'Reading safe block' : 'No observation'}</p>
        </div>
      )}
      {result && (
        <Observation
          result={result}
          onCopy={() => {
            void copyResult();
          }}
          onDownload={downloadResult}
        />
      )}
      <p role="status" className="min-h-6 pt-2 text-right text-xs text-muted-foreground">
        {feedback}
      </p>
    </div>
  );
}

function Observation({
  result,
  onCopy,
  onDownload,
}: {
  result: IdentityObservation;
  onCopy(): void;
  onDownload(): void;
}) {
  const summary = observationSummary(result);
  const found = result.status === 'found';
  return (
    <section aria-labelledby="observation-title" className="min-w-0 pt-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className={`mb-2 flex items-center gap-2 text-sm font-medium ${tones[summary.tone]}`}
          >
            {summary.tone === 'success' ? (
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
            ) : summary.tone === 'danger' ? (
              <CircleX className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CircleMinus className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{summary.label}</span>
          </div>
          <h2 id="observation-title" className="text-xl font-semibold [overflow-wrap:anywhere]">
            {found
              ? result.identity.domain
              : (result.input.domain ?? `Token ${result.input.tokenId}`)}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2" aria-label="Observation actions">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onCopy}
            title="Copy JSON"
            aria-label="Copy JSON"
          >
            <Copy className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onDownload}
            title="Download JSON"
            aria-label="Download JSON"
          >
            <Download className="h-4 w-4" aria-hidden />
          </Button>
          {found && (
            <ExplorerLink
              href={baseScanLink('token', result.registryAddress, result.tokenId)}
              label="View token on BaseScan"
            />
          )}
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Fixed-block RPC observation. Not consensus/SPV, DNS or KYC proof. Names and metadata are
        recorded claims.
      </p>

      {found && (
        <>
          <div className="mt-6 grid min-w-0 gap-x-10 border-y border-border py-5 md:grid-cols-2">
            <dl className="min-w-0 space-y-4">
              <Datum label="Lifecycle">
                <span
                  className={`capitalize font-medium ${result.lifecycle === 'active' ? 'text-emerald-800' : result.lifecycle === 'expired' ? 'text-amber-800' : 'text-destructive'}`}
                >
                  {result.lifecycle}
                </span>
              </Datum>
              <Datum label="Token ID" mono>
                {result.tokenId}
              </Datum>
              <Datum label="NFT owner" mono>
                {result.nftOwner}
              </Datum>
              <Datum label="Recorded owner" mono>
                {result.identity.owner}
              </Datum>
              {result.input.expectedOwner && (
                <Datum label="Expected wallet" mono>
                  {result.input.expectedOwner}
                </Datum>
              )}
            </dl>
            <dl className="mt-4 min-w-0 space-y-4 md:mt-0">
              <Datum label="Basename">{result.identity.basename || 'Not recorded'}</Datum>
              <Datum label="ENS name">{result.identity.ensName || 'Not recorded'}</Datum>
              <Datum label="Created">{observationTime(result.identity.createdAt)}</Datum>
              <Datum label="Expires">{observationTime(result.identity.expiresAt)}</Datum>
            </dl>
          </div>
          <div className="py-6">
            <h3 className="mb-3 text-sm font-semibold">Consistency checks</h3>
            <ul className="grid gap-x-10 md:grid-cols-2">
              <CheckRow label="Recorded owner / NFT owner" value={result.checks.ownerConsistent} />
              <CheckRow label="Domain lookup" value={result.checks.domainConsistent} />
              <CheckRow label="Metadata URI" value={result.checks.metadataConsistent} />
              <CheckRow label="Lifecycle" value={result.checks.lifecycleConsistent} />
              <CheckRow label="Expected wallet" value={result.checks.expectedOwnerMatches} />
            </ul>
          </div>
          <dl className="space-y-4 border-y border-border py-5">
            <Datum label="Recorded metadata URI" mono>
              {result.identity.metadataUri || 'Not recorded'}
            </Datum>
            <Datum label="Token metadata URI" mono>
              {result.metadataUri || 'Not recorded'}
            </Datum>
          </dl>
        </>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Safe block observation</h3>
        <ExplorerLink
          href={baseScanLink('block', result.block.hash)}
          label="View block on BaseScan"
        />
      </div>
      <dl className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
        <Datum label="Block number" mono>
          {result.block.number}
        </Datum>
        <Datum label="Block time">{observationTime(result.block.timestamp)}</Datum>
        <div className="min-w-0 md:col-span-2">
          <Datum label="Block hash" mono>
            {result.block.hash}
          </Datum>
        </div>
        <div className="min-w-0 md:col-span-2">
          <Datum label="Registry" mono>
            {result.registryAddress}
          </Datum>
        </div>
      </dl>
    </section>
  );
}

function Datum({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
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

function CheckRow({ label, value }: { label: string; value: boolean | null }) {
  const Icon = value === true ? Check : value === false ? CircleX : CircleMinus;
  return (
    <li className="flex min-h-11 items-center justify-between gap-4 border-b border-border/60 py-2 text-sm">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${value === true ? 'text-emerald-800' : value === false ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {value === true ? 'Match' : value === false ? 'Mismatch' : 'Not requested'}
      </span>
    </li>
  );
}

function ExplorerLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <Button asChild variant="outline" size="icon">
      <a href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}>
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
    </Button>
  );
}
