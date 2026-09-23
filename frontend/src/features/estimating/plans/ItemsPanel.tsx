// Estimating Phase B, Task 6 — the Plans view's right-hand items panel:
// est_bid_lines grouped by category, AI/marked/current qty, a status chip,
// "Apply marked qty" per line and "Apply all that differ" (with a $ impact
// preview), and a jump-to-active-line toggle. "New line from markup" (a
// manual line + library resolver) is NOT built here — see the Phase B
// report's deferrals; everything else in Task 6 is.
import React, { useMemo, useState } from 'react';
import { EstimateLine, RollupEntry } from '../types';
import { TAKEOFF_CATEGORIES } from '../categories';
import { computeLineStatus, STATUS_LABEL, LineMarkupStatus } from './itemsPanelStatus';
import { useConfirm } from '../../../components/ConfirmDialog';
import Badge, { BadgeTone } from '../../../components/Badge';

const STATUS_TONE: Record<LineMarkupStatus, BadgeTone> = {
  applied: 'good', changed_since_applied: 'warn', matches: 'info', differs: 'warn', not_marked: 'neutral',
};

// Fix round 1 / B6 — 'changed_since_applied' behaves exactly like 'differs'
// everywhere a status feeds the bulk Apply flow: it's still "there's a
// marked qty that hasn't reached the line yet", whether the line was
// never applied or was applied once and has since diverged. Deliberately
// excludes 'not_marked' (nothing to apply at all) — same as the original
// 'differs'-only set.
function hasUnappliedMarkedQty(status: LineMarkupStatus): boolean {
  return status === 'differs' || status === 'changed_since_applied';
}

function groupByCategory(lines: EstimateLine[]): { category: string; lines: EstimateLine[] }[] {
  const byCategory = new Map<string, EstimateLine[]>();
  for (const l of lines) {
    const list = byCategory.get(l.category) ?? [];
    list.push(l);
    byCategory.set(l.category, list);
  }
  const known = TAKEOFF_CATEGORIES.filter(c => byCategory.has(c));
  const extra = Array.from(byCategory.keys()).filter(c => !(TAKEOFF_CATEGORIES as readonly string[]).includes(c)).sort();
  return [...known, ...extra].map(category => ({ category, lines: byCategory.get(category)! }));
}

