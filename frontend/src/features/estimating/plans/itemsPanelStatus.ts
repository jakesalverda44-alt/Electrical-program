// Estimating Phase B, Task 6 — pure per-line status for the items panel:
// Matches / Differs / Not marked / Applied. Isolated from ItemsPanel.tsx
// so the classification rule itself is trivially testable.
import { EstimateLine } from '../types';
import { RollupEntry } from '../types';

export type LineMarkupStatus = 'applied' | 'matches' | 'differs' | 'not_marked';

/** `line.qty_source==='markup'` means this line's CURRENT qty already IS a
 *  confirmed, applied markup rollup — that takes priority over comparing
 *  qty vs rollup (which would otherwise show "Matches" for an applied
 *  line with nothing further to apply, a true but less useful distinction
 *  for the estimator: "matches" implies "you could apply this", "applied"
 *  means "you already did"). */
export function computeLineStatus(line: EstimateLine, rollup: RollupEntry | undefined): LineMarkupStatus {
  if (line.qty_source === 'markup') return 'applied';
  if (!rollup || rollup.markedQty == null) return 'not_marked';
  return rollup.markedQty === line.qty ? 'matches' : 'differs';
}

export const STATUS_LABEL: Record<LineMarkupStatus, string> = {
  applied: 'Applied', matches: 'Matches', differs: 'Differs', not_marked: 'Not marked',
};
