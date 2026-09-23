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
  /** Task 6 (deferral closed) — both require 1+ selected markers, same
   *  gating as Delete. Omitted entirely hides the buttons (e.g. view-only
   *  contexts that never render a Toolbar at all already skip this, but
   *  keeping these optional matches the rest of this component's props). */
  onNewLineFromMarkup?: () => void;
  onReassignSelected?: () => void;
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
  onNewLineFromMarkup, onReassignSelected,
}: ToolbarProps) {
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
      if (tool && (tool !== 'scale' || !scaleDisabledReason)) {
        dispatch({ type: 'SELECT_TOOL', tool });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, onUndo, onRedo, onDeleteSelected, hasSelection, scaleDisabledReason]);

  return (
    <div className="plan-tools" role="group" aria-label="Markup tools">
      {TOOLS.map(t => {
        const disabled = t.id === 'scale' && !!scaleDisabledReason;
        return (
          <button
            key={t.id}
            className={`plan-toolbar-btn${toolState.tool === t.id ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SELECT_TOOL', tool: t.id })}
            disabled={disabled}
            title={disabled ? scaleDisabledReason ?? undefined : `${t.label} (${t.shortcut})`}
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
    </div>
  );
}