function fmtQty(v: number | string | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export interface ItemsPanelProps {
  lines: EstimateLine[];
  rollup: RollupEntry[];
  activeLineKey: string | null;
  onSelectLine: (lineKey: string) => void;
  onApplyLines: (lineKeys: string[]) => Promise<void>;
  onJumpToSource?: (line: EstimateLine) => void;
  showOnlyActiveLine: boolean;
  onToggleShowOnlyActiveLine: () => void;
  /** $ impact preview for a set of candidate lines — resolves to the
   *  grand-total delta (new - current) if applied. Optional: the confirm
   *  dialog shows the change list without a $ figure when omitted (e.g. a
   *  test harness with no pricing endpoint wired up). */
  previewPriceImpact?: (lineKeys: string[]) => Promise<number>;
  /** Task 7 (deferral closed) — "Suggest markers" for ONE line, on the
   *  sheet currently open in the viewer (candidate tags are derived from
   *  this line's own description — see tagSuggest.ts's
   *  candidateTagsFromDescription). Omitted entirely hides the button
   *  (e.g. a read-only context). */
  onSuggestMarkersForLine?: (line: EstimateLine) => void;
  /** Task 6 (deferral closed) — the unassigned-markers bucket: CONFIRMED
   *  markers with no line_key, grouped by sheet (PlansWorkspace computes
   *  this from its own markup draft list — ItemsPanel has no markup data
   *  of its own). Omitted/empty hides the section entirely. */
  unassignedMarkers?: { sheetKey: string; label: string; count: number }[];
  onJumpToUnassigned?: (sheetKey: string) => void;
}

export default function ItemsPanel({
  lines, rollup, activeLineKey, onSelectLine, onApplyLines, onJumpToSource,
  showOnlyActiveLine, onToggleShowOnlyActiveLine, previewPriceImpact, onSuggestMarkersForLine,
  unassignedMarkers, onJumpToUnassigned,
}: ItemsPanelProps) {
  const confirm = useConfirm();
  const [applyingKeys, setApplyingKeys] = useState<Set<string>>(new Set());

  const rollupByKey = useMemo(() => new Map(rollup.map(r => [r.lineKey, r])), [rollup]);
  const groups = useMemo(() => groupByCategory(lines), [lines]);

  const differingKeys = useMemo(
    () => lines
      .filter(l => l.line_key && hasUnappliedMarkedQty(computeLineStatus(l, rollupByKey.get(l.line_key))))
      .map(l => l.line_key as string),
    [lines, rollupByKey]
  );

  // Fix round 1 / S8 — incompatibleCount (a marker of the wrong kind for
  // this line's unit — a count marker on an LF line, or vice versa) and
  // missingScaleCount (a linear run on a sheet with no scale set) were
  // already computed by the backend rollup but nothing on the frontend
  // ever read them: applyMarkups applied whatever markedQty existed with
  // no warning that some of what was drawn on the sheet never made it
  // into that number.
  function partialRollupWarning(r: RollupEntry | undefined): string | null {
    if (!r) return null;
    const parts: string[] = [];
    if (r.incompatibleCount > 0) parts.push(`${r.incompatibleCount} marker${r.incompatibleCount === 1 ? '' : 's'} of the wrong type for this line's unit`);
    if (r.missingScaleCount > 0) parts.push(`${r.missingScaleCount} marker${r.missingScaleCount === 1 ? '' : 's'} on a sheet with no scale set`);
    if (parts.length === 0) return null;
    return `${parts.join(' and ')} will NOT be included in this quantity.`;
  }

  async function applyOne(lineKey: string) {
    const warning = partialRollupWarning(rollupByKey.get(lineKey));
    if (warning) {
      const ok = await confirm({ title: 'Some markers were excluded from this rollup', body: warning, confirmLabel: 'Apply anyway' });
      if (!ok) return;
    }
    setApplyingKeys(prev => new Set(prev).add(lineKey));
    try {
      await onApplyLines([lineKey]);
    } finally {
      setApplyingKeys(prev => { const next = new Set(prev); next.delete(lineKey); return next; });
    }
  }

  async function applyAllDiffering() {
    if (differingKeys.length === 0) return;
    const changes = differingKeys.map(key => {
      const l = lines.find(x => x.line_key === key)!;
      const r = rollupByKey.get(key);
      return { line: l, from: l.qty, to: r?.markedQty ?? l.qty };
    });
    const impact = previewPriceImpact ? await previewPriceImpact(differingKeys).catch(() => null) : null;
    // Fix round 1 / S8 — same partial-rollup warning as the single-line
    // Apply, folded into this SAME confirmation (a bulk apply already
    // always confirms, so no second prompt is needed) rather than
    // silently applying a partial rollup for any line in the batch.
    const partialWarnings = changes
      .map(c => ({ line: c.line, warning: partialRollupWarning(rollupByKey.get(c.line.line_key as string)) }))
      .filter((w): w is { line: EstimateLine; warning: string } => w.warning != null);
    const body = (
      <div>
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          {changes.map(c => (
            <li key={c.line.line_key}>
              {c.line.description}: {fmtQty(c.from)} → {fmtQty(c.to)} {c.line.unit}
            </li>
          ))}
        </ul>
        {impact != null && (
          <div style={{ fontWeight: 700 }}>
            {impact >= 0 ? '+' : ''}${Math.abs(impact).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to the estimate
          </div>
        )}
        {partialWarnings.length > 0 && (
          <div style={{ marginTop: 8, color: 'var(--warn, #b45309)' }}>
            <strong>Some markers were excluded:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {partialWarnings.map(w => (
                <li key={w.line.line_key}>{w.line.description}: {w.warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
    const ok = await confirm({ title: `Apply ${changes.length} confirmed quantit${changes.length === 1 ? 'y' : 'ies'}?`, body, confirmLabel: 'Apply' });
    if (!ok) return;
    setApplyingKeys(new Set(differingKeys));
    try {
      await onApplyLines(differingKeys);
    } finally {
      setApplyingKeys(new Set());
    }
  }

  return (
    <div className="plan-items-panel">
      <div className="plan-items-panel-header">
        <label className="plan-items-panel-toggle">
          <input type="checkbox" checked={showOnlyActiveLine} onChange={onToggleShowOnlyActiveLine} />
          Show only this line
        </label>
        <button
          className="btn primary sm"
          disabled={differingKeys.length === 0}
          onClick={() => void applyAllDiffering()}
        >
          Apply all that differ{differingKeys.length > 0 ? ` (${differingKeys.length})` : ''}
        </button>
      </div>

      {unassignedMarkers && unassignedMarkers.length > 0 && (
        <div className="plan-items-panel-group" data-testid="unassigned-markers-bucket">
          <div className="plan-items-panel-group-header">
            Unassigned markers ({unassignedMarkers.reduce((sum, u) => sum + u.count, 0)})
          </div>
          {unassignedMarkers.map(u => (
            <div key={u.sheetKey} className="plan-items-panel-row" style={{ cursor: 'default' }}>
              <div className="plan-items-panel-row-main">
                <span className="plan-items-panel-desc">{u.label}</span>
                <Badge tone="warn" size="sm">{u.count} unassigned</Badge>
              </div>
              {onJumpToUnassigned && (
                <div className="plan-items-panel-row-actions">
                  <button className="btn ghost sm" onClick={() => onJumpToUnassigned(u.sheetKey)}>
                    Jump to sheet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {groups.map(g => (
        <div key={g.category} className="plan-items-panel-group">
          <div className="plan-items-panel-group-header">{g.category}</div>
          {g.lines.map(l => {
            const key = l.line_key;
            const r = key ? rollupByKey.get(key) : undefined;
            const status = computeLineStatus(l, r);
            const isActive = key != null && key === activeLineKey;
            const isApplying = key != null && applyingKeys.has(key);
            if (showOnlyActiveLine && !isActive) return null;
            return (
              <div
                key={key ?? l.description}
                className={`plan-items-panel-row${isActive ? ' active' : ''}`}
                data-testid={key ? `line-${key}` : undefined}
                onClick={() => key && onSelectLine(key)}
              >
                <div className="plan-items-panel-row-main">
                  <span className="plan-items-panel-desc">{l.description}</span>
                  <Badge tone={STATUS_TONE[status]} size="sm">{STATUS_LABEL[status]}</Badge>
                </div>
                <div className="plan-items-panel-row-qty">
                  <span title="AI qty">AI {fmtQty(r?.aiQty ?? null)}</span>
                  <span title="Marked qty">Marked {fmtQty(r?.markedQty ?? null)}</span>
                  <span title="Current qty">Current {fmtQty(l.qty)} {l.unit}</span>
                </div>
                {r && r.sheets.length > 0 && (
                  <div className="plan-items-panel-sheets">
                    Marked on {r.sheets.length} sheet{r.sheets.length === 1 ? '' : 's'}
                  </div>
                )}
                {/* Fix round 1 / S8 — surfaced on the row itself, not just
                    behind an Apply confirmation, so an estimator scanning
                    the panel sees it before ever clicking Apply. */}
                {r && (r.incompatibleCount > 0 || r.missingScaleCount > 0) && (
                  <div className="plan-items-panel-sheets" data-testid={key ? `partial-rollup-${key}` : undefined} style={{ color: 'var(--warn, #b45309)' }}>
                    {r.incompatibleCount > 0 && `${r.incompatibleCount} wrong-type marker${r.incompatibleCount === 1 ? '' : 's'} excluded`}
                    {r.incompatibleCount > 0 && r.missingScaleCount > 0 && ' · '}
                    {r.missingScaleCount > 0 && `${r.missingScaleCount} unscaled marker${r.missingScaleCount === 1 ? '' : 's'} excluded`}
                  </div>
                )}
                <div className="plan-items-panel-row-actions">
                  {onJumpToSource && (
                    <button className="btn ghost sm" onClick={e => { e.stopPropagation(); onJumpToSource(l); }}>
                      Jump to source sheet
                    </button>
                  )}
                  {key && onSuggestMarkersForLine && (
                    <button className="btn ghost sm" onClick={e => { e.stopPropagation(); onSuggestMarkersForLine(l); }}>
                      Suggest markers
                    </button>
                  )}
                  {key && (hasUnappliedMarkedQty(status) || status === 'not_marked') && r?.markedQty != null && (
                    <button
                      className="btn ghost sm"
                      disabled={isApplying}
                      onClick={e => { e.stopPropagation(); void applyOne(key); }}
                    >
                      {isApplying ? 'Applying…' : 'Apply marked qty'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
