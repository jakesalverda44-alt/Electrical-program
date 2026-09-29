// Remodel + footage round, B1 + B2 — the rows bidEstimate.ts adds to every
// bid's takeoff before mapping:
//   B1: Agent 2's allowances[] (it used to drop them). footage > 0 → a priced
//       line; footage 0 → a visible "NEEDS FOOTAGE" row at 0, never lost.
//   B2: the footage allowance (footageAllowance.ts), from the takeoff's own
//       counts, the count's mark geometry on scaled sheets, and the editable
//       ratios in app_settings.
// Reads only; bidEstimate.ts's sync writes the lines like any takeoff row.

export interface GeneratedTakeoffRow {
  category: string;
  item: string;
  spec: string;
  qty: number;
  unit: 'LF';
  confidence: 'APPROX';
  evidence: string;
}
export interface TakeoffRowLike { category: string; item: string; spec?: string | null; qty: number | string; unit: string }
export interface Agent2AllowanceLike { item: string; footage?: number | string | null; notes?: string | null }

export const DEFAULT_ALLOWANCE_CATEGORY = 'Site / Underground / Allowances';

export interface Agent2Allowance extends Agent2AllowanceLike {
  unit?: string | null;
  category?: string | null;
}

/** Same JSON extraction as bidEstimate.ts's parseAgent2Takeoff, for the
 *  sibling allowances[] array. Never throws. */
export function parseAgent2Allowances(raw: string | null | undefined): Agent2Allowance[] {
  if (!raw) return [];
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as { allowances?: unknown };
    if (!Array.isArray(parsed.allowances)) return [];
    return parsed.allowances
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { item?: unknown }).item === 'string')
      .map(a => ({
        item: String(a.item).trim(),
        footage: a.footage as number | string | null,
        unit: typeof a.unit === 'string' ? a.unit : null,
        notes: typeof a.notes === 'string' ? a.notes : null,
        category: typeof a.category === 'string' ? a.category : null,
      }))
      .filter(a => a.item.length > 0);
  } catch {
    return [];
  }
}

/** B1 — one row per allowance. The label (item) never carries the footage,
 *  so the row keeps its takeoff key — and an estimator's typed footage —
 *  when a re-run finally reads a length off the plans. */
export function allowanceRows(allowances: Agent2Allowance[]): GeneratedTakeoffRow[] {
  return allowances.map(a => {
    const ft = Number(a.footage);
    const hasFootage = Number.isFinite(ft) && ft > 0;
    const note = (a.notes ?? '').trim();
    const unit = String(a.unit ?? 'LF').trim().toUpperCase();
    return {
      category: (a.category ?? '').trim() || DEFAULT_ALLOWANCE_CATEGORY,
      item: `Allowance — ${a.item}`,
      spec: hasFootage ? a.item : `NEEDS FOOTAGE — ${a.item}`,
      qty: hasFootage ? ft : 0,
      unit: (unit === 'FT' || unit === 'FEET' || !unit ? 'LF' : unit) as 'LF',
      confidence: 'APPROX',
      evidence: hasFootage
        ? `Agent 2 allowance, ESTIMATED: ${ft} ${unit || 'LF'}${note ? ` — ${note}` : ''}`
        : `Agent 2 allowance with no footage on the plans — measure it or type a qty (not priced until then)${note ? `. Agent 2: ${note}` : ''}`,
    };
  });
}

export interface GeneratedRowsResult { rows: GeneratedTakeoffRow[] }

export async function loadGeneratedTakeoffRows(
  _bidId: string,
  src: { agent2Raw: string | null; agent1Raw: unknown; countResult: unknown; takeoffRows: TakeoffRowLike[] },
): Promise<GeneratedRowsResult> {
  return { rows: allowanceRows(parseAgent2Allowances(src.agent2Raw)) };
}
