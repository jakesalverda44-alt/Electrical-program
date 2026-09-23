// Takeoff accuracy Task 11 — "Keep this line" for a takeoff line the
// non-electrical gate flagged: the estimator states why it IS electrical scope
// on this job; the override is stored per bid and the gate lets it through.
import React, { useState } from 'react';
import api from '../../../api/client';
import type { Toast } from '../../../types';

export default function KeepLineControl({ bidId, category, line, showToast }: { bidId: string; category: string; line: string; showToast: (t: Toast) => void }) {
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>Kept — generate again.</div>;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' }}>
      <input
        aria-label={`Why "${line}" is electrical scope`}
        placeholder="Why this is electrical scope on this job"
        value={reason}
        onChange={e => setReason(e.target.value)}
        style={{ flex: 1, minWidth: 200, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)' }}
      />
      <button type="button" className="btn ghost sm" disabled={busy || reason.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/preconstruction/${bidId}/non-electrical-overrides`, { category, line, reason });
            setDone(true);
          } catch (err) {
            showToast({ variant: 'error', title: 'Could not keep the line', sub: (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again' });
          } finally {
            setBusy(false);
          }
        }}>
        Keep this line
      </button>
    </div>
  );
}
