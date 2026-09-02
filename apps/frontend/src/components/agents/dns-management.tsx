'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  DNS_RECORD_TYPES,
  type DnsRecordData,
  type DnsRecordType,
  type DnsServiceParam,
} from '@agentdomain/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Braces,
  Download,
  Edit2,
  FileCode2,
  FileUp,
  GitMerge,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';
import { useSiwe } from '@/hooks/use-siwe';

interface DnsRecord {
  id: string;
  type: DnsRecordType;
  name: string;
  value: string;
  data?: DnsRecordData | null;
  ttl: number;
  priority?: number | null;
  systemManaged?: boolean;
  purpose?: string | null;
}

interface DnsFormState {
  id?: string;
  type: DnsRecordType;
  name: string;
  ttl: number;
  address: string;
  target: string;
  flag: 0 | 128;
  tag: 'issue' | 'issuewild' | 'iodef';
  caaValue: string;
  priority: number;
  exchange: string;
  nameserver: string;
  pointer: string;
  weight: number;
  port: number;
  usage: number;
  selector: number;
  matchingType: number;
  associationData: string;
  text: string;
  params: DnsServiceParam[];
}

interface BulkPreview {
  baseRevision: string;
  summary: {
    add: number;
    update: number;
    delete: number;
    unchanged: number;
    finalUserRecords: number;
  };
  warnings: string[];
}

interface HostingTransition {
  mode: 'managed' | 'external';
  status: 'ready' | 'pending';
  warning?: string;
}

