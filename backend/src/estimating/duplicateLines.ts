// Next round A7 — the blocking duplicate check in Labor & Pricing (the
// re-run reset leftover). After a re-run, a line the estimator had edited is
// kept; when sync-takeoff can't re-bind it confidently (recheck_reason) and
// the new takeoff brings a fresh line for the same fixture / device, both
// are priced — a possible double count. It blocks the save and the proposal
// until the estimator resolves it: remove one of the two, or keep both with
// a reason (dup_ok). Pure.
import { plausiblySameText } from '../bidstd/enforceCounts';

export interface DupLine {
  line_key: string;
  category: string;
  description: string;
  unit: string;
  qty: number;
  source: 'takeoff' | 'manual';
  excluded?: boolean;
  recheck_run_id?: string | null;
  recheck_reason?: string | null;
  dup_ok?: { with: string[]; reason: string; by?: string; at?: string } | null;
}

export interface DuplicatePair {
  /** The line kept from the previous run (the estimator's edits). */
  keptKey: string;
  keptDescription: string;
  keptQty: number;
  /** The fresh line from the new takeoff. */
  newKey: string;
  newDescription: string;
  newQty: number;
  category: string;
  unit: string;
}

/** Fixture / device / lighting lines only (a feeder next to a fixture line is
 *  not a duplicate). */
const CHECK_CATEGORY = /\blight|\bfixture|\bluminaire|\bdevice|\bcontrol|\bbranch\s+power|\breceptacle|\bpower\b/i;

export function laborDuplicatePairs(lines: DupLine[]): DuplicatePair[] {
  const kept = lines.filter(l => l.source === 'takeoff' && !l.excluded && !!l.recheck_run_id && !!l.recheck_reason);
  const fresh = lines.filter(l => l.source === 'takeoff' && !l.excluded && !l.recheck_run_id);
  const out: DuplicatePair[] = [];
  for (const k of kept) {
    if (!CHECK_CATEGORY.test(k.category)) continue;
    for (const f of fresh) {
      if (f.line_key === k.line_key || f.unit !== k.unit || !CHECK_CATEGORY.test(f.category)) continue;
      if (k.dup_ok?.with?.includes(f.line_key)) continue;
      if (!plausiblySameText(k.description, f.description)) continue;
      out.push({
        keptKey: k.line_key, keptDescription: k.description, keptQty: k.qty,
        newKey: f.line_key, newDescription: f.description, newQty: f.qty,
        category: f.category, unit: f.unit,
      });
    }
  }
  return out;
}

export function describePair(p: DuplicatePair): string {
  return `"${p.keptDescription}" (${p.keptQty} ${p.unit}, kept from the previous run) and "${p.newDescription}" (${p.newQty} ${p.unit}, new takeoff line)`;
}
