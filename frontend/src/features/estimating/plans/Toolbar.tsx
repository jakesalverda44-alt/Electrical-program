// Estimating Phase B, Task 5 — the tool selector + undo/redo + delete row.
// A thin presentational wrapper over toolMachine.ts's ToolState — all the
// actual state transitions live there (already exhaustively tested); this
// component only renders buttons and forwards clicks/keys to dispatch().
import React, { useEffect } from 'react';
import { ToolId, ToolState, ToolEvent } from './toolMachine';

export interface ToolbarProps {
  toolState: ToolState;
  dispatch: (event: ToolEvent) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  scaleDisabledReason: string | null;
  /** Fix round 1 / B2 — while set, BOTH Count and Linear are disabled: a
   *  marker drawn against a "proposed-N" placeholder line_key (the only
   *  kind of line_key that exists before the estimate has ever been
   *  saved) can never survive past this session — the server mints a
   *  real line_key only once the mapping is actually saved, so nothing
   *  drawn beforehand can ever be reassigned to it after the fact.
   *  Drawing is blocked until the estimate is saved (see PlansWorkspace.
   *  tsx's "Save the estimate to start marking up plans" banner). */
  countLinearDisabledReason?: string | null;
  /** Fix round 1 / B7 — Linear specifically (never Count — a count marker
   *  doesn't measure length) is ALSO disabled until the sheet has a
   *  confirmed scale (calibrated, or a confirmed title-block suggestion):
   *  a run drawn with no scale can't be measured, and the rollup would
   *  just silently exclude it (missingScaleCount) with nothing on screen
   *  saying why the applied LF qty came out short. Combines with (never
   *  overridden by) countLinearDisabledReason — whichever reason applies
   *  first wins for Linear's own button/shortcut. */
  linearDisabledReason?: string | null;
  /** Fix round 1 / S8 — Count specifically is disabled when the ACTIVE
   *  line's unit is LF/C/M — a count marker on a linear-quantity line can
   *  never contribute to its rollup (rollupLines filters strictly by
   *  kind-vs-unit-family, counting anything else as `incompatibleCount`,
   *  which nothing on screen used to surface at all). Combines with
   *  (never overridden by) countLinearDisabledReason. Never set at all
   *  when no line is active — drawing "unassigned" is always allowed. */
  countDisabledReason?: string | null;
  /** Task 6 (deferral closed) — both require 1+ selected markers, same
   *  gating as Delete. Omitted entirely hides the buttons (e.g. view-only
   *  contexts that never render a Toolbar at all already skip this, but
   *  keeping these optional matches the rest of this component's props). */
  onNewLineFromMarkup?: () => void;
  onReassignSelected?: () => void;
  /** Fix round 1 / B8 — shown whenever provided; disabled unless the
   *  current selection is exactly one linear marker (the caller decides
   *  that, same convention as the other per-button disabled reasons on
   *  this component). */
  onEditDropsSlack?: () => void;
  editDropsSlackDisabled?: boolean;
}

const TOOLS: { id: ToolId; label: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'count', label: 'Count', shortcut: 'C' },
  { id: 'linear', label: 'Linear', shortcut: 'L' },
  { id: 'scale', label: 'Scale', shortcut: 'S' },
];

const SHORTCUT_TO_TOOL: Record<string, ToolId> = { v: 'select', c: 'count', l: 'linear', s: 'scale' };

export default function Toolbar({
  toolState, dispatch, onUndo, onRedo, canUndo, canRedo, onDeleteSelected, hasSelection, scaleDisabledReason,
  countLinearDisabledReason, linearDisabledReason, countDisabledReason, onNewLineFromMarkup, onReassignSelected,
  onEditDropsSlack, editDropsSlackDisabled,
}: ToolbarProps) {
  // Fix round 1 / B2/B7/S8 — one lookup covers both the click handler's
  // `disabled` and the keyboard shortcut gate below, so the two can never
  // drift apart (a tool disabled in the UI but still reachable via 'c'/'l'
  // would be its own bug).
  const disabledReasonFor = (id: ToolId): string | null => {
    if (id === 'scale') return scaleDisabledReason;
    if (id === 'count') return countLinearDisabledReason ?? countDisabledReason ?? null;
    if (id === 'linear') return countLinearDisabledReason ?? linearDisabledReason ?? null;
    return null;
  };

  // Keyboard shortcuts: V/C/L/S select a tool, Delete/Backspace removes the
  // current selection, Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes. Ignored
  // while focus is in a text input (a label field, a known-length popover)
  // so typing "c" there doesn't switch tools out from under the estimator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (hasSelection) { e.preventDefault(); onDeleteSelected(); }
        return;
      }
      const tool = SHORTCUT_TO_TOOL[e.key.toLowerCase()];
      if (tool && !disabledReasonFor(tool)) {
        dispatch({ type: 'SELECT_TOOL', tool });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, onUndo, onRedo, onDeleteSelected, hasSelection, scaleDisabledReason, countLinearDisabledReason, linearDisabledReason, countDisabledReason]);

  return (
    <div className="plan-tools" role="group" aria-label="Markup tools">
      {TOOLS.map(t => {
        const reason = disabledReasonFor(t.id);
        const disabled = !!reason;
        return (
          <button
            key={t.id}
            className={`plan-toolbar-btn${toolState.tool === t.id ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SELECT_TOOL', tool: t.id })}
            disabled={disabled}
            title={disabled ? reason ?? undefined : `${t.label} (${t.shortcut})`}
          >
            {t.label}
          </button>
        );
      })}
      <button className="plan-toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button className="plan-toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
      <button className="plan-toolbar-btn" onClick={onDeleteSelected} disabled={!hasSelection} title="Delete (Del)">Delete</button>
      {onNewLineFromMarkup && (
        <button className="plan-toolbar-btn" onClick={onNewLineFromMarkup} disabled={!hasSelection} title="Create a new takeoff line from the selected marker(s)">
          New line from markup
        </button>
      )}
      {onReassignSelected && (
        <button className="plan-toolbar-btn" onClick={onReassignSelected} disabled={!hasSelection} title="Reassign the selected marker(s) to a different line">
          Reassign to line…
        </button>
      )}
      {onEditDropsSlack && (
        <button className="plan-toolbar-btn" onClick={onEditDropsSlack} disabled={!!editDropsSlackDisabled} title="Edit this run's drops and slack">
          Edit drops/slack
        </button>
      )}
    </div>
  );
}
