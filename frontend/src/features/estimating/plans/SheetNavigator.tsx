// Estimating Phase B, Task 4 — the left-column sheet list: sheet no + title,
// per-sheet marker counts, current-sheet highlight, and Up/Down keyboard
// navigation. UI round 1: the discipline chips are gone. Sheets are grouped
// (Electrical first, then A/M/P, other drawings, then one collapsed group per
// spec book and per set of pages without a sheet number), with a search box.
import React, { useEffect, useId, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { SheetRow, SheetDiscipline } from '../types';

export function sheetKey(documentId: string, pageIndex: number): string {
  return `${documentId}:${pageIndex}`;
}

/** Task 9 (deferral closed), widened by Fix round 1 / S11 — up to 1279px:
 *  the navigator collapses from the full scrollable list column into a
 *  real `<select>` dropdown (previously this range only narrowed the SAME
 *  list column via CSS — a documented gap; a narrow list column is still
 *  a list, not a dropdown). Originally 900-1279px only, with a HARD lower
 *  bound: PlansWorkspace's own Decision 2 view-only mode (<900px) used to
 *  not render SheetNavigator AT ALL, so nothing below 900px ever reached
 *  this hook. S11's fix (PlansWorkspace.tsx now renders SheetNavigator in
 *  view-only mode too) means this component needs a sensible mode all
 *  the way down to phone widths — dropped the 900px floor so "compact"
 *  now just means "at or under 1279px", any width. Same
 *  addEventListener-with-legacy-fallback shape as PlansWorkspace.tsx's
 *  own useIsNarrowViewport(), kept local since the breakpoint and what
 *  changes at it are both specific to this component. */
export function useIsCompactViewport(): boolean {
  const query = '(max-width: 1279px)';
  const getIsCompact = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
  const [isCompact, setIsCompact] = useState(getIsCompact);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const update = () => setIsCompact(mql.matches);
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    const legacy = mql as unknown as { addListener?: (h: () => void) => void; removeListener?: (h: () => void) => void };
    legacy.addListener?.(update);
    return () => legacy.removeListener?.(update);
  }, []);
  return isCompact;
}

const DISCIPLINE_ORDER: SheetDiscipline[] = ['E', 'A', 'M', 'P', 'other'];
const DRAWING_LABEL: Record<string, string> = {
  E: 'Electrical (E)', A: 'Architectural (A)', M: 'Mechanical (M)', P: 'Plumbing (P)', 'other-drawings': 'Other drawings',
};

export type SheetGroup = { id: string; label: string; kind: 'drawing' | 'spec' | 'other'; sheets: SheetRow[] };

function sortSheets(sheets: SheetRow[]): SheetRow[] {
  return [...sheets].sort((a, b) => {
    const da = DISCIPLINE_ORDER.indexOf(a.discipline);
    const db = DISCIPLINE_ORDER.indexOf(b.discipline);
    if (da !== db) return da - db;
    if (a.sheet_no !== b.sheet_no) return a.sheet_no.localeCompare(b.sheet_no, undefined, { numeric: true });
    return a.page_index - b.page_index;
  });
}

const groupOf = (s: SheetRow) => s.page_group ?? 'drawing';

/** Groups the sheet list: drawing groups in E/A/M/P/other order (sorted as
 *  before), then one group per document for spec-book pages, then one per
 *  document for pages with no sheet number. Empty groups are omitted. */
export function groupSheets(sheets: SheetRow[], documentNames: Record<string, string>): SheetGroup[] {
  const out: SheetGroup[] = [];
  const drawings = sheets.filter(s => groupOf(s) === 'drawing');
  for (const id of ['E', 'A', 'M', 'P', 'other-drawings']) {
    const inGroup = drawings.filter(s => (id === 'other-drawings' ? !['E', 'A', 'M', 'P'].includes(s.discipline) : s.discipline === id));
    if (inGroup.length) out.push({ id, label: DRAWING_LABEL[id], kind: 'drawing', sheets: sortSheets(inGroup) });
  }
  const perDoc = (kind: 'spec' | 'other', labelPrefix: string) => {
    const docs: string[] = [];
    for (const s of sheets) if (groupOf(s) === kind && !docs.includes(s.document_id)) docs.push(s.document_id);
    for (const d of docs) {
      const inDoc = sheets.filter(s => groupOf(s) === kind && s.document_id === d).sort((a, b) => a.page_index - b.page_index);
      out.push({ id: `${kind}:${d}`, label: `${labelPrefix} — ${documentNames[d] ?? 'plan file'}`, kind, sheets: inDoc });
    }
  };
  perDoc('spec', 'Spec book');
  perDoc('other', 'Pages without a sheet number');
  return out;
}

