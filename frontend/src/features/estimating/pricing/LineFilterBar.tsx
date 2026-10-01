// UI cleanup round 2B — the filter chips directly above the line table, plus the
// "Compact rows" switch. Filtering only changes which rows are LISTED; it never
// edits a line.
import React, { forwardRef } from 'react';
import { LINE_FILTERS, type LineFilterKey } from './laborPricingModel';

export interface LineFilterBarProps {
  counts: Record<LineFilterKey, number>;
  active: LineFilterKey;
  shown: number;
  total: number;
  onChoose: (key: LineFilterKey) => void;
  compact: boolean;
  onToggleCompact: () => void;
}

export const LineFilterBar = forwardRef<HTMLDivElement, LineFilterBarProps>(function LineFilterBar(
  { counts, active, shown, total, onChoose, compact, onToggleCompact }, ref,
) {
  return (
    <div className="lp-filterbar" role="group" aria-label="Show lines" data-testid="lp-filter-bar" ref={ref}>
      {LINE_FILTERS.filter(f => f.key === 'all' || counts[f.key] > 0 || f.key === active).map(f => (
        <button
          key={f.key}
          type="button"
          className={`lp-filter-chip${f.key === active ? ' lp-filter-chip-active' : ''}`}
          aria-pressed={f.key === active}
          title={f.title}
          data-testid={f.key === 'holds' ? 'lp-holds-filter' : `lp-filter-${f.key}`}
          onClick={() => onChoose(f.key)}
        >
          {f.key === 'all' ? 'All' : `${f.label} (${counts[f.key]})`}
        </button>
      ))}
      {active !== 'all' && (
        <span className="lp-filter-count" aria-live="polite" data-testid="lp-filter-count">Showing {shown} of {total} lines</span>
      )}
      <button
        type="button"
        className={`lp-filter-chip lp-density${compact ? ' lp-filter-chip-active' : ''}`}
        aria-pressed={compact}
        data-testid="lp-density-toggle"
        onClick={onToggleCompact}
      >
        Compact rows
      </button>
    </div>
  );
});
