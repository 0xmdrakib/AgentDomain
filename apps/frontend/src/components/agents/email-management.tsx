'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  AtSign,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  Pencil,
  BadgePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSiwe } from '@/hooks/use-siwe';
import { cn, formatDate } from '@/lib/utils';
import type {
  EmailAddressView as EmailAddressRow,
  EmailInboxView as EmailInboxRow,
} from '@/lib/backend-contracts';

type EmailDirection = 'all' | 'inbound' | 'outbound' | 'unread';

interface EmailMessage {
  id: string;
  direction: string;
  fromAddress: string;
  toAddress: string | null;
  subject: string | null;
  text: string | null;
  verificationCodes: string[];
  spamVerdict: string | null;
  virusVerdict: string | null;
  receivedAt: string;
  read: boolean;
  status: 'queued' | 'processing' | 'accepted' | 'failed';
  lastError: string | null;
}

interface BlockEntry {
  id: string;
  value: string;
  reason: string | null;
  createdAt: string;
}

interface EmailLimitInfo {
  plan: string;
  planLabel: string;
  emailAliases: number;
}

export function EmailManagement({
  agentId,
  inbox,
}: {
  agentId: string;
  inbox: EmailInboxRow | null;
}) {
  const { session, signIn, loading: authLoading } = useSiwe();
  const [inboxStatus, setInboxStatus] = useState<EmailInboxRow | null>(inbox);
  const [addresses, setAddresses] = useState<EmailAddressRow[]>([]);
  const [limitInfo, setLimitInfo] = useState<EmailLimitInfo | null>(null);
  const [filter, setFilter] = useState<EmailDirection>('all');
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blocklist, setBlocklist] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [usageRevision, setUsageRevision] = useState(0);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [blockValue, setBlockValue] = useState('');
  const [primaryDraft, setPrimaryDraft] = useState('agent');
  const [aliasDraft, setAliasDraft] = useState('');
  const [form, setForm] = useState({ to: '', fromAddress: '', subject: '', text: '' });

  const unreadCount = messages.filter((message) => !message.read).length;
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );
  const activeAddresses = useMemo(
    () =>
      addresses.length > 0
        ? addresses.filter((address) => address.status === 'active')
        : inboxStatus
          ? [
              {
                id: inboxStatus.id,
                agentId: inboxStatus.agentId,
                emailAddress: inboxStatus.emailAddress,
                kind: 'primary' as const,
                status: 'active' as const,
                createdAt: inboxStatus.createdAt,
                updatedAt: inboxStatus.createdAt,
              },
            ]
          : [],
    [addresses, inboxStatus],
  );
  const primaryAddress =
    activeAddresses.find((address) => address.kind === 'primary')?.emailAddress ??
    inboxStatus?.emailAddress ??
    '';
  const primaryDomain = readDomainPart(primaryAddress || inboxStatus?.emailAddress || '');
  const primaryDraftAddress = primaryDomain
    ? `${primaryDraft || 'agent'}@${primaryDomain}`.toLowerCase()
    : '';
  const aliasAddresses = activeAddresses.filter((address) => address.kind === 'alias');
  const aliasLimit = limitInfo?.emailAliases ?? 0;
  const aliasSlotsLeft = Math.max(0, aliasLimit - aliasAddresses.length);

  useEffect(() => {
    setInboxStatus(inbox);
    if (inbox?.emailAddress) {
      setPrimaryDraft(readLocalPart(inbox.emailAddress));
      setForm((current) => ({
        ...current,
        fromAddress: current.fromAddress || inbox.emailAddress,
      }));
    }
  }, [inbox]);

  useEffect(() => {
    if (!inboxStatus || !session.authenticated) return;
    void loadMessages(filter);
    void loadBlocklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, inboxStatus?.id, session.authenticated, filter]);

  async function ensureSignedIn() {
    if (session.authenticated) return true;
    const ok = await signIn();
    if (!ok) {
      toast.error('Sign-in required', {
        description: 'Please approve the wallet signature to manage email.',
      });
    }
    return ok;
  }

  async function loadMessages(nextFilter = filter) {
    if (!inboxStatus) return;
    if (!session.authenticated) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50', sync: 'false' });
      if (nextFilter === 'inbound' || nextFilter === 'outbound') {
        params.set('direction', nextFilter);
      }
      if (nextFilter === 'unread') params.set('unreadOnly', 'true');
      const res = await fetch(`/api/v1/agents/${agentId}/email?${params}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      if (data?.inbox) {
        setInboxStatus(data.inbox as EmailInboxRow);
      }
      if (Array.isArray(data?.addresses)) {
        setAddresses(data.addresses as EmailAddressRow[]);
        const primary = (data.addresses as EmailAddressRow[]).find(
          (entry) => entry.kind === 'primary',
        );
        if (primary) {
          setPrimaryDraft(readLocalPart(primary.emailAddress));
          setForm((current) => ({
            ...current,
            fromAddress: current.fromAddress || primary.emailAddress,
          }));
        }
      }
      if (data?.limits) {
        setLimitInfo(data.limits as EmailLimitInfo);
      }
      const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(nextMessages);
      setSelectedId((current) => current ?? nextMessages[0]?.id ?? null);
      setUsageRevision((current) => current + 1);
    } catch (err) {
      toast.error('Could not load email', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadBlocklist() {
    if (!inboxStatus || !session.authenticated) return;
    setBlockLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/blocklist`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setBlocklist(Array.isArray(data?.entries) ? data.entries : []);
    } catch {
      setBlocklist([]);
    } finally {
      setBlockLoading(false);
    }
  }

  async function sendEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!inboxStatus || !(await ensureSignedIn())) return;
    setSendLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: form.to
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          fromAddress: form.fromAddress.trim() || primaryAddress || undefined,
          subject: form.subject,
          text: form.text,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      toast.success('Email queued');
      setForm({ to: '', fromAddress: primaryAddress, subject: '', text: '' });
      setComposeOpen(false);
      await loadMessages(filter);
    } catch (err) {
      toast.error('Send failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSendLoading(false);
    }
  }

  async function updateRead(message: EmailMessage, read: boolean) {
    if (!(await ensureSignedIn())) return;
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/${message.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      const next = data?.message as EmailMessage;
      setMessages((current) => current.map((item) => (item.id === message.id ? next : item)));
    } catch (err) {
      toast.error('Could not update message', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  async function deleteMessage(message: EmailMessage) {
    if (!(await ensureSignedIn())) return;
    if (!window.confirm('Delete this email from AgentDomain? This cannot be undone.')) return;
    setDeletingMessageId(message.id);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/${message.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setSelectedId(null);
      toast.success('Email deleted');
    } catch (err) {
      toast.error('Could not delete email', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setDeletingMessageId(null);
    }
  }

  async function addBlocklist(event: React.FormEvent) {
    event.preventDefault();
    if (!blockValue.trim() || !(await ensureSignedIn())) return;
    setBlockLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/blocklist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: blockValue.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setBlockValue('');
      await loadBlocklist();
      toast.success('Sender blocked');
    } catch (err) {
      toast.error('Block failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBlockLoading(false);
    }
  }

  async function deleteBlock(id: string) {
    if (!(await ensureSignedIn())) return;
    setBlockLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/blocklist/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setBlocklist((current) => current.filter((entry) => entry.id !== id));
      toast.success('Block removed');
    } catch (err) {
      toast.error('Remove failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBlockLoading(false);
    }
  }

  async function updatePrimaryEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!primaryDraft.trim() || !(await ensureSignedIn())) return;
    const username = sanitizeEmailUsername(primaryDraft);
    const nextAddress = primaryDomain ? `${username}@${primaryDomain}`.toLowerCase() : username;
    if (
      primaryAddress &&
      nextAddress !== primaryAddress.toLowerCase() &&
      !window.confirm(
        `Change the primary email to ${nextAddress}? The current primary address ${primaryAddress} will stop receiving new mail.`,
      )
    ) {
      return;
    }
    setAliasLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, confirmReplace: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      if (data?.inbox) setInboxStatus(data.inbox as EmailInboxRow);
      if (Array.isArray(data?.addresses)) setAddresses(data.addresses as EmailAddressRow[]);
      setForm((current) => ({ ...current, fromAddress: data?.inbox?.emailAddress ?? nextAddress }));
      toast.success('Primary email updated', {
        description: data?.message ?? `${nextAddress} is now the primary address.`,
      });
    } catch (err) {
      toast.error('Primary update failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setAliasLoading(false);
    }
  }

  async function createAlias(event: React.FormEvent) {
    event.preventDefault();
    if (!aliasDraft.trim() || !(await ensureSignedIn())) return;
    setAliasLoading(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/aliases`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: sanitizeEmailUsername(aliasDraft) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      if (Array.isArray(data?.addresses)) setAddresses(data.addresses as EmailAddressRow[]);
      setAliasDraft('');
      toast.success('Alias created');
    } catch (err) {
      toast.error('Alias create failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setAliasLoading(false);
    }
  }

  async function deleteAlias(emailAddress: string) {
    if (!(await ensureSignedIn())) return;
    setAliasLoading(true);
    try {
      const params = new URLSearchParams({ emailAddress });
      const res = await fetch(`/api/v1/agents/${agentId}/email/aliases?${params}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      if (Array.isArray(data?.addresses)) setAddresses(data.addresses as EmailAddressRow[]);
      if (form.fromAddress.toLowerCase() === emailAddress.toLowerCase()) {
        setForm((current) => ({ ...current, fromAddress: primaryAddress }));
      }
      toast.success('Alias removed');
    } catch (err) {
      toast.error('Alias remove failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setAliasLoading(false);
    }
  }

  if (!inboxStatus) {
    return (
      <Card className="premium-surface mb-6">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Email</h2>
              <p className="text-sm text-muted-foreground">
                Included email provisioning is not ready yet.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="premium-surface mb-6 overflow-hidden">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg sm:text-xl">Email</CardTitle>
              <Badge variant={inboxStatus.verificationStatus === 'Success' ? 'success' : 'warning'}>
                {inboxStatus.verificationStatus}
              </Badge>
              {unreadCount > 0 && <Badge variant="secondary">{unreadCount} unread</Badge>}
            </div>
            <div className="wrap-anywhere mt-2 font-mono text-sm text-muted-foreground">
              {primaryAddress || inboxStatus.emailAddress}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (session.authenticated ? loadMessages(filter) : signIn())}
              disabled={loading || authLoading}
              className="w-full sm:w-auto"
            >
              {loading || authLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {session.authenticated ? 'Refresh' : 'Sign in'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setComposeOpen((value) => !value)}
              className="w-full sm:w-auto"
            >
              <Send className="h-4 w-4" />
              Compose
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <EmailHealth label="DKIM" enabled={inboxStatus.dkimConfigured} />
          <EmailHealth label="SPF" enabled={inboxStatus.spfConfigured} />
          <EmailHealth label="DMARC" enabled={inboxStatus.dmarcConfigured} />
        </div>

        <div className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-background/45 p-3 shadow-inner shadow-black/10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form onSubmit={updatePrimaryEmail} className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AtSign className="h-4 w-4 text-muted-foreground" />
              Primary address
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={primaryDraft}
                onChange={(event) => setPrimaryDraft(sanitizeEmailUsername(event.target.value))}
                placeholder="agent"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={
                  aliasLoading ||
                  !primaryDraft.trim() ||
                  !primaryDraftAddress ||
                  primaryDraftAddress === primaryAddress.toLowerCase()
                }
              >
                {aliasLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Update
              </Button>
            </div>
            <div className="wrap-anywhere text-xs text-muted-foreground">
              {primaryDraftAddress || `${primaryDraft || 'agent'}@yourdomain.com`}
            </div>
          </form>

          <form onSubmit={createAlias} className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BadgePlus className="h-4 w-4 text-muted-foreground" />
                Email aliases
              </div>
              <span className="text-xs text-muted-foreground">
                {aliasAddresses.length}/{aliasLimit}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={aliasDraft}
                onChange={(event) => setAliasDraft(sanitizeEmailUsername(event.target.value))}
                placeholder={aliasLimit > 0 ? 'billing' : 'Upgrade for aliases'}
                disabled={aliasLimit === 0}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={
                  aliasLoading || aliasLimit === 0 || aliasSlotsLeft === 0 || !aliasDraft.trim()
                }
              >
                {aliasLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BadgePlus className="h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {aliasLimit === 0
                ? 'Aliases unlock on Starter, Pro, and Enterprise Premium Plans.'
                : aliasSlotsLeft > 0
                  ? `${aliasSlotsLeft} alias slot${aliasSlotsLeft === 1 ? '' : 's'} available.`
                  : 'Alias limit reached for this plan.'}
            </div>
            {aliasAddresses.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {aliasAddresses.map((address) => (
                  <span
                    key={address.emailAddress}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/70 py-1 pl-3 pr-1 text-xs"
                  >
                    <span className="wrap-anywhere min-w-0">{address.emailAddress}</span>
                    <button
                      type="button"
                      onClick={() => deleteAlias(address.emailAddress)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${address.emailAddress}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </form>
        </div>

        {session.authenticated && <EmailUsagePanel agentId={agentId} refreshKey={usageRevision} />}
        {session.authenticated && <WebhookSettings agentId={agentId} />}

        {composeOpen && (
          <form
            onSubmit={sendEmail}
            className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-background/55 p-3 sm:p-4"
          >
            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={form.fromAddress || primaryAddress}
                onChange={(event) =>
                  setForm((current) => ({ ...current, fromAddress: event.target.value }))
                }
                className="min-h-10 rounded-md border border-input bg-background/70 px-3 py-2 font-mono text-sm shadow-[inset_0_1px_3px_rgba(20,21,18,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
              >
                {activeAddresses.map((address) => (
                  <option key={address.emailAddress} value={address.emailAddress}>
                    From {address.emailAddress}
                  </option>
                ))}
              </select>
              <Input
                type="text"
                value={form.to}
                onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))}
                placeholder="recipient@example.com"
                required
              />
              <Input
                type="text"
                value={form.subject}
                onChange={(event) =>
                  setForm((current) => ({ ...current, subject: event.target.value }))
                }
                placeholder="Subject"
                required
              />
            </div>
            <textarea
              value={form.text}
              onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))}
              placeholder="Message"
              required
              rows={5}
              className="min-h-[140px] w-full rounded-md border border-input bg-background/70 px-3 py-2 text-sm shadow-[inset_0_1px_3px_rgba(20,21,18,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] placeholder:text-muted-foreground/70 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sendLoading || authLoading}>
                {sendLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send email
              </Button>
            </div>
          </form>
        )}

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {(['all', 'inbound', 'outbound', 'unread'] as EmailDirection[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                'h-9 shrink-0 rounded-md border px-3 text-sm transition-colors',
                filter === item
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/70 bg-background/55 text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-h-[260px] overflow-hidden rounded-lg border border-border/60 bg-background/40">
            {loading ? (
              <div className="flex h-[260px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-[260px] flex-col items-center justify-center px-4 text-center">
                <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">No messages found.</div>
              </div>
            ) : (
              <div className="max-h-[420px] divide-y divide-border/50 overflow-y-auto">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                    className={cn(
                      'block w-full p-3 text-left transition-colors hover:bg-accent/60',
                      selectedMessage?.id === message.id && 'bg-accent/70',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {message.subject || '(no subject)'}
                          </span>
                          {!message.read && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                        </div>
                        <div className="wrap-anywhere mt-1 font-mono text-xs text-muted-foreground">
                          {message.direction === 'outbound'
                            ? message.toAddress
                            : message.fromAddress}
                        </div>
                      </div>
                      <Badge variant={message.direction === 'outbound' ? 'outline' : 'secondary'}>
                        {message.direction === 'outbound' ? message.status : message.direction}
                      </Badge>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {message.text || 'No preview available.'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-[260px] rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
            {selectedMessage ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-col gap-3 border-b border-border/50 pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="wrap-anywhere font-semibold">
                      {selectedMessage.subject || '(no subject)'}
                    </h3>
                    <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground">
                      <span className="wrap-anywhere">From {selectedMessage.fromAddress}</span>
                      {selectedMessage.toAddress && (
                        <span className="wrap-anywhere">To {selectedMessage.toAddress}</span>
                      )}
                      <span>{formatDate(new Date(selectedMessage.receivedAt))}</span>
                      {selectedMessage.direction === 'outbound' && (
                        <span>Status {selectedMessage.status}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateRead(selectedMessage, !selectedMessage.read)}
                      className="min-w-0 flex-1 sm:flex-none"
                    >
                      <MailCheck className="h-4 w-4" />
                      {selectedMessage.read ? 'Mark unread' : 'Mark read'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Delete email"
                      aria-label="Delete email"
                      onClick={() => void deleteMessage(selectedMessage)}
                      disabled={deletingMessageId === selectedMessage.id}
                      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deletingMessageId === selectedMessage.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Close email"
                      aria-label="Close email"
                      onClick={() => setSelectedId(null)}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {selectedMessage.lastError && (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {selectedMessage.lastError}
                  </div>
                )}

                {selectedMessage.verificationCodes.length > 0 && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Verification codes
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedMessage.verificationCodes.map((code) => (
                        <span
                          key={code}
                          className="rounded-md bg-background px-2 py-1 font-mono text-sm"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <pre className="wrap-anywhere mt-4 flex-1 whitespace-pre-wrap rounded-lg bg-background/55 p-3 text-sm leading-6 text-foreground">
                  {selectedMessage.text || 'No plain text body available.'}
                </pre>
              </div>
            ) : (
              <div className="flex h-full min-h-[230px] items-center justify-center text-sm text-muted-foreground">
                Select an email.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border/60 bg-background/45 p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 font-medium">
              <Ban className="h-4 w-4 text-muted-foreground" />
              Blocklist
            </div>
            {blockLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <form onSubmit={addBlocklist} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={blockValue}
              onChange={(event) => setBlockValue(event.target.value)}
              placeholder="email or domain"
            />
            <Button type="submit" variant="outline" disabled={blockLoading || !blockValue.trim()}>
              Block
            </Button>
          </form>
          {blocklist.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {blocklist.map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/70 py-1 pl-3 pr-1 text-xs"
                >
                  <span className="wrap-anywhere min-w-0">{entry.value}</span>
                  <button
                    type="button"
                    onClick={() => deleteBlock(entry.id)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${entry.value}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookSettings({ agentId }: { agentId: string }) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'metadata' | 'inline_text'>('metadata');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/v1/agents/${agentId}/email/webhook`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.webhook) {
          setUrl(data.webhook.url);
          setMode(data.webhook.payloadMode);
          setEnabled(data.webhook.enabled);
        }
      })
      .catch(() => undefined);
  }, [agentId]);
  async function save() {
    setSaving(true);
    setSecret(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/webhook`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, payloadMode: mode, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.code ?? 'Webhook save failed');
      if (data.signingSecret) setSecret(data.signingSecret);
      toast.success('Inbound webhook saved');
    } catch (error) {
      toast.error('Webhook save failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }
  async function rotate() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/email/webhook`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code ?? 'Rotation failed');
      setSecret(data.signingSecret);
      toast.success('Signing secret rotated');
    } catch (error) {
      toast.error('Secret rotation failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-background/45 p-3 sm:p-4">
      <div>
        <div className="text-sm font-medium">Inbound webhook</div>
        <p className="text-xs text-muted-foreground">
          Signed email.received events with delivery retries.
        </p>
      </div>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/webhooks/email"
        type="url"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="metadata">Metadata + content URL</option>
          <option value="inline_text">Include plain text up to 256KB</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <Button type="button" onClick={save} disabled={saving || !url}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={rotate} disabled={saving || !url}>
          Rotate secret
        </Button>
      </div>
      {secret && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs font-medium">
            Copy this signing secret now. It will not be shown again.
          </div>
          <code className="wrap-anywhere mt-1 block text-xs">{secret}</code>
        </div>
      )}
    </div>
  );
}

function EmailUsagePanel({ agentId, refreshKey }: { agentId: string; refreshKey: number }) {
  const [usage, setUsage] = useState<{
    used: number;
    limit: number;
    sent: number;
    received: number;
    remaining: number;
    cycleEnd: string;
    requestsPerSecond: number;
  } | null>(null);
  useEffect(() => {
    fetch(`/api/v1/agents/${agentId}/email/usage`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => undefined);
  }, [agentId, refreshKey]);
  if (!usage) return null;
  const percent = Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100));
  return (
    <div className="mb-4 grid gap-2 rounded-lg border border-border/60 bg-background/45 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Monthly email usage</div>
        <div className="text-xs text-muted-foreground">
          {usage.requestsPerSecond} API requests/second
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} combined
        </span>
        <span>
          Sent {usage.sent.toLocaleString()} · Received {usage.received.toLocaleString()}
        </span>
        <span>Resets {new Date(usage.cycleEnd).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function EmailHealth({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex min-h-[70px] items-center gap-3 rounded-lg border border-border/60 bg-background/55 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
        {enabled ? (
          <CheckCircle2 className="h-4 w-4 text-green-800" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{enabled ? 'Configured' : 'Pending'}</div>
      </div>
    </div>
  );
}

function sanitizeEmailUsername(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '')
    .slice(0, 64);
}

function readLocalPart(emailAddress: string): string {
  return emailAddress.split('@')[0] ?? 'agent';
}

function readDomainPart(emailAddress: string): string {
  return emailAddress.split('@')[1] ?? '';
}