/** The sheet to open first: the first sheet of the first drawing group, else the first sheet. */
export function defaultSheet(sheets: SheetRow[]): SheetRow | undefined {
  const firstDrawing = groupSheets(sheets, {}).find(g => g.kind === 'drawing');
  return firstDrawing?.sheets[0] ?? sheets[0];
}

const squash = (x: string) => x.toLowerCase().replace(/[\s-]+/g, '');

/** Case-insensitive on the title; the sheet number matches with spaces and hyphens ignored ("e1" finds "E-1"). */
export function sheetMatches(s: SheetRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if (s.title.toLowerCase().includes(t)) return true;
  const nq = squash(q);
  return nq.length > 0 && squash(s.sheet_no).includes(nq);
}

export interface SheetNavigatorProps {
  sheets: SheetRow[];
  currentKey: string | null;
  onSelect: (documentId: string, pageIndex: number) => void;
  /** sheetKey() -> confirmed marker count, for the small count badge. */
  markerCounts?: Record<string, number>;
  /** document_id -> file name, for group labels and duplicate-number hints. */
  documentNames: Record<string, string>;
  /** UI round 1 — collapse the whole list to a strip (desktop only; the parent decides). */
  onCollapse?: () => void;
  /** Id the parent's collapsed strip points aria-controls at. */
  panelId?: string;
}

const numberLabel = (s: SheetRow, g: SheetGroup) => (g.kind === 'drawing' ? (s.sheet_no || '—') : `p.${s.page_index + 1}`);

