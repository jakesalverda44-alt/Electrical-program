// Shared settings UI primitives and role metadata used across section components.
import React from 'react';

export function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function timeAgo(ts?: string) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return m <= 1 ? 'Just now' : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export const ROLE_OPTIONS = [
  'owner','administrator','sales_manager','salesperson',
  'estimator','project_manager','technician','accounting','read_only',
];

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', administrator: 'Administrator', sales_manager: 'Sales Manager',
  salesperson: 'Sales Rep', estimator: 'Estimator', project_manager: 'Project Manager',
  technician: 'Technician', accounting: 'Accounting', read_only: 'Read Only',
};

export const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  owner:           { bg: '#FEF3C7', color: '#92400E' },
  administrator:   { bg: '#EDE9FE', color: '#5B21B6' },
  sales_manager:   { bg: '#DBEAFE', color: '#1E40AF' },
  salesperson:     { bg: '#D1FAE5', color: '#065F46' },
  estimator:       { bg: '#E0F2FE', color: '#075985' },
  project_manager: { bg: '#FCE7F3', color: '#9D174D' },
  technician:      { bg: '#FEE2E2', color: '#991B1B' },
  accounting:      { bg: '#F3F4F6', color: '#374151' },
  read_only:       { bg: '#F9FAFB', color: '#6B7280' },
};

export function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] ?? ROLE_COLORS.read_only;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
      background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '9px 12px', outline: 'none',
};

export function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: desc ? 2 : 6 }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, lineHeight: 1.5 }}>{desc}</div>}
      {children}
    </div>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function SaveBar({ onSave, saving, saved, hasChanges }: { onSave: () => void; saving: boolean; saved: boolean; hasChanges: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
      <button onClick={onSave} disabled={saving || !hasChanges}
        style={{ padding: '10px 28px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9,
          fontWeight: 700, fontSize: 14, cursor: saving || !hasChanges ? 'not-allowed' : 'pointer', opacity: !hasChanges ? .5 : 1 }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
    </div>
  );
}
export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', transition: 'background .2s',
        background: on ? 'var(--blue)' : 'var(--border2)', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
    </button>
  );
}
