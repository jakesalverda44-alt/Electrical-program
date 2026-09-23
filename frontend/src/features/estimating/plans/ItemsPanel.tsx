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
  applied: 'good', matches: 'info', differs: 'warn', not_marked: 'neutral',
};

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
}

export default function ItemsPanel({
  lines, rollup, activeLineKey, onSelectLine, onApplyLines, onJumpToSource,
  showOnlyActiveLine, onToggleShowOnlyActiveLine, previewPriceImpact, onSuggestMarkersForLine,
}: ItemsPanelProps) {
  const confirm = useConfirm();
  const [applyingKeys, setApplyingKeys] = useState<Set<string>>(new Set());

  const rollupByKey = useMemo(() => new Map(rollup.map(r => [r.lineKey, r])), [rollup]);
  const groups = useMemo(() => groupByCategory(lines), [lines]);

  const differingKeys = useMemo(
    () => lines
      .filter(l => l.line_key && computeLineStatus(l, rollupByKey.get(l.line_key)) === 'differs')
      .map(l => l.line_key as string),
    [lines, rollupByKey]
  );

  async function applyOne(lineKey: string) {
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
                  {key && (status === 'differs' || status === 'not_marked') && r?.markedQty != null && (
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
