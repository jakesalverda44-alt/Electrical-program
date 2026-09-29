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

export function runSpecParts(text: string): Array<{ description: string; perFtOfRun: number }> | null {
  if (!text.startsWith(NEEDS_FOOTAGE_PREFIX)) return null;
  const spec = parseConductorRun(text);
  if (!spec?.conduit) return null;
  const raceway = /\bPVC\b/i.test(text) ? 'PVC Sch 40 (incl. fittings/glue)' : 'EMT (incl. couplings/straps)';
  return [
    { description: `${spec.conduit} ${raceway}`, perFtOfRun: 1 },
    ...spec.conductors.map(c => ({ description: `#${c.size} THHN/THWN copper conductor`, perFtOfRun: c.count })),
  ];
}

/** Null unless the line is a NEEDS FOOTAGE line with a conduit + wiring
 *  spec AND every part resolves (exact/alias) to a linear library item —
 *  never a partial price that looks complete. */
export function priceRunSpec(text: string, candidates: LibraryCandidate[], itemsById: Map<string, LibraryItem>): RunSpecPricing | null {
  const parts = runSpecParts(text);
  if (!parts) return null;
  const mapped = mapTakeoffLines(parts.map(p => ({ category: '', description: p.description, qty: 1, unit: 'LF' })), candidates);
  let materialPerLf = 0; let hoursPerLf = 0; let unverified = false;
  const out: RunSpecPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = mapped[i];
    const item = m.matchedKind === 'item' && m.matchedId ? itemsById.get(m.matchedId) : undefined;
    if (!item || (m.matchConfidence !== 'exact' && m.matchConfidence !== 'alias')) return null;
    const div = DIVISOR[item.unit];
    if (!div) return null;
    materialPerLf += (item.material_cost / div) * parts[i].perFtOfRun;
    hoursPerLf += (item.labor_hours / div) * parts[i].perFtOfRun;
    if (item.material_price_date == null) unverified = true;
    out.push({ description: parts[i].description, code: item.code, perFtOfRun: parts[i].perFtOfRun });
  }
  return { materialPerLf, hoursPerLf, unverified, parts: out };
}
