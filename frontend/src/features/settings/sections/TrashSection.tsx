import React, { useEffect, useState, useCallback } from 'react';
import api from '../../../api/client';
import { SectionTitle, timeAgo } from '../shared';
import { moneyFull } from '../../../lib/money';

interface TrashBid { id: string; name: string; gc: string; amount: number | null; stage: string; deleted_at: string }
interface TrashGen { id: string; customer: string; amount: number | null; stage: string; deleted_at: string }
interface TrashDoc { id: string; name: string; display_name?: string; linked_name?: string; category: string; file_size?: number; deleted_at: string }
interface TrashData { bids: TrashBid[]; gens: TrashGen[]; documents: TrashDoc[] }

const money = (n: number | null | undefined) => n != null ? moneyFull(Number(n)) : '—';

export function TrashSection() {
  const [data, setData] = useState<TrashData>({ bids: [], gens: [], documents: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/trash')
      .then(r => setData(r.data))
      .catch(() => setData({ bids: [], gens: [], documents: [] }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (verb: 'restore' | 'purge', base: string, id: string, label: string) => {
    if (verb === 'purge' && !window.confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
    setBusy(id);
    try {
      if (verb === 'restore') await api.post(`${base}/${id}/restore`);
      else await api.delete(`${base}/${id}/purge`);
      load();
    } catch { /* surfaced via reload */ }
    finally { setBusy(null); }
  };

  const total = data.bids.length + data.gens.length + data.documents.length;

  const Row = ({ id, title, meta, base, label }: { id: string; title: string; meta: string; base: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{meta}</div>
      </div>
      <button onClick={() => act('restore', base, id, label)} disabled={busy === id}
        style={{ padding: '6px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
        Restore
      </button>
      <button onClick={() => act('purge', base, id, label)} disabled={busy === id}
        style={{ padding: '6px 14px', background: 'transparent', color: 'var(--red, #b91c1c)', border: '1px solid var(--border2)', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
        Delete forever
      </button>
    </div>
  );

  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionTitle title="Trash" sub="Deleted bids, proposals & documents. Restore them, or delete permanently. Items are purged automatically after the configured retention window." />
      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Trash is empty.</div>
      ) : (
        <>
          {data.bids.length > 0 && (
            <Group label={`Electrical Bids (${data.bids.length})`}>
              {data.bids.map(b => (
                <Row key={b.id} id={b.id} base="/bids" label={`bid "${b.name}"`}
                  title={b.name} meta={`${b.gc} · ${money(b.amount)} · ${b.stage} · deleted ${timeAgo(b.deleted_at)}`} />
              ))}
            </Group>
          )}
          {data.gens.length > 0 && (
            <Group label={`Generator Proposals (${data.gens.length})`}>
              {data.gens.map(g => (
                <Row key={g.id} id={g.id} base="/gens" label={`proposal "${g.customer}"`}
                  title={g.customer} meta={`${money(g.amount)} · ${g.stage} · deleted ${timeAgo(g.deleted_at)}`} />
              ))}
            </Group>
          )}
          {data.documents.length > 0 && (
            <Group label={`Documents (${data.documents.length})`}>
              {data.documents.map(d => (
                <Row key={d.id} id={d.id} base="/documents" label={`document "${d.name}"`}
                  title={d.display_name || d.name} meta={`${d.linked_name ? d.linked_name + ' · ' : ''}${d.category} · deleted ${timeAgo(d.deleted_at)}`} />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}
