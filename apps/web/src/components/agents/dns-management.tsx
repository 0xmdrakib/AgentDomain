'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit2, X, Loader2 } from 'lucide-react';

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number | null;
  systemManaged?: boolean;
  purpose?: string | null;
}

export function DnsManagement({ agentId, initialDns }: { agentId: string; initialDns: DnsRecord[] }) {
  const [records, setRecords] = useState<DnsRecord[]>(initialDns);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<{
    id?: string;
    type: string;
    name: string;
    value: string;
    ttl: number;
    priority?: number;
  }>({
    type: 'TXT',
    name: '@',
    value: '',
    ttl: 3600,
  });

  const openAdd = () => {
    setForm({ type: 'TXT', name: '@', value: '', ttl: 3600 });
    setIsEditing(false);
    setError(null);
    setIsModalOpen(true);
  };

  const openEdit = (record: DnsRecord) => {
    setForm({
      id: record.id,
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl,
      priority: record.priority ?? undefined,
    });
    setIsEditing(true);
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const url = isEditing
        ? `/api/v1/agents/${agentId}/dns/${form.id}`
        : `/api/v1/agents/${agentId}/dns`;

      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          name: form.name,
          value: form.value,
          ttl: Number(form.ttl),
          priority: form.priority ? Number(form.priority) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save record');
      }

      const savedRecord = await res.json();

      if (isEditing) {
        setRecords(records.map((r) => (r.id === savedRecord.id ? savedRecord : r)));
      } else {
        setRecords([...records, savedRecord]);
      }

      closeModal();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this DNS record?')) return;
    
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/dns/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      setRecords(records.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">DNS Records</h2>
          <Button variant="outline" size="sm" onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Add Record
          </Button>
        </div>

        <div className="overflow-x-auto">
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
                  <tr key={r.id} className="border-t border-border/40 group hover:bg-primary/5 transition-colors">
                    <td className="py-3 pr-4 font-mono text-xs">{r.type}</td>
                    <td className="py-3 pr-4 font-mono text-xs truncate max-w-[150px]">{r.name}</td>
                    <td className="py-3 pr-4 font-mono text-xs truncate max-w-[300px]" title={r.value}>{r.value}</td>
                    <td className="py-3 pr-4 font-mono text-xs">{r.ttl}</td>
                    <td className="py-3 pr-4 text-xs">{r.systemManaged ? r.purpose ?? 'system' : 'user'}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(r)}
                          disabled={r.systemManaged}
                          className="p-1.5 text-muted-foreground hover:text-primary rounded-md bg-background/50 hover:bg-background transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={r.systemManaged}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-md bg-background/50 hover:bg-background transition-colors"
                          title="Delete"
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

        {/* Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border/50 rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/20">
                <h3 className="font-semibold text-lg">{isEditing ? 'Edit Record' : 'Add Record'}</h3>
                <button onClick={closeModal} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
                    {error}
                  </div>
                )}
                
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Type</label>
                    <select
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {['A', 'AAAA', 'ALIAS', 'CNAME', 'TXT', 'MX', 'NS'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="@ or sub"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Content</label>
                  <input
                    type="text"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    placeholder="Value"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">TTL (seconds)</label>
                    <input
                      type="number"
                      value={form.ttl}
                      onChange={(e) => setForm({ ...form, ttl: parseInt(e.target.value) || 3600 })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      min={60}
                      required
                    />
                  </div>
                  {form.type === 'MX' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Priority</label>
                      <input
                        type="number"
                        value={form.priority || ''}
                        onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        min={0}
                        required={form.type === 'MX'}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-4 flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={closeModal} disabled={loading}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading} className="min-w-[100px]">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
