// Takeoff accuracy Task 11 — the estimator's scope list for this bid:
// Included (as limited) and Not-included items. Agents 2 and 4 receive it as
// binding; a GC-facing takeoff line or scope bullet that mentions a
// Not-included item blocks the proposal / GC takeoff; every Not-included item
// becomes an exclusion bullet. (Chris's included / not-included list from the
// pre-bid review goes here too.)
import React, { useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { Toast } from '../../../types';
import './takeoffReview.css';

interface ScopeItem { id: string; kind: 'include' | 'exclude'; text: string }
interface ScopeList { items: ScopeItem[]; overrides: Array<{ id: string; text: string; reason: string }> }

export default function ScopeListPanel({ bidId, showToast }: { bidId: string; showToast: (t: Toast) => void }) {
  const { data: loaded } = useApi<ScopeList>(`/preconstruction/${bidId}/scope-items`);
  const [updated, setData] = useState<ScopeList | null>(null);
  const data = updated ?? loaded;
  const [kind, setKind] = useState<'include' | 'exclude'>('exclude');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (fn: () => Promise<{ data: ScopeList }>) => {
    setBusy(true);
    try {
      const { data: next } = await fn();
      setData(next);
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not update the scope list', sub: (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again' });
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  return (
    <section className="tr-panel" data-testid="scope-list" aria-label="Estimator scope list">
      <header className="tr-head">
        <strong style={{ fontSize: 13 }}>Estimator scope list</strong>
        <span className="tr-summary">Binding for the proposal. Not-included items become exclusions and block any line that mentions them.</span>
      </header>
      {items.length > 0 && (
        <ul className="tr-list">
          {items.map(i => (
            <li key={i.id} className="tr-item tr-item-done" data-testid={`scope-item-${i.id}`}>
              <span className={`tr-chip ${i.kind === 'exclude' ? 'tr-chip-warn' : 'tr-chip-ok'}`}>{i.kind === 'exclude' ? 'Not included' : 'Included'}</span>
              <span>{i.text}</span>
              <button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${i.text}`}
                onClick={() => void call(() => api.delete<ScopeList>(`/preconstruction/${bidId}/scope-items/${i.id}`))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="tr-actions">
        <select aria-label="Included or not included" value={kind} onChange={e => setKind(e.target.value as 'include' | 'exclude')}
          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}>
          <option value="exclude">Not included</option>
          <option value="include">Included (as limited)</option>
        </select>
        <input type="text" aria-label="Scope item" placeholder={kind === 'exclude' ? 'e.g. 600A MCC' : 'e.g. F/A: conduit + pull strings only'}
          value={text} onChange={e => setText(e.target.value)} />
        <button type="button" className="btn primary sm" disabled={busy || text.trim().length < 2}
          onClick={() => void call(async () => {
            const r = await api.post<ScopeList>(`/preconstruction/${bidId}/scope-items`, { kind, text });
            setText('');
            return r;
          })}>Add</button>
      </div>
      {(data?.overrides.length ?? 0) > 0 && (
        <div className="tr-sub" style={{ marginTop: 8 }}>
          Kept despite the non-electrical check: {data!.overrides.map(o => `"${o.text}" — ${o.reason}`).join('; ')}
        </div>
      )}
    </section>
  );
}
