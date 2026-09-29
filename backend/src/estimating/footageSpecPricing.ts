// Remodel + footage round, Q4 (coordinator decision) — a "NEEDS FOOTAGE — …"
// allowance line (B1) whose text names its conduit and wiring (e.g. 'HVAC
// feeders 3/4" 3#6 1#10G') prices BOTH automatically once the estimator
// types the run length: per foot of run, the conduit item plus each
// conductor × its count, every part resolved through the mapper against the
// library. Pure; bidEstimate.ts's resolveLines calls it for such a line
// (unless the estimator resolved the line's match by hand).
import { mapTakeoffLines, LibraryCandidate } from './mapper';
import { parseConductorRun } from './footageAllowance';
import type { LibraryItem } from './library';

export const NEEDS_FOOTAGE_PREFIX = 'NEEDS FOOTAGE — ';

const DIVISOR: Record<string, number> = { LF: 1, C: 100, M: 1000 };

export interface RunSpecPart { description: string; code: string; perFtOfRun: number }
export interface RunSpecPricing { materialPerLf: number; hoursPerLf: number; unverified: boolean; parts: RunSpecPart[] }

/** The complete conduit + wire set a run's text describes: the conduit (1
 *  ft per ft of run) and each conductor × its count. Conduit-only only when
 *  the text says the run is empty. Null when the text doesn't name a conduit
 *  size and (unless empty) at least one conductor. `requirePrefix` (the
 *  default) limits it to NEEDS FOOTAGE lines — resolveLines' use. */
export function runSpecParts(text: string, opts: { requirePrefix?: boolean } = {}): Array<{ description: string; perFtOfRun: number }> | null {
  if ((opts.requirePrefix ?? true) && !text.startsWith(NEEDS_FOOTAGE_PREFIX)) return null;
  const spec = parseConductorRun(text);
  const raceway = /\bPVC\b/i.test(text) ? 'PVC Sch 40 (incl. fittings/glue)' : 'EMT (incl. couplings/straps)';
  if (!spec) {
    // "3/4\" empty control conduit" — a conduit-only run is complete as is.
    const cm = /\bempty\b|conduit only|pull ?string/i.test(text) ? text.match(/(\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*"/) : null;
    return cm ? [{ description: `${cm[1]}" ${raceway}`, perFtOfRun: 1 }] : null;
  }
  if (!spec.conduit) return null;
  return [
    { description: `${spec.conduit} ${raceway}`, perFtOfRun: 1 },
    ...spec.conductors.map(c => ({ description: `#${c.size} THHN/THWN copper conductor`, perFtOfRun: c.count })),
  ];
}

/** Every part resolved through the mapper to a linear library item
 *  (exact/alias only), or null — never a partial set. */
export function resolveRunParts(parts: Array<{ description: string; perFtOfRun: number }>, candidates: LibraryCandidate[], itemsById: Map<string, LibraryItem>): Array<{ description: string; perFtOfRun: number; item: LibraryItem }> | null {
  const mapped = mapTakeoffLines(parts.map(p => ({ category: '', description: p.description, qty: 1, unit: 'LF' })), candidates);
  const out: Array<{ description: string; perFtOfRun: number; item: LibraryItem }> = [];
  for (let i = 0; i < parts.length; i++) {
    const m = mapped[i];
    const item = m.matchedKind === 'item' && m.matchedId ? itemsById.get(m.matchedId) : undefined;
    if (!item || (m.matchConfidence !== 'exact' && m.matchConfidence !== 'alias') || !DIVISOR[item.unit]) return null;
    out.push({ ...parts[i], item });
  }
  return out;
}

/** Null unless the line is a NEEDS FOOTAGE line with a complete conduit +
 *  wiring spec AND every part resolves — never a partial price. */
export function priceRunSpec(text: string, candidates: LibraryCandidate[], itemsById: Map<string, LibraryItem>): RunSpecPricing | null {
  const parts = runSpecParts(text);
  if (!parts) return null;
  const resolved = resolveRunParts(parts, candidates, itemsById);
  if (!resolved) return null;
  let materialPerLf = 0; let hoursPerLf = 0; let unverified = false;
  for (const r of resolved) {
    const div = DIVISOR[r.item.unit];
    materialPerLf += (r.item.material_cost / div) * r.perFtOfRun;
    hoursPerLf += (r.item.labor_hours / div) * r.perFtOfRun;
    if (r.item.material_price_date == null) unverified = true;
  }
  return { materialPerLf, hoursPerLf, unverified, parts: resolved.map(r => ({ description: r.description, code: r.item.code, perFtOfRun: r.perFtOfRun })) };
}
