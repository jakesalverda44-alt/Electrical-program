import React from 'react';

interface HubTabsProps {
  tabs: readonly { key: string; label: string }[];
  active: string;
  accent: 'amber' | 'blue';
  onSelect: (key: string) => void;   // parent navigates
  counts?: Record<string, number>;    // optional badge per tab key
}

// Underline tab bar, styled to match the pre-hub pipeline tab bars it
// replaced — amber accent for the generators hub, blue for the electrical hub.
export default function HubTabs({ tabs, active, accent, onSelect, counts }: HubTabsProps) {
  const activeColor = accent === 'amber' ? 'var(--amber)' : 'var(--blue)';
  return (
    <div style={{ display: 'flex', gap: 4, padding: '0 16px', borderBottom: '1px solid var(--border)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        const count = counts?.[t.key];
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            style={{
              padding: '8px 18px',
              border: 'none',
              borderBottom: isActive ? `2px solid ${activeColor}` : '2px solid transparent',
              background: 'transparent',
              fontWeight: isActive ? 800 : 600,
              fontSize: 13,
              color: isActive ? activeColor : 'var(--text3)',
              cursor: 'pointer',
              transition: 'color .15s',
              flexShrink: 0,
              minHeight: 44,
            }}
          >
            {t.label}
            {count != null && count > 0 ? ` (${count})` : ''}
          </button>
        );
      })}
    </div>
  );
}
