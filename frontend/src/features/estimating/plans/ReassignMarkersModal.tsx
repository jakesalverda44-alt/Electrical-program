// Estimating Phase B, Task 6 (deferral closed) — reassigning one or more
// SELECTED markers to a different (existing) line, or explicitly
// unassigning them. Pairs with markupHistory.ts's already-tested
// reassignMarkups() — this is purely the picker UI over it.
import React, { useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import { EstimateLine } from '../types';

export interface ReassignMarkersModalProps {
  open: boolean;
  selectedCount: number;
  lines: EstimateLine[];
  onCancel: () => void;
  /** null = explicitly unassign (the "unassigned markers" bucket). */
  onReassign: (lineKey: string | null) => void;
}

export default function ReassignMarkersModal({ open, selectedCount, lines, onCancel, onReassign }: ReassignMarkersModalProps) {
  const [query, setQuery] = useState('');

  // Reset the search on every open — a stale filter from a previous use
  // must never hide the line the estimator is now looking for.
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) setQuery('');
  if (open !== lastOpen) setLastOpen(open);

  // Only a SAVED line (one with a server-assigned line_key) can receive a
  // reassignment — a brand-new, not-yet-saved manual line has nothing
  // est_markups.line_key could point at yet (same rule "New line from
  // markup" exists to solve: create the line first, THEN it has a key).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withKey = lines.filter((l): l is EstimateLine & { line_key: string } => !!l.line_key);
    if (!q) return withKey.slice(0, 50);
    return withKey.filter(l => l.description.toLowerCase().includes(q) || l.category.toLowerCase().includes(q)).slice(0, 50);
  }, [lines, query]);

  if (!open) return null;

  return (
    <Modal open onClose={onCancel} title="Reassign to line">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 340 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {selectedCount} marker{selectedCount === 1 ? '' : 's'} selected.
        </div>
        <input
          placeholder="Search lines by description or category…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          data-testid="ram-search"
          autoFocus
        />
        <div style={{ maxHeight: 280, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {candidates.map(l => (
            <button
              key={l.line_key}
              type="button"
              className="btn ghost"
              style={{ justifyContent: 'flex-start' }}
              data-testid={`ram-line-${l.line_key}`}
              onClick={() => onReassign(l.line_key as string)}
            >
              {l.description} <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{l.category}</span>
            </button>
          ))}
          {candidates.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>No saved lines match.</div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <button type="button" className="btn ghost" data-testid="ram-unassign" onClick={() => onReassign(null)}>
            Unassign (remove from any line)
          </button>
        </div>
      </div>
    </Modal>
  );
}
