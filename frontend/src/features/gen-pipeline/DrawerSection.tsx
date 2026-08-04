// A foldable block in the proposal drawer.
//
// The Overview tab shows a lot that matters only occasionally — the lifecycle timeline,
// the spec list, the sizer slot, the file list. Folding them keeps the action bar and the
// live status above the fold without hiding anything: every section is one tap away, and
// the ones a rep opens constantly (options, documents) can default to open.
import React, { useState } from 'react';

interface Props {
  title: string;
  /** Short right-aligned summary so a folded section still says something useful. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function DrawerSection({ title, hint, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: '1px solid var(--border2)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', minHeight: 44,
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em',
          color: 'var(--text3)', flex: 1,
        }}>
          {title}
        </span>
        {hint && <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{hint}</span>}
        <span style={{
          fontSize: 12, color: 'var(--text3)',
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
        }}>›</span>
      </button>
      {open && <div style={{ paddingBottom: 14 }}>{children}</div>}
    </div>
  );
}
