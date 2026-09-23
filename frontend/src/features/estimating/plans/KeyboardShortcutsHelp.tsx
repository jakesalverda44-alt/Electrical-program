// Estimating Phase B, Task 9 — keyboard shortcut help ("?"). A plain list
// inside the shared Modal — no new interaction model, just documenting the
// ones Toolbar.tsx/PlanViewer.tsx already implement.
import React from 'react';
import Modal from '../../../components/Modal';

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'V', description: 'Select / Pan tool' },
  { keys: 'C', description: 'Count tool' },
  { keys: 'L', description: 'Linear tool' },
  { keys: 'S', description: 'Scale tool' },
  { keys: 'Click', description: 'Place a count marker, or add a point to a linear run' },
  { keys: 'Double-click / Enter', description: 'Finish a linear run' },
  { keys: 'Esc', description: 'Cancel the current draw/calibration, or clear the selection' },
  { keys: 'Shift-click', description: 'Add a marker to the current selection' },
  { keys: 'Delete / Backspace', description: 'Delete the selected marker(s)' },
  { keys: '⌘Z / Ctrl+Z', description: 'Undo' },
  { keys: '⇧⌘Z / Ctrl+Shift+Z', description: 'Redo' },
  { keys: '+ / −', description: 'Zoom in / out' },
  { keys: 'Ctrl/⌘ + scroll', description: 'Zoom around the cursor' },
  { keys: '?', description: 'Show this help' },
];

export interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsHelp({ open, onClose }: KeyboardShortcutsHelpProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <table className="plan-shortcuts-table">
        <tbody>
          {SHORTCUTS.map(s => (
            <tr key={s.keys}>
              <td className="plan-shortcuts-keys">{s.keys}</td>
              <td>{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
