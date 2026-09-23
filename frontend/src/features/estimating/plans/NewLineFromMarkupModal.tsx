// Estimating Phase B, Task 6 (deferral closed) — "New line from markup".
// Same resolver pattern as LaborPricingStep.tsx's "Resolve line" modal
// (search the library, pick an item/assembly, or fall back to a manual
// $/hours line) — the Phase A resolver the coordinator asked this reuse —
// but building a BRAND NEW line from scratch (category/description/qty)
// instead of resolving an existing takeoff-sourced one. The line's qty
// defaults to the selected marker count and is editable (a count marker
// might represent more than "1 of something", e.g. a gang box with 3
// devices marked as one marker).
import React, { useMemo, useState } from 'react';
import { Library, EstUnit } from '../types';
import Modal from '../../../components/Modal';

// Duplicated from LaborPricingStep.tsx's own copy — same reasoning as its
// header comment: the frontend has no reason to import backend code, and
// this is a small enough rule to keep local to each component that needs
// it rather than force a shared-util extraction across two features.
function unitFamily(u: string): 'EA' | 'LINEAR' | 'OTHER' {
  const n = (u ?? '').trim().toUpperCase();
  if (n === 'EA') return 'EA';
  if (n === 'LF' || n === 'C' || n === 'M') return 'LINEAR';
  return 'OTHER';
}
function isUnitCompatible(a: string, b: string): boolean {
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (fa === 'OTHER' || fb === 'OTHER') return false;
  return fa === fb;
}

export interface NewLineFromMarkupInput {
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  itemId: string | null;
  assemblyId: string | null;
  materialUnitOverride: number | null;
  laborHoursOverride: number | null;
}

export interface NewLineFromMarkupModalProps {
  open: boolean;
  /** How many selected markers this new line will be assigned to on
   *  create — shown to the estimator, and the qty field's default. */
  selectedCount: number;
  /** Fixed to the KIND of the selected markers (count -> EA, linear -> LF)
   *  — matches the existing markers, since re-typing the unit here
   *  wouldn't change what's actually drawn on the sheet. */
  unit: EstUnit;
  categories: readonly string[];
  library: Library | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: NewLineFromMarkupInput) => void;
}

export default function NewLineFromMarkupModal({
  open, selectedCount, unit, categories, library, busy, onCancel, onCreate,
}: NewLineFromMarkupModalProps) {
  const [category, setCategory] = useState<string>(categories[0] ?? '');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState(String(selectedCount || 1));
  const [query, setQuery] = useState('');
  const [manualMaterial, setManualMaterial] = useState('');
  const [manualHours, setManualHours] = useState('');

  // Re-seed the form defaults each time the modal opens (a stale qty/
  // category from a previous open must never leak into a new one).
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setCategory(categories[0] ?? '');
    setDescription('');
    setQty(String(selectedCount || 1));
    setQuery('');
    setManualMaterial('');
    setManualHours('');
  }
  if (open !== lastOpen) setLastOpen(open);

  const candidates = useMemo(() => {
    // Defensive against a malformed/partial Library (e.g. an endpoint that
    // hasn't resolved yet and briefly returns `{}`) — this modal is kept
    // mounted (just closed) by PlansWorkspace the whole time the Plans
    // view is open, so its hooks run on every render regardless of `open`,
    // well before the very last `if (!open) return null` below.
    if (!library || !Array.isArray(library.assemblies) || !Array.isArray(library.items)) return [];
    const q = query.trim().toLowerCase();
    const all: { kind: 'assembly' | 'item'; id: string; name: string; unit: string }[] = [
      ...library.assemblies.filter(a => a.active).map(a => ({ kind: 'assembly' as const, id: a.id, name: a.name, unit: a.unit })),
      ...library.items.filter(i => i.active).map(i => ({ kind: 'item' as const, id: i.id, name: i.name, unit: i.unit })),
    ].filter(c => isUnitCompatible(c.unit, unit));
    if (!q) return all.slice(0, 25);
    return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25);
  }, [library, query, unit]);

  if (!open) return null;

  const qtyNum = Number(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum >= 0;
  // A library pick doesn't require the estimator to have typed a
  // description first — its own name becomes the description (still
  // editable afterward, on the resulting line, same as any other line).
  // The manual (no library match) path has no such fallback, so it does
  // require an explicit description.
  const canPickCandidate = qtyValid && !busy;
  const canKeepManual = qtyValid && !busy && description.trim() !== '' && (manualMaterial.trim() !== '' || manualHours.trim() !== '');

  const submit = (
    resolved: { itemId: string | null; assemblyId: string | null } | null,
    manual: boolean,
    fallbackDescription?: string
  ) => {
    const desc = description.trim() || fallbackDescription?.trim() || '';
    if (desc === '' || !qtyValid || busy) return;
    onCreate({
      category,
      description: desc,
      qty: qtyNum,
      unit,
      itemId: resolved?.itemId ?? null,
      assemblyId: resolved?.assemblyId ?? null,
      materialUnitOverride: manual ? (manualMaterial.trim() === '' ? 0 : Number(manualMaterial)) : null,
      laborHoursOverride: manual ? (manualHours.trim() === '' ? 0 : Number(manualHours)) : null,
    });
  };

  return (
    <Modal open onClose={onCancel} title="New line from markup">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 340 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {selectedCount} marker{selectedCount === 1 ? '' : 's'} selected — will be attached to this line once created.
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Category
          <select value={category} onChange={e => setCategory(e.target.value)} data-testid="nlfm-category">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Description
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Type A1 - 2x4 LED troffer"
            data-testid="nlfm-description"
            autoFocus
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Qty ({unit})
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} data-testid="nlfm-qty" />
        </label>

        <input
          placeholder="Search items and assemblies…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          data-testid="nlfm-search"
        />
        <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {candidates.map(c => (
            <button
              key={`${c.kind}-${c.id}`}
              type="button"
              className="btn ghost"
              style={{ justifyContent: 'flex-start' }}
              disabled={!canPickCandidate}
              data-testid={`nlfm-candidate-${c.id}`}
              onClick={() => submit({ itemId: c.kind === 'item' ? c.id : null, assemblyId: c.kind === 'assembly' ? c.id : null }, false, c.name)}
            >
              {c.name} <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{c.unit}</span>
            </button>
          ))}
          {candidates.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>No unit-compatible library items match.</div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            No match? Keep it as a manual line — enter a material $ or labor hours value.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" placeholder="Material $" value={manualMaterial} onChange={e => setManualMaterial(e.target.value)} data-testid="nlfm-manual-material" />
            <input type="number" placeholder="Labor hours" value={manualHours} onChange={e => setManualHours(e.target.value)} data-testid="nlfm-manual-hours" />
          </div>
          <button
            type="button"
            className="btn ghost"
            data-testid="nlfm-keep-manual"
            disabled={!canKeepManual}
            onClick={() => submit(null, true)}
          >
            {busy ? 'Creating…' : 'Keep as manual line'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
