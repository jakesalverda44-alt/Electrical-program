// Estimating Phase B, Task 6 — pure per-line status for the items panel:
// Matches / Differs / Not marked / Applied. Isolated from ItemsPanel.tsx
// so the classification rule itself is trivially testable.
import { EstimateLine } from '../types';
import { RollupEntry } from '../types';

export type LineMarkupStatus = 'applied' | 'changed_since_applied' | 'matches' | 'differs' | 'not_marked';

// Fix round 1 / B6 — a small tolerance, not exact equality, both here and
// for 'applied' below: N6's fix (round an applied LF qty to whole feet at
// apply time) means the value actually STORED on the line can differ from
// the rollup's own unrounded float by a fraction of a foot even though
// nothing has genuinely changed since Apply.
const QTY_TOLERANCE = 0.01;
function qtyRoughlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < QTY_TOLERANCE;
}

/** Fix round 1 / B6 — 'applied' used to mean "qty_source is 'markup'",
 *  full stop — permanent and irrespective of anything that happened
 *  AFTER the apply (more markers added/removed, a recalibration). That
 *  hid the "Apply marked qty" action and excluded the line from "Apply
 *  all that differ" forever, so a marked-up quantity that grew from 20
 *  to 26 after the estimator found six more fixtures never reached the
 *  price. 'applied' now means "qty_source is 'markup' AND the CURRENT
 *  qty still matches the LIVE rollup" — the instant they diverge (more
 *  markers, fewer markers, a rescale), the line reads
 *  'changed_since_applied': Apply stays visible, and it's counted in
 *  "Apply all that differ" exactly like 'differs'. */
export function computeLineStatus(line: EstimateLine, rollup: RollupEntry | undefined): LineMarkupStatus {
  if (line.qty_source === 'markup') {
    if (rollup && rollup.markedQty != null && qtyRoughlyEqual(rollup.markedQty, line.qty)) return 'applied';
    return 'changed_since_applied';
  }
  if (!rollup || rollup.markedQty == null) return 'not_marked';
  return qtyRoughlyEqual(rollup.markedQty, line.qty) ? 'matches' : 'differs';
}

export const STATUS_LABEL: Record<LineMarkupStatus, string> = {
  applied: 'Applied', changed_since_applied: 'Changed since applied', matches: 'Matches', differs: 'Differs', not_marked: 'Not marked',
};
