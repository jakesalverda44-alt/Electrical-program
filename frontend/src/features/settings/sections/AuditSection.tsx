import React, { useEffect, useState, useCallback } from 'react';
import api from '../../../api/client';
import { SectionTitle, timeAgo, inputStyle } from '../shared';

interface AuditRow {
  id: string;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  award:          { bg: 'var(--green-soft)',       color: 'var(--green)' },
  delete:         { bg: 'rgba(224,106,106,.14)',   color: 'var(--red)'   },
  purge:          { bg: 'rgba(224,106,106,.22)',   color: 'var(--red)'   },
  restore:        { bg: 'var(--blue-soft)',        color: 'var(--blue)'  },
  merge:          { bg: 'rgba(139,92,246,.14)',    color: '#A78BFA'      },
  role_change:    { bg: 'var(--amber-soft)',       color: 'var(--amber)' },
  password_reset: { bg: 'var(--amber-soft)',       color: 'var(--amber)' },
  ai_override:    { bg: 'rgba(77,141,247,.12)',    color: 'var(--blue)'  },
};

export function AuditSection() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const q = filter ? `?entity_type=${encodeURIComponent(filter)}` : '';
    api.get(`/admin/audit${q}`)
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionTitle title="Audit Log" sub="Money, identity & permission changes — who did what, and when." />

      <div style={{ marginBottom: 14, maxWidth: 220 }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All activity</option>
          <option value="bid">Bids</option>
          <option value="gen">Generator proposals</option>
          <option value="document">Documents</option>
          <option value="user">Users</option>
          <option value="settings">Settings</option>
          <option value="customer">Customers</option>
        </select>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>No audit entries yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const c = ACTION_COLORS[r.action] ?? { bg: 'var(--surface2)', color: 'var(--text2)' };
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5, background: c.bg, color: c.color,
                  textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'center' }}>
                  {r.action.replace('_', ' ')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.summary || `${r.action} ${r.entity_type}`}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                    {r.user_name || 'System'} · {r.entity_type}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{timeAgo(r.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
