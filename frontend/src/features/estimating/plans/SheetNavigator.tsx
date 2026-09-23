// Estimating Phase B, Task 4 — the left-column sheet list: sheet no + title,
// a discipline filter ("E" sheets first, matching the plan's own priority
// for an electrical estimator), per-sheet marker counts, current-sheet
// highlight, and Up/Down keyboard navigation.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SheetRow, SheetDiscipline } from '../types';

export function sheetKey(documentId: string, pageIndex: number): string {
  return `${documentId}:${pageIndex}`;
}

/** Task 9 (deferral closed) — 900-1279px: the navigator collapses from the
 *  full scrollable list column into a real `<select>` dropdown (previously
 *  this range only narrowed the SAME list column via CSS — a documented
 *  gap; a narrow list column is still a list, not a dropdown). Below
 *  900px, PlansWorkspace's own Decision 2 view-only mode doesn't render
 *  SheetNavigator at all, so this hook only ever matters in the range it's
 *  named for. Same addEventListener-with-legacy-fallback shape as
 *  PlansWorkspace.tsx's own useIsNarrowViewport(), kept local since the
 *  breakpoint and what changes at it are both specific to this component. */
function useIsMidViewport(): boolean {
  const query = '(min-width: 900px) and (max-width: 1279px)';
  const getIsMid = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
  const [isMid, setIsMid] = useState(getIsMid);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const update = () => setIsMid(mql.matches);
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    const legacy = mql as unknown as { addListener?: (h: () => void) => void; removeListener?: (h: () => void) => void };
    legacy.addListener?.(update);
    return () => legacy.removeListener?.(update);
  }, []);
  return isMid;
}

const DISCIPLINE_ORDER: SheetDiscipline[] = ['E', 'A', 'M', 'P', 'other'];
const DISCIPLINE_LABEL: Record<SheetDiscipline, string> = {
  E: 'Electrical', A: 'Architectural', M: 'Mechanical', P: 'Plumbing', other: 'Other',
};

export interface SheetNavigatorProps {
  sheets: SheetRow[];
  currentKey: string | null;
  onSelect: (documentId: string, pageIndex: number) => void;
  /** sheetKey() -> confirmed marker count, for the small count badge. */
  markerCounts?: Record<string, number>;
  disciplineFilter: SheetDiscipline | 'all';
  onDisciplineFilterChange: (d: SheetDiscipline | 'all') => void;
}

function sortSheets(sheets: SheetRow[]): SheetRow[] {
  return [...sheets].sort((a, b) => {
    const da = DISCIPLINE_ORDER.indexOf(a.discipline);
    const db = DISCIPLINE_ORDER.indexOf(b.discipline);
    if (da !== db) return da - db;
    if (a.sheet_no !== b.sheet_no) return a.sheet_no.localeCompare(b.sheet_no, undefined, { numeric: true });
    return a.page_index - b.page_index;
  });
}

export default function SheetNavigator({ sheets, currentKey, onSelect, markerCounts, disciplineFilter, onDisciplineFilterChange }: SheetNavigatorProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isMid = useIsMidViewport();

  const disciplinesPresent = useMemo(() => {
    const set = new Set(sheets.map(s => s.discipline));
    return DISCIPLINE_ORDER.filter(d => set.has(d));
  }, [sheets]);

  const filtered = useMemo(() => {
    const base = disciplineFilter === 'all' ? sheets : sheets.filter(s => s.discipline === disciplineFilter);
    return sortSheets(base);
  }, [sheets, disciplineFilter]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = filtered.findIndex(s => sheetKey(s.document_id, s.page_index) === currentKey);
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = idx < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, idx + delta));
    const next = filtered[nextIdx];
    if (next) onSelect(next.document_id, next.page_index);
  };

  const filterChips = (
    <div className="plan-sheet-nav-filter">
      <button
        className={`plan-sheet-nav-chip${disciplineFilter === 'all' ? ' active' : ''}`}
        onClick={() => onDisciplineFilterChange('all')}
      >
        All
      </button>
      {disciplinesPresent.map(d => (
        <button
          key={d}
          className={`plan-sheet-nav-chip${disciplineFilter === d ? ' active' : ''}`}
          onClick={() => onDisciplineFilterChange(d)}
          title={DISCIPLINE_LABEL[d]}
        >
          {d}
        </button>
      ))}
    </div>
  );

  // Task 9 (deferral closed) — 900-1279px: a real dropdown, not a narrowed
  // copy of the full list. The discipline filter chips still narrow what
  // the dropdown itself offers; Up/Down navigation is native <select>
  // behavior, so there's no separate onKeyDown handler to wire here.
  if (isMid) {
    const currentIndex = filtered.findIndex(s => sheetKey(s.document_id, s.page_index) === currentKey);
    return (
      <div className="plan-sheet-nav plan-sheet-nav-dropdown">
        {filterChips}
        {filtered.length === 0 ? (
          <div className="plan-sheet-nav-empty">No sheets match this filter.</div>
        ) : (
          <select
            className="plan-sheet-nav-select"
            aria-label="Current sheet"
            data-testid="sheet-nav-select"
            value={String(currentIndex)}
            onChange={e => {
              const s = filtered[Number(e.target.value)];
              if (s) onSelect(s.document_id, s.page_index);
            }}
          >
            {currentIndex < 0 && <option value="-1" disabled>Select a sheet…</option>}
            {filtered.map((s, i) => {
              const key = sheetKey(s.document_id, s.page_index);
              const count = markerCounts?.[key] ?? 0;
              const bits = [s.sheet_no || '—', s.title || '(untitled sheet)'];
              const suffix = [count > 0 ? `${count} marked` : null, !s.has_text_layer ? 'scanned' : null].filter(Boolean).join(', ');
              return (
                <option key={key} value={i}>
                  {bits.join(' — ')}{suffix ? ` (${suffix})` : ''}
                </option>
              );
            })}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="plan-sheet-nav" role="listbox" aria-label="Plan sheets" tabIndex={0} onKeyDown={onKeyDown} ref={listRef}>
      {filterChips}
      <div className="plan-sheet-nav-list">
        {filtered.length === 0 && <div className="plan-sheet-nav-empty">No sheets match this filter.</div>}
        {filtered.map(s => {
          const key = sheetKey(s.document_id, s.page_index);
          const count = markerCounts?.[key] ?? 0;
          const isCurrent = key === currentKey;
          return (
            <button
              key={key}
              role="option"
              aria-selected={isCurrent}
              className={`plan-sheet-nav-item${isCurrent ? ' current' : ''}`}
              onClick={() => onSelect(s.document_id, s.page_index)}
              data-testid={`sheet-${key}`}
            >
              <span className="plan-sheet-nav-no">{s.sheet_no || '—'}</span>
              <span className="plan-sheet-nav-title">{s.title || '(untitled sheet)'}</span>
              {count > 0 && <span className="plan-sheet-nav-count">{count}</span>}
              {!s.has_text_layer && <span className="plan-sheet-nav-scanned" title="Scanned — no text layer">Scanned</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
