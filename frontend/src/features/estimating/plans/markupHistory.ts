// Estimating Phase B, Task 5 — undo/redo for the markup draft list. Pure:
// a snapshot-based history (push the whole markups array before a mutating
// action, move a pointer to undo/redo) rather than inverse-operation
// patches — simpler to get exactly right, and a plan sheet's marker count
// (hundreds, per the plan's own "1,000 markers" performance bar) is cheap
// to snapshot. Covers create, move (a point/points update), delete, and
// reassign (Task 5: "Undo/redo stack covers create, move, delete,
// reassign, scale changes") — a scale change lives in est_sheets, not
// est_markups, and is undoable the same way (see ScaleHistory below).

export interface MarkupPoint {
  x: number;
  y: number;
}

export interface MarkupDraft {
  /** Client-generated uuid — stable across the whole draft/autosave
   *  lifecycle (Task 3's idempotent-by-id batch create). */
  id: string;
  documentId: string;
  pageIndex: number;
  lineKey: string | null;
  kind: 'count' | 'linear';
  points: MarkupPoint[];
  drops: number;
  dropFt: number | null;
  slackPct: number | null;
  status: 'confirmed' | 'suggested';
  label: string | null;
  /** Takeoff accuracy Task 6 — 'ai_count' for an AI-counted suggestion
   *  (rendered with an "AI" badge). Read-only on the client: never sent to
   *  the server (useMarkupAutosave's toWireMarkup omits it). */
  source?: 'ai_count' | null;
}

export interface HistoryState<T> {
  /** Snapshots, oldest first. `past[past.length - 1]` is one step before
   *  `present`; `future[0]` is one step after (populated only after an
   *  undo, cleared by any new mutating action). */
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY = 200;

export function initHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/** Pushes `present` onto `past` and installs `next` as the new present,
 *  clearing `future` (a new action after an undo abandons the redone
 *  branch — the standard editor convention). Caps `past` at MAX_HISTORY so
 *  a very long editing session doesn't grow memory unbounded. */
export function commit<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  const past = [...state.past, state.present];
  while (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [] };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state;
  const next = state.future[0];
  return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}
export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}

/** Replaces `present` with `next` WITHOUT pushing a history entry — for
 *  syncing in a server-confirmed value (e.g. after a successful autosave
 *  batch, the server may have assigned/normalized something) without
 *  creating a spurious undo step, and for the initial load from the
 *  server. */
export function replacePresent<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return { ...state, present: next };
}

// ── Markup-list-specific mutation helpers ───────────────────────────────
// Thin, pure helpers over MarkupDraft[] — commit() above is generic over
// any T, these are the T=MarkupDraft[] operations the Select/Count/Linear
// tools actually perform.

export function createMarkup(markups: MarkupDraft[], markup: MarkupDraft): MarkupDraft[] {
  return [...markups, markup];
}

export function updateMarkup(markups: MarkupDraft[], id: string, patch: Partial<MarkupDraft>): MarkupDraft[] {
  return markups.map(m => (m.id === id ? { ...m, ...patch } : m));
}

export function deleteMarkups(markups: MarkupDraft[], ids: string[]): MarkupDraft[] {
  const idSet = new Set(ids);
  return markups.filter(m => !idSet.has(m.id));
}

export function reassignMarkups(markups: MarkupDraft[], ids: string[], lineKey: string | null): MarkupDraft[] {
  const idSet = new Set(ids);
  return markups.map(m => (idSet.has(m.id) ? { ...m, lineKey } : m));
}

export function moveMarkup(markups: MarkupDraft[], id: string, points: MarkupPoint[]): MarkupDraft[] {
  return updateMarkup(markups, id, { points });
}
