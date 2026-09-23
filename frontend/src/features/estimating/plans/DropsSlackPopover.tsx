// Fix round 1 / B8 — a linear run's drops/slack, editable in one place:
// opened automatically the instant a run finishes (Decision 7/Task 5's own
// ask, never actually built), and reachable again later for any already-
// selected linear marker via Toolbar's "Edit drops/slack". Pure
// presentation; PlansWorkspace.tsx owns the actual markupHistory mutation.
import React from 'react';

export interface DropsSlackPopoverProps {
  drops: number;
  dropFt: number | null;
  slackPct: number | null;
  onChange: (patch: { drops?: number; dropFt?: number | null; slackPct?: number | null }) => void;
  onClose: () => void;
}

export default function DropsSlackPopover({ drops, dropFt, slackPct, onChange, onClose }: DropsSlackPopoverProps) {
  return (
    <div className="plan-scale-popover" role="dialog" aria-label="Edit drops and slack" onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') onClose(); }}>
      <div className="plan-scale-popover-row">
        <label htmlFor="plan-drops-count">Drops (count):</label>
        <input
          id="plan-drops-count"
          type="number" min={0} step={1}
          value={drops}
          onChange={e => {
            const raw = Number(e.target.value);
            onChange({ drops: Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0 });
          }}
        />
      </div>
      <div className="plan-scale-popover-row">
        <label htmlFor="plan-drop-ft">Feet per drop:</label>
        <input
          id="plan-drop-ft"
          type="number" min={0} step={0.5}
          value={dropFt ?? ''}
          onChange={e => {
            if (e.target.value.trim() === '') { onChange({ dropFt: null }); return; }
            const raw = Number(e.target.value);
            onChange({ dropFt: Number.isFinite(raw) ? Math.max(0, raw) : null });
          }}
        />
      </div>
      <div className="plan-scale-popover-row">
        <label htmlFor="plan-slack-pct">Slack (%):</label>
        <input
          id="plan-slack-pct"
          type="number" min={0} step={1}
          value={slackPct ?? ''}
          onChange={e => {
            if (e.target.value.trim() === '') { onChange({ slackPct: null }); return; }
            const raw = Number(e.target.value);
            onChange({ slackPct: Number.isFinite(raw) ? Math.max(0, raw) : null });
          }}
        />
      </div>
      <div className="plan-scale-popover-actions">
        <button type="button" className="btn primary sm" onClick={onClose} autoFocus>Done</button>
      </div>
    </div>
  );
}