export default function SheetNavigator({ sheets, currentKey, onSelect, markerCounts, documentNames, onCollapse, panelId }: SheetNavigatorProps) {
  const isCompact = useIsCompactViewport();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [openState, setOpenState] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupSheets(sheets, documentNames), [sheets, documentNames]);
  const defaultOpenId = groups.find(g => g.id === 'E')?.id ?? groups.find(g => g.kind === 'drawing')?.id;
  const currentGroupId = useMemo(
    () => groups.find(g => g.sheets.some(s => sheetKey(s.document_id, s.page_index) === currentKey))?.id ?? null,
    [groups, currentKey],
  );
  // The group holding the current sheet opens whenever the current sheet changes.
  useEffect(() => {
    if (currentGroupId) setOpenState(p => (p[currentGroupId] ? p : { ...p, [currentGroupId]: true }));
  }, [currentGroupId, currentKey]);

  const searching = query.trim().length > 0;
  const visibleGroups = useMemo(
    () => (searching ? groups.map(g => ({ ...g, sheets: g.sheets.filter(s => sheetMatches(s, query)) })).filter(g => g.sheets.length > 0) : groups),
    [groups, query, searching],
  );
  const isOpen = (g: SheetGroup) => searching || (openState[g.id] ?? g.id === defaultOpenId);
  const visibleSheets = visibleGroups.filter(isOpen).flatMap(g => g.sheets);

  // Sheet numbers that appear in more than one document among the drawing sheets.
  const dupNumbers = useMemo(() => {
    const docsByNo = new Map<string, Set<string>>();
    for (const s of sheets) {
      if (groupOf(s) !== 'drawing' || !s.sheet_no) continue;
      (docsByNo.get(s.sheet_no) ?? docsByNo.set(s.sheet_no, new Set()).get(s.sheet_no)!).add(s.document_id);
    }
    return new Set([...docsByNo].filter(([, d]) => d.size > 1).map(([no]) => no));
  }, [sheets]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    const idx = visibleSheets.findIndex(s => sheetKey(s.document_id, s.page_index) === currentKey);
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = idx < 0 ? 0 : Math.min(visibleSheets.length - 1, Math.max(0, idx + delta));
    const next = visibleSheets[nextIdx];
    if (next) onSelect(next.document_id, next.page_index);
  };

  // At or under 1279px (including phone-width view-only): a real dropdown, with
  // one <optgroup> per group. Up/Down is native <select> behavior.
  if (isCompact) {
    const flat = groups.flatMap(g => g.sheets.map(s => ({ s, g })));
    const currentIndex = flat.findIndex(({ s }) => sheetKey(s.document_id, s.page_index) === currentKey);
    let i = -1;
    return (
      <div className="plan-sheet-nav plan-sheet-nav-dropdown">
        {flat.length === 0 ? (
          <div className="plan-sheet-nav-empty">No sheets yet.</div>
        ) : (
          <select
            className="plan-sheet-nav-select"
            aria-label="Current sheet"
            data-testid="sheet-nav-select"
            value={String(currentIndex)}
            onChange={e => {
              const hit = flat[Number(e.target.value)];
              if (hit) onSelect(hit.s.document_id, hit.s.page_index);
            }}
          >
            {currentIndex < 0 && <option value="-1" disabled>Select a sheet…</option>}
            {groups.map(g => (
              <optgroup key={g.id} label={g.label}>
                {g.sheets.map(s => {
                  i += 1;
                  const key = sheetKey(s.document_id, s.page_index);
                  const count = markerCounts?.[key] ?? 0;
                  const bits = [g.kind === 'drawing' ? (s.sheet_no || '—') : `p.${s.page_index + 1}`, s.title || '(untitled sheet)'];
                  const suffix = [count > 0 ? `${count} marked` : null, !s.has_text_layer ? 'scanned' : null].filter(Boolean).join(', ');
                  return (
                    <option key={key} value={i}>
                      {bits.join(' — ')}{suffix ? ` (${suffix})` : ''}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <nav className="plan-sheet-nav" aria-label="Plan sheets" id={panelId} onKeyDown={onKeyDown}>
      {onCollapse && (
        <div className="plan-sheet-nav-head">
          <button
            type="button"
            className="plan-icon-btn"
            data-testid="plans-sheets-toggle"
            aria-expanded={true}
            aria-controls={panelId}
            aria-label="Collapse sheet list"
            title="Collapse sheet list"
            onClick={onCollapse}
          >
            <Icon name="chevron-down" size={14} stroke={2} style={{ transform: 'rotate(90deg)' }} />
          </button>
        </div>
      )}
      <input
        type="search"
        className="plan-sheet-nav-search"
        placeholder="Find a sheet (e.g. E-1 or lighting)"
        aria-label="Find a sheet"
        data-testid="sheet-nav-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="plan-sheet-nav-list">
        {visibleGroups.length === 0 && (
          <div className="plan-sheet-nav-empty">{searching ? `No sheets match “${query.trim()}”.` : 'No sheets yet.'}</div>
        )}
        {visibleGroups.map(g => {
          const open = isOpen(g);
          const bodyId = `${listId}-${g.id}`;
          return (
            <div key={g.id} className="plan-sheet-group">
              <button
                type="button"
                className="plan-sheet-group-header"
                aria-expanded={open}
                aria-controls={bodyId}
                data-testid={`sheet-group-${g.id}`}
                onClick={() => setOpenState(p => ({ ...p, [g.id]: !open }))}
              >
                <Icon name="chevron-down" size={12} stroke={2} style={{ transform: open ? undefined : 'rotate(-90deg)' }} />
                <span>{g.label}</span>
                <span className="plan-sheet-group-count">{g.sheets.length}</span>
              </button>
              {open && (
                <div id={bodyId}>
                  {g.sheets.map(s => {
                    const key = sheetKey(s.document_id, s.page_index);
                    const count = markerCounts?.[key] ?? 0;
                    const isCurrent = key === currentKey;
                    const showDoc = g.kind === 'drawing' && dupNumbers.has(s.sheet_no);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-current={isCurrent ? 'true' : undefined}
                        className={`plan-sheet-nav-item${isCurrent ? ' current' : ''}`}
                        onClick={() => onSelect(s.document_id, s.page_index)}
                        data-testid={`sheet-${key}`}
                      >
                        <span className="plan-sheet-nav-no">{numberLabel(s, g)}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="plan-sheet-nav-title">{s.title || '(untitled sheet)'}</span>
                          {showDoc && <span className="plan-sheet-nav-doc">{documentNames[s.document_id] ?? ''}</span>}
                        </span>
                        {count > 0 && <span className="plan-sheet-nav-count">{count}</span>}
                        {!s.has_text_layer && <span className="plan-sheet-nav-scanned" title="Scanned — no text layer">Scanned</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