export function DnsManagement({
  agentId,
  initialDns,
}: {
  agentId: string;
  initialDns: DnsRecord[];
}) {
  const { isConnected } = useAccount();
  const { session, signIn, loading: authLoading } = useSiwe();
  const [records, setRecords] = useState<DnsRecord[]>(initialDns);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sslLoading, setSslLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DnsRecord | null>(null);
  const externalApexActive = records.some(isExternalApexRecord);

  const [form, setForm] = useState<DnsFormState>(emptyDnsForm());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEditor, setBulkEditor] = useState<'zone' | 'json'>('zone');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMode, setBulkMode] = useState<'merge' | 'replace'>('merge');
  const [zoneFile, setZoneFile] = useState('');
  const [jsonRecords, setJsonRecords] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  const openAdd = () => {
    setForm(emptyDnsForm());
    setIsEditing(false);
    setError(null);
    setIsModalOpen(true);
  };

  const openEdit = (record: DnsRecord) => {
    if (record.systemManaged) {
      toast.info('System-managed record', {
        description: 'SSL/email automation owns this DNS record, so it is read-only here.',
      });
      return;
    }
    setForm(formFromRecord(record));
    setIsEditing(true);
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleSubmit = async (e?: React.FormEvent, addAnother = false) => {
    e?.preventDefault();
    if (!(await ensureSignedIn())) return;
    setLoading(true);
    setError(null);

    try {
      const url = isEditing
        ? `/api/v1/agents/${agentId}/dns/${form.id}`
        : `/api/v1/agents/${agentId}/dns`;

      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          name: form.name,
          data: dataFromForm(form),
          ttl: Number(form.ttl),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const detail =
          typeof data?.details === 'string'
            ? data.details
            : data?.details && typeof data.details === 'object' && 'message' in data.details
              ? String((data.details as { message?: unknown }).message ?? '')
              : '';
        throw new Error(`${data.message || 'Failed to save record'}${detail ? `: ${detail}` : ''}`);
      }

      const savedRecord = await res.json();

      if (isEditing) {
        setRecords(records.map((r) => (r.id === savedRecord.id ? savedRecord : r)));
      } else {
        setRecords([...records, savedRecord]);
      }

      const isApexRoutingChange =
        ['A', 'AAAA', 'ALIAS', 'CNAME'].includes(savedRecord.type) && savedRecord.name === '@';
      showHostingTransitionToast(savedRecord.hosting, {
        title: isApexRoutingChange ? 'Apex routing updated' : 'DNS record saved',
        description: isApexRoutingChange
          ? `AgentDomain routing has been detached. Existing DNS/browser caches may show the previous site for up to ${formatTtl(savedRecord.ttl)}.`
          : undefined,
      });

      if (addAnother) {
        setForm({ ...emptyDnsForm(), type: form.type, ttl: form.ttl });
        setIsEditing(false);
        toast.success('DNS record saved', { description: 'The form is ready for another record.' });
      } else {
        closeModal();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    if (!(await ensureSignedIn())) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/dns/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          typeof data?.details === 'string'
            ? data.details
            : data?.details && typeof data.details === 'object' && 'message' in data.details
              ? String((data.details as { message?: unknown }).message ?? '')
              : '';
        throw new Error(
          `${data?.message || `Failed to delete record (HTTP ${res.status})`}${detail ? `: ${detail}` : ''}`,
        );
      }
      setRecords(records.filter((r) => r.id !== deleteTarget.id));
      showHostingTransitionToast(data?.hosting, { title: 'DNS record deleted' });
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('Delete failed', { description: err.message || 'Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const requestDelete = (record: DnsRecord) => {
    if (record.systemManaged) {
      toast.error('System-managed record', {
        description: 'This record protects SSL/email/DNS automation and cannot be deleted here.',
      });
      return;
    }
    setDeleteTarget(record);
  };

  const handleSslConfigure = async () => {
    if (!(await ensureSignedIn())) return;
    setSslLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/ssl`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          typeof data?.details === 'string'
            ? data.details
            : data?.details && typeof data.details === 'object' && 'message' in data.details
              ? String((data.details as { message?: unknown }).message ?? '')
              : '';
        throw new Error(`${data?.message ?? `HTTP ${res.status}`}${detail ? `: ${detail}` : ''}`);
      }
      toast.success('SSL reconfigured', {
        description: 'Validation DNS records were synced. Cloudflare may still take a few minutes.',
      });
      window.location.reload();
    } catch (err: any) {
      toast.error('SSL configure failed', {
        description: friendlyError(err.message || 'Please try again in a few minutes.'),
      });
    } finally {
      setSslLoading(false);
    }
  };

  const ensureSignedIn = async () => {
    if (session.authenticated) return true;
    if (!isConnected) {
      toast.error('Connect wallet first', {
        description: 'DNS and SSL changes require the owner wallet or an API key.',
      });
      return false;
    }
    const ok = await signIn();
    if (!ok) {
      toast.error('Sign-in failed', {
        description: 'Please approve the wallet signature and try again.',
      });
      return false;
    }
    const sessionRes = await fetch('/api/v1/auth/session', { credentials: 'include' });
    const refreshed = await sessionRes.json().catch(() => null);
    if (!refreshed?.authenticated) {
      toast.error('Sign-in failed', {
        description: 'Could not confirm the signed session. Please try again.',
      });
      return false;
    }
    return true;
  };

  const openBulk = (editor: 'zone' | 'json') => {
    setBulkEditor(editor);
    setZoneFile('');
    setJsonRecords('');
    setBulkMode('merge');
    setBulkPreview(null);
    setReplaceConfirmed(false);
    setError(null);
    setBulkOpen(true);
  };

  const bulkRequest = () => {
    if (bulkEditor === 'zone') return { zoneFile, mode: bulkMode };
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRecords) as unknown;
    } catch {
      throw new Error('JSON syntax is invalid. Check the record structure and try again.');
    }
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'records' in parsed
        ? (parsed as { records: unknown }).records
        : null;
    if (!Array.isArray(records)) {
      throw new Error(
        'JSON batch must be an array of DNS records or an object with a records array.',
      );
    }
    return { records, mode: bulkMode };
  };

  const previewBulk = async () => {
    if (!(await ensureSignedIn())) return;
    setBulkLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/agents/${agentId}/dns/${bulkEditor === 'zone' ? 'import' : 'batch'}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bulkRequest(), dryRun: true }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Could not preview these DNS changes'));
      setBulkPreview(data as BulkPreview);
      setReplaceConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview these DNS changes');
    } finally {
      setBulkLoading(false);
    }
  };

  const applyBulk = async () => {
    if (
      !bulkPreview ||
      (bulkMode === 'replace' && bulkPreview.summary.delete > 0 && !replaceConfirmed)
    ) {
      return;
    }
    if (!(await ensureSignedIn())) return;
    setBulkLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/agents/${agentId}/dns/${bulkEditor === 'zone' ? 'import' : 'batch'}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...bulkRequest(),
            dryRun: false,
            baseRevision: bulkPreview.baseRevision,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Could not apply DNS changes'));
      if (Array.isArray(data?.records)) setRecords(data.records as DnsRecord[]);
      setBulkOpen(false);
      showHostingTransitionToast(data?.hosting, {
        title: 'DNS changes applied',
        description: `${bulkPreview.summary.add} added, ${bulkPreview.summary.update} updated, ${bulkPreview.summary.delete} removed.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply DNS changes');
    } finally {
      setBulkLoading(false);
    }
  };

  const exportZone = async () => {
    if (!(await ensureSignedIn())) return;
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/dns/export?scope=user`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(data, 'Could not export DNS records'));
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'dns-zone.txt';
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  };

  return (
    <Card className="premium-surface mb-6">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-lg">DNS Records</h2>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSslConfigure}
              disabled={sslLoading || externalApexActive}
              title={
                externalApexActive
                  ? 'SSL is controlled by the external apex hosting provider'
                  : 'Reconfigure AgentDomain-managed SSL'
              }
              className="col-span-2 w-full gap-2 sm:col-span-1 sm:w-auto"
            >
              {sslLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {externalApexActive ? 'External SSL' : 'Reconfigure SSL'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportZone}
              className="w-full gap-2 sm:w-auto"
            >
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openBulk('zone')}
              className="w-full gap-2 sm:w-auto"
            >
              <FileUp className="h-4 w-4" /> Import zone
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openBulk('json')}
              className="w-full gap-2 sm:w-auto"
            >
              <Layers3 className="h-4 w-4" /> Add multiple
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openAdd}
              className="col-span-2 w-full gap-2 sm:col-span-1 sm:w-auto"
            >
              <Plus className="h-4 w-4" /> Add Record
            </Button>
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Value</th>
                <th className="pb-2 pr-4">TTL</th>
                <th className="pb-2 pr-4">Managed</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-muted-foreground">
                    No DNS records found.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border/40 hover:bg-primary/5 transition-colors"
                  >
                    <td className="py-3 pr-4 font-mono text-xs">{r.type}</td>
                    <td className="py-3 pr-4 font-mono text-xs truncate max-w-[150px]">{r.name}</td>
                    <td
                      className="py-3 pr-4 font-mono text-xs truncate max-w-[300px]"
                      title={r.value}
                    >
                      {r.value}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">{r.ttl}</td>
                    <td className="py-3 pr-4 text-xs">
                      {r.systemManaged ? (r.purpose ?? 'system') : 'user'}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(r)}
                          disabled={r.systemManaged}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/50 text-muted-foreground transition hover:bg-background hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-muted-foreground"
                          title={
                            r.systemManaged ? 'System-managed DNS records are read-only' : 'Edit'
                          }
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => requestDelete(r)}
                          disabled={r.systemManaged}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/50 text-muted-foreground transition hover:bg-background hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-muted-foreground"
                          title={
                            r.systemManaged
                              ? 'System-managed DNS records cannot be deleted'
                              : 'Delete'
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {records.length === 0 ? (
            <div className="rounded-lg border border-border/40 py-6 text-center text-sm text-muted-foreground">
              No DNS records found.
            </div>
          ) : (
            records.map((r) => (
              <div key={r.id} className="premium-surface rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                        {r.type}
                      </span>
                      <span className="wrap-anywhere font-mono text-sm">{r.name}</span>
                    </div>
                    <div className="wrap-anywhere mt-2 font-mono text-xs text-muted-foreground">
                      {r.value}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEdit(r)}
                      disabled={r.systemManaged}
                      className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                      title={r.systemManaged ? 'System-managed DNS records are read-only' : 'Edit'}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => requestDelete(r)}
                      disabled={r.systemManaged}
                      className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                      title={
                        r.systemManaged ? 'System-managed DNS records cannot be deleted' : 'Delete'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>TTL {r.ttl}</span>
                  <span>{r.systemManaged ? (r.purpose ?? 'system') : 'user'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 sm:backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dns-record-dialog-title"
              className="safe-bottom premium-surface max-h-[94svh] w-full overflow-hidden rounded-t-lg border shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:max-w-2xl sm:rounded-lg sm:zoom-in-95"
            >
              <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 p-4">
                <h3 id="dns-record-dialog-title" className="font-semibold text-lg">
                  {isEditing ? 'Edit Record' : 'Add Record'}
                </h3>
                <button
                  onClick={closeModal}
                  className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close DNS record editor"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={handleSubmit}
                className="max-h-[calc(94svh-4rem)] space-y-5 overflow-y-auto p-4 sm:p-6"
              >
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="space-y-1.5 sm:col-span-1">
                    <label className="text-xs font-medium text-muted-foreground">Type</label>
                    <select
                      value={form.type}
                      onChange={(e) =>
                        setForm({
                          ...emptyDnsForm(),
                          id: form.id,
                          type: e.target.value as DnsRecordType,
                          name: form.name,
                          ttl: form.ttl,
                        })
                      }
                      disabled={isEditing && records.find((r) => r.id === form.id)?.systemManaged}
                      className="w-full h-10 rounded-md border border-input bg-background/70 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {DNS_RECORD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <label className="text-xs font-medium text-muted-foreground">Name / host</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      disabled={isEditing && records.find((r) => r.id === form.id)?.systemManaged}
                      placeholder={
                        form.type === 'SRV'
                          ? '_service._tcp'
                          : form.type === 'TLSA'
                            ? '_443._tcp'
                            : '@ or subdomain'
                      }
                      className="w-full h-10 rounded-md border border-input bg-background/70 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      required
                    />
                  </div>
                </div>

                <DynamicRecordFields form={form} setForm={setForm} />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      TTL (seconds)
                    </label>
                    <input
                      type="number"
                      value={form.ttl}
                      onChange={(e) => setForm({ ...form, ttl: parseInt(e.target.value) || 3600 })}
                      disabled={isEditing && records.find((r) => r.id === form.id)?.systemManaged}
                      className="w-full h-10 rounded-md border border-input bg-background/70 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      min={60}
                      required
                    />
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                    Supported TTL values range from 60 to 3,600 seconds. AgentDomain validates and
                    canonicalizes this record before applying it.
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    disabled={loading}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  {!isEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleSubmit(undefined, true)}
                      disabled={loading || authLoading}
                      className="w-full sm:w-auto"
                    >
                      Save and add another
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      loading ||
                      authLoading ||
                      (isEditing && records.find((r) => r.id === form.id)?.systemManaged)
                    }
                    className="w-full min-w-[100px] sm:w-auto"
                  >
                    {loading || authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {bulkOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 sm:backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dns-bulk-dialog-title"
              className="safe-bottom premium-surface max-h-[94svh] w-full overflow-hidden rounded-t-lg border shadow-2xl sm:max-w-3xl sm:rounded-lg"
            >
              <div className="flex items-start justify-between border-b border-border/50 bg-muted/20 p-4 sm:p-5">
                <div>
                  <h3 id="dns-bulk-dialog-title" className="font-semibold text-lg">
                    Import or add multiple records
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Preview the exact change set before any provider write.
                  </p>
                </div>
                <button
                  onClick={() => setBulkOpen(false)}
                  className="touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Close"
                  aria-label="Close bulk DNS editor"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[calc(94svh-4.5rem)] space-y-5 overflow-y-auto p-4 sm:p-6">
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    <div>
                      <p className="font-semibold">DNS changes could not be prepared</p>
                      <p className="mt-0.5 leading-relaxed text-red-900">{error}</p>
                    </div>
                  </div>
                )}

                <div
                  className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-300 bg-neutral-100/80 p-1.5"
                  aria-label="DNS input format"
                >
                  <button
                    type="button"
                    aria-pressed={bulkEditor === 'zone'}
                    onClick={() => {
                      setBulkEditor('zone');
                      setBulkPreview(null);
                      setReplaceConfirmed(false);
                      setError(null);
                    }}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors ${bulkEditor === 'zone' ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm' : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:bg-white/80 hover:text-neutral-950'}`}
                  >
                    <FileCode2 className="h-4 w-4" />
                    BIND zone
                  </button>
                  <button
                    type="button"
                    aria-pressed={bulkEditor === 'json'}
                    onClick={() => {
                      setBulkEditor('json');
                      setBulkPreview(null);
                      setReplaceConfirmed(false);
                      setError(null);
                    }}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors ${bulkEditor === 'json' ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm' : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:bg-white/80 hover:text-neutral-950'}`}
                  >
                    <Braces className="h-4 w-4" />
                    JSON records
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-neutral-600">Apply mode</span>
                    <div
                      className="grid grid-cols-2 gap-1 rounded-lg border border-neutral-300 bg-white/50 p-1"
                      aria-label="DNS apply mode"
                    >
                      <button
                        type="button"
                        aria-pressed={bulkMode === 'merge'}
                        onClick={() => {
                          setBulkMode('merge');
                          setBulkPreview(null);
                          setReplaceConfirmed(false);
                          setError(null);
                        }}
                        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${bulkMode === 'merge' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'}`}
                      >
                        <GitMerge className="h-4 w-4" />
                        Merge
                      </button>
                      <button
                        type="button"
                        aria-pressed={bulkMode === 'replace'}
                        onClick={() => {
                          setBulkMode('replace');
                          setBulkPreview(null);
                          setReplaceConfirmed(false);
                          setError(null);
                        }}
                        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${bulkMode === 'replace' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'}`}
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Replace
                      </button>
                    </div>
                  </div>
                  <div
                    className={`flex min-h-[4.25rem] items-start gap-3 rounded-lg border p-3 ${bulkMode === 'merge' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-amber-300 bg-amber-50 text-amber-950'}`}
                  >
                    <div
                      className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${bulkMode === 'merge' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
                    >
                      {bulkMode === 'merge' ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="text-xs leading-relaxed">
                      <p className="font-semibold">
                        {bulkMode === 'merge'
                          ? 'Preserve the current zone'
                          : 'Replace user-managed records'}
                      </p>
                      <p className="mt-0.5">
                        {bulkMode === 'merge'
                          ? 'Adds and updates the records below without removing existing records.'
                          : 'Removes missing user records only. SSL, email, verification, and routing records stay protected.'}
                      </p>
                    </div>
                  </div>
                </div>

                {bulkEditor === 'zone' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      BIND zone records
                    </label>
                    <textarea
                      value={zoneFile}
                      onChange={(event) => {
                        setZoneFile(event.target.value);
                        setBulkPreview(null);
                        setReplaceConfirmed(false);
                        setError(null);
                      }}
                      rows={11}
                      spellCheck={false}
                      placeholder={
                        '@ 3600 IN A 192.0.2.1\nwww 3600 IN CNAME example.com.\n_mail._tcp 3600 IN SRV 10 5 443 mail.example.com.'
                      }
                      className="min-h-56 w-full resize-y rounded-md border border-input bg-background/70 p-3 font-mono text-xs leading-6 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum 256 KiB and 200 records. SOA and apex NS are previewed as warnings and
                      never applied.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Structured DNS records
                    </label>
                    <textarea
                      value={jsonRecords}
                      onChange={(event) => {
                        setJsonRecords(event.target.value);
                        setBulkPreview(null);
                        setReplaceConfirmed(false);
                        setError(null);
                      }}
                      rows={11}
                      spellCheck={false}
                      placeholder={
                        '[\n  {\n    "type": "A",\n    "name": "api",\n    "ttl": 300,\n    "data": { "address": "192.0.2.1" }\n  }\n]'
                      }
                      className="min-h-56 w-full resize-y rounded-md border border-input bg-background/70 p-3 font-mono text-xs leading-6 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum 1 MiB and 200 records. Use the same structured data contract as the
                      REST API and SDK.
                    </p>
                  </div>
                )}

                {bulkPreview && (
                  <div className="space-y-3 rounded-md border border-border/70 bg-background/50 p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <PreviewMetric label="Add" value={bulkPreview.summary.add} />
                      <PreviewMetric label="Update" value={bulkPreview.summary.update} />
                      <PreviewMetric
                        label="Delete"
                        value={bulkPreview.summary.delete}
                        danger={bulkPreview.summary.delete > 0}
                      />
                      <PreviewMetric label="Unchanged" value={bulkPreview.summary.unchanged} />
                      <PreviewMetric
                        label="Final records"
                        value={bulkPreview.summary.finalUserRecords}
                      />
                    </div>
                    {bulkPreview.warnings.length > 0 && (
                      <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-950">
                        {bulkPreview.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    )}
                    {bulkMode === 'replace' && bulkPreview.summary.delete > 0 && (
                      <label className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={replaceConfirmed}
                          onChange={(event) => setReplaceConfirmed(event.target.checked)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          I reviewed the preview and confirm deletion of{' '}
                          {bulkPreview.summary.delete} user-managed record(s).
                        </span>
                      </label>
                    )}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setBulkOpen(false)}
                    disabled={bulkLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={previewBulk}
                    disabled={
                      bulkLoading || !(bulkEditor === 'zone' ? zoneFile : jsonRecords).trim()
                    }
                  >
                    {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Preview changes
                  </Button>
                  <Button
                    type="button"
                    onClick={applyBulk}
                    disabled={
                      !bulkPreview ||
                      bulkLoading ||
                      (bulkMode === 'replace' &&
                        bulkPreview.summary.delete > 0 &&
                        !replaceConfirmed)
                    }
                  >
                    {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Apply changes
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 sm:backdrop-blur-sm">
            <div className="safe-bottom premium-surface w-full rounded-t-lg border p-4 shadow-2xl sm:max-w-md sm:rounded-lg sm:p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold">Delete DNS record?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This can break routing, email, or verification for this agent.
                  </p>
                  <div className="mt-3 rounded-md border border-border/60 bg-background/60 p-3 text-xs">
                    <div className="font-mono">
                      {deleteTarget.type} {deleteTarget.name}
                    </div>
                    <div className="wrap-anywhere mt-1 font-mono text-muted-foreground">
                      {deleteTarget.value}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={loading}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteConfirmed}
                  disabled={loading || authLoading}
                  className="w-full sm:w-auto"
                >
                  {loading || authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Delete record
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DynamicRecordFields({
  form,
  setForm,
}: {
  form: DnsFormState;
  setForm: Dispatch<SetStateAction<DnsFormState>>;
}) {
  const set = <K extends keyof DnsFormState>(key: K, value: DnsFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (form.type === 'A' || form.type === 'AAAA') {
    return (
      <DnsTextField
        label={form.type === 'A' ? 'IPv4 address' : 'IPv6 address'}
        value={form.address}
        onChange={(value) => set('address', value)}
        placeholder={form.type === 'A' ? '192.0.2.1' : '2001:db8::1'}
      />
    );
  }

  if (form.type === 'ALIAS' || form.type === 'CNAME') {
    return (
      <>
        <DnsTextField
          label="Target hostname"
          value={form.target}
          onChange={(value) => set('target', value)}
          placeholder="target.example.com"
        />
        {form.type === 'ALIAS' ? (
          <DnsHint>ALIAS is supported only at the zone apex. Use CNAME for subdomains.</DnsHint>
        ) : (
          <DnsHint>
            CNAME cannot be used at the apex or coexist with other record types at the same owner.
          </DnsHint>
        )}
      </>
    );
  }

  if (form.type === 'CAA') {
    return (
      <div className="grid gap-4 sm:grid-cols-[8rem_10rem_minmax(0,1fr)]">
        <DnsSelectField
          label="Flag"
          value={String(form.flag)}
          onChange={(value) => set('flag', Number(value) as 0 | 128)}
          options={[
            ['0', '0'],
            ['128', '128'],
          ]}
        />
        <DnsSelectField
          label="Tag"
          value={form.tag}
          onChange={(value) => set('tag', value as DnsFormState['tag'])}
          options={[
            ['issue', 'issue'],
            ['issuewild', 'issuewild'],
            ['iodef', 'iodef'],
          ]}
        />
        <DnsTextField
          label="CA / reporting value"
          value={form.caaValue}
          onChange={(value) => set('caaValue', value)}
          placeholder="letsencrypt.org"
        />
      </div>
    );
  }

  if (form.type === 'HTTPS' || form.type === 'SVCB') {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <DnsNumberField
            label="Priority"
            value={form.priority}
            onChange={(value) => set('priority', value)}
            min={0}
            max={65535}
          />
          <DnsTextField
            label="Target hostname"
            value={form.target}
            onChange={(value) => set('target', value)}
            placeholder="svc.example.com or ."
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-medium text-muted-foreground">Service parameters</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set('params', [...form.params, { key: '', value: '' }])}
              className="h-8 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add parameter
            </Button>
          </div>
          {form.params.length === 0 ? (
            <DnsHint>
              No service parameters. Priority 0 AliasMode records must remain empty.
            </DnsHint>
          ) : (
            form.params.map((param, index) => (
              <div
                key={`${index}-${param.key}`}
                className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_2.5rem] gap-2"
              >
                <input
                  value={param.key}
                  onChange={(event) =>
                    set(
                      'params',
                      form.params.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, key: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="alpn"
                  className={dnsInputClass}
                  required
                />
                <input
                  value={param.value ?? ''}
                  onChange={(event) =>
                    set(
                      'params',
                      form.params.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="h2,h3"
                  className={dnsInputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    set(
                      'params',
                      form.params.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-destructive"
                  title="Remove parameter"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (form.type === 'MX') {
    return (
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <DnsNumberField
          label="Priority"
          value={form.priority}
          onChange={(value) => set('priority', value)}
          min={0}
          max={65535}
        />
        <DnsTextField
          label="Mail exchange"
          value={form.exchange}
          onChange={(value) => set('exchange', value)}
          placeholder="mail.example.com"
        />
      </div>
    );
  }

  if (form.type === 'NS') {
    return (
      <>
        <DnsTextField
          label="Nameserver"
          value={form.nameserver}
          onChange={(value) => set('nameserver', value)}
          placeholder="ns1.example.net"
        />
        <DnsHint>
          Apex delegation is managed separately at the registrar. This editor accepts NS only below
          the apex.
        </DnsHint>
      </>
    );
  }

  if (form.type === 'PTR') {
    return (
      <>
        <DnsTextField
          label="Pointer hostname"
          value={form.pointer}
          onChange={(value) => set('pointer', value)}
          placeholder="host.example.com"
        />
        <DnsWarning>
          PTR works only when this zone has authority over the matching reverse DNS namespace.
        </DnsWarning>
      </>
    );
  }

  if (form.type === 'SRV') {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <DnsNumberField
          label="Priority"
          value={form.priority}
          onChange={(value) => set('priority', value)}
          min={0}
          max={65535}
        />
        <DnsNumberField
          label="Weight"
          value={form.weight}
          onChange={(value) => set('weight', value)}
          min={0}
          max={65535}
        />
        <DnsNumberField
          label="Port"
          value={form.port}
          onChange={(value) => set('port', value)}
          min={1}
          max={65535}
        />
        <div className="sm:col-span-3">
          <DnsTextField
            label="Target hostname"
            value={form.target}
            onChange={(value) => set('target', value)}
            placeholder="service.example.com"
          />
        </div>
      </div>
    );
  }

  if (form.type === 'TLSA') {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <DnsSelectField
            label="Certificate usage"
            value={String(form.usage)}
            onChange={(value) => set('usage', Number(value))}
            options={[
              ['0', '0 - PKIX-TA'],
              ['1', '1 - PKIX-EE'],
              ['2', '2 - DANE-TA'],
              ['3', '3 - DANE-EE'],
            ]}
          />
          <DnsSelectField
            label="Selector"
            value={String(form.selector)}
            onChange={(value) => set('selector', Number(value))}
            options={[
              ['0', '0 - Full certificate'],
              ['1', '1 - SPKI'],
            ]}
          />
          <DnsSelectField
            label="Matching"
            value={String(form.matchingType)}
            onChange={(value) => set('matchingType', Number(value))}
            options={[
              ['0', '0 - Exact'],
              ['1', '1 - SHA-256'],
              ['2', '2 - SHA-512'],
            ]}
          />
        </div>
        <DnsTextField
          label="Certificate association data"
          value={form.associationData}
          onChange={(value) => set('associationData', value)}
          placeholder="Hexadecimal certificate data"
          mono
        />
        <DnsWarning>
          TLSA authenticity depends on DNSSEC. DNSSEC lifecycle management is outside this release.
        </DnsWarning>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Text</label>
      <textarea
        value={form.text}
        onChange={(event) => set('text', event.target.value)}
        rows={4}
        placeholder="Exact TXT value"
        className="w-full resize-y rounded-md border border-input bg-background/70 p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        required
      />
    </div>
  );
}

const dnsInputClass =
  'h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

function DnsTextField({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${dnsInputClass} ${mono ? 'font-mono text-xs' : ''}`}
        required
      />
    </div>
  );
}

function DnsNumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        min={min}
        max={max}
        className={dnsInputClass}
        required
      />
    </div>
  );
}

function DnsSelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={dnsInputClass}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </div>
  );
}

function DnsHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function DnsWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium leading-relaxed text-amber-950">
      {children}
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${danger ? 'text-destructive' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function emptyDnsForm(): DnsFormState {
  return {
    type: 'TXT',
    name: '@',
    ttl: 3600,
    address: '',
    target: '',
    flag: 0,
    tag: 'issue',
    caaValue: '',
    priority: 10,
    exchange: '',
    nameserver: '',
    pointer: '',
    weight: 0,
    port: 443,
    usage: 3,
    selector: 1,
    matchingType: 1,
    associationData: '',
    text: '',
    params: [],
  };
}

function dataFromForm(form: DnsFormState): DnsRecordData {
  switch (form.type) {
    case 'A':
    case 'AAAA':
      return { address: form.address };
    case 'ALIAS':
    case 'CNAME':
      return { target: form.target };
    case 'CAA':
      return { flag: form.flag, tag: form.tag, value: form.caaValue };
    case 'HTTPS':
    case 'SVCB':
      return {
        priority: form.priority,
        target: form.target,
        params: form.params.map((param) => (param.value ? param : { key: param.key })),
      };
    case 'MX':
      return { priority: form.priority, exchange: form.exchange };
    case 'NS':
      return { nameserver: form.nameserver };
    case 'PTR':
      return { pointer: form.pointer };
    case 'SRV':
      return { priority: form.priority, weight: form.weight, port: form.port, target: form.target };
    case 'TLSA':
      return {
        usage: form.usage,
        selector: form.selector,
        matchingType: form.matchingType,
        associationData: form.associationData,
      };
    case 'TXT':
      return { text: form.text };
  }
}

function formFromRecord(record: DnsRecord): DnsFormState {
  const form = {
    ...emptyDnsForm(),
    id: record.id,
    type: record.type,
    name: record.name,
    ttl: record.ttl,
  };
  const data = (record.data ?? legacyData(record)) as Record<string, unknown>;
  form.address = String(data.address ?? '');
  form.target = String(data.target ?? '');
  form.flag = Number(data.flag ?? 0) === 128 ? 128 : 0;
  form.tag = ['issue', 'issuewild', 'iodef'].includes(String(data.tag))
    ? (String(data.tag) as DnsFormState['tag'])
    : 'issue';
  form.caaValue = String(data.value ?? '');
  form.priority = Number(data.priority ?? record.priority ?? 10);
  form.exchange = String(data.exchange ?? '');
  form.nameserver = String(data.nameserver ?? '');
  form.pointer = String(data.pointer ?? '');
  form.weight = Number(data.weight ?? 0);
  form.port = Number(data.port ?? 443);
  form.usage = Number(data.usage ?? 3);
  form.selector = Number(data.selector ?? 1);
  form.matchingType = Number(data.matchingType ?? 1);
  form.associationData = String(data.associationData ?? '');
  form.text = String(data.text ?? '');
  form.params = Array.isArray(data.params) ? (data.params as DnsServiceParam[]) : [];
  return form;
}

function legacyData(record: DnsRecord): DnsRecordData {
  const parts = record.value.trim().split(/\s+/);
  switch (record.type) {
    case 'A':
    case 'AAAA':
      return { address: record.value };
    case 'ALIAS':
    case 'CNAME':
      return { target: record.value };
    case 'CAA':
      return {
        flag: Number(parts[0]) === 128 ? 128 : 0,
        tag: (parts[1] ?? 'issue') as 'issue',
        value: parts.slice(2).join(' '),
      };
    case 'HTTPS':
    case 'SVCB':
      return {
        priority: Number(parts[0] ?? 0),
        target: parts[1] ?? '.',
        params: parts.slice(2).map(parseUiServiceParam),
      };
    case 'MX':
      return { priority: record.priority ?? 10, exchange: record.value };
    case 'NS':
      return { nameserver: record.value };
    case 'PTR':
      return { pointer: record.value };
    case 'SRV':
      return {
        priority: Number(parts[0] ?? 0),
        weight: Number(parts[1] ?? 0),
        port: Number(parts[2] ?? 443),
        target: parts[3] ?? '',
      };
    case 'TLSA':
      return {
        usage: Number(parts[0] ?? 3),
        selector: Number(parts[1] ?? 1),
        matchingType: Number(parts[2] ?? 1),
        associationData: parts.slice(3).join(''),
      };
    case 'TXT':
      return { text: record.value };
  }
}

function parseUiServiceParam(value: string): DnsServiceParam {
  const index = value.indexOf('=');
  return index === -1
    ? { key: value }
    : { key: value.slice(0, index), value: value.slice(index + 1) };
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const record = data as { message?: unknown; details?: unknown };
  const message = typeof record.message === 'string' ? record.message : fallback;
  const details =
    typeof record.details === 'string'
      ? record.details
      : record.details && typeof record.details === 'object' && 'message' in record.details
        ? String((record.details as { message?: unknown }).message ?? '')
        : '';
  return `${message}${details ? `: ${details}` : ''}`;
}

function formatTtl(ttl: number) {
  if (ttl % 3600 === 0) return `${ttl / 3600} hour${ttl === 3600 ? '' : 's'}`;
  if (ttl % 60 === 0) return `${ttl / 60} minutes`;
  return `${ttl} seconds`;
}

function isExternalApexRecord(record: DnsRecord) {
  return (
    !record.systemManaged &&
    record.name === '@' &&
    ['A', 'AAAA', 'ALIAS', 'CNAME'].includes(record.type)
  );
}

function showHostingTransitionToast(
  hosting: HostingTransition | null | undefined,
  copy: { title: string; description?: string },
) {
  if (hosting?.status === 'pending') {
    toast.warning(`${copy.title}; routing reconciliation pending`, {
      description: hosting.warning ?? copy.description,
    });
    return;
  }
  toast.success(copy.title, { description: copy.description });
}

function friendlyError(message: string): string {
  return message
    .replace(/\s*Version:\s*viem@[^\s]+/gi, '')
    .replace(/\s*Details:\s*/gi, ' ')
    .trim();
}
