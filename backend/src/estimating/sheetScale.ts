// Accuracy round C2 — sheet scale tiers. Pure: no I/O.
//
//   1. confirmed — est_sheets.scale_source 'calibrated' or an ACCEPTED
//      'titleblock' scale (ft_per_pt).
//   2. suggested — from (a) the text title block's suggested_ft_per_pt,
//      (b) a graphic scale bar in the sheet's text layer (>= 3 numeric labels
//      on one row within 150 pt of "GRAPHIC SCALE"/"SCALE", a linear fit
//      with residual < 2%), or (c) the main-plan viewport's vision-read scale
//      (ft/pt = 1 / (inPerFt × 72), doubled on a half-size set). (b) and (c)
//      must pass the building-area check when a building box is known (box
//      area × ftPerPt² within ±30% of a stated building SF); no box →
//      suggested, flagged "area not checked".
//   3. unverified — "NOT TO SCALE" / "NTS", candidates that disagree by more
//      than 5%, or a failed area check. Never priced: a hold "confirm the
//      scale on <sheet>".
// The branch v2 geometry keeps its own confirmed-only rule (geometryFromCount).

export type ScaleTier = 'confirmed' | 'suggested' | 'unverified';
export type ScaleSource = 'calibrated' | 'titleblock' | 'suggested_titleblock' | 'scale_bar' | 'viewport';

export interface TextRunLike { str: string; x: number; y: number; w: number; h: number }
export interface ViewportLike { kind?: string; title?: string; scale?: string | null; inPerFt?: number | null; bboxPt?: { x0: number; x1: number; y0: number; y1: number } }
export interface EstSheetScaleRow {
  ft_per_pt?: number | string | null; scale_source?: string | null;
  suggested_ft_per_pt?: number | string | null; suggested_label?: string | null; half_size?: boolean | null;
}

export interface KnownArea { sqFt: number; source: string }

export interface SheetScaleInput {
  label: string;
  row?: EstSheetScaleRow | null;
  viewports?: ViewportLike[];
  /** Displayed-point text runs of the sheet (vector sheets only). */
  textRuns?: TextRunLike[];
  /** The building's footprint on this sheet, in PDF points (e.g. the extent
   *  of the counted interior marks in the main plan). */
  buildingBoxPt?: { w: number; h: number } | null;
  knownAreas?: KnownArea[];
}

export interface AreaCheck { status: 'ok' | 'failed' | 'not_checked'; areaSf?: number; knownSf?: number; source?: string }

export interface SheetScale {
  label: string;
  tier: ScaleTier;
  ftPerPt: number | null;
  source: ScaleSource | null;
  /** Human text: "1/8\" = 1'-0\" (main-plan viewport, vision-read)". */
  basis: string;
  area: AreaCheck;
  reasons: string[];
}

const num = (v: unknown): number | null => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const NTS_RE = /not\s+to\s+scale|\bn\.?\s?t\.?\s?s\.?\b|no\s+scale/i;

/** The scale bar of a text layer: ft per pt (in the runs' own point units). */
export function graphicScaleFromRuns(runs: TextRunLike[]): { ftPerPt: number; labels: number[]; residualPct: number } | null {
  const anchors = runs.filter(r => /graphic\s+scale|^\s*scale\b/i.test(r.str));
  const cx = (r: TextRunLike) => r.x + r.w / 2;
  const cy = (r: TextRunLike) => r.y + r.h / 2;
  for (const a of anchors) {
    const nums = runs.filter(r => /^\s*\d+(?:\.\d+)?\s*$/.test(r.str) && Math.hypot(cx(r) - cx(a), cy(r) - cy(a)) <= 150);
    // One row: the biggest group of labels sharing a baseline.
    const rows = new Map<number, TextRunLike[]>();
    for (const r of nums) {
      const k = [...rows.keys()].find(y => Math.abs(y - r.y) <= Math.max(1, 0.5 * r.h)) ?? r.y;
      rows.set(k, [...(rows.get(k) ?? []), r]);
    }
    const row = [...rows.values()].sort((p, q) => q.length - p.length)[0];
    if (!row || row.length < 3) continue;
    const sorted = row.slice().sort((p, q) => cx(p) - cx(q));
    const zero = sorted.findIndex(r => Number(r.str) === 0);
    if (zero < 0) continue;
    // Labels left of zero are the negative sub-division ("20 0 20 40").
    const vals = sorted.map((r, i) => (i < zero ? -Number(r.str) : Number(r.str)));
    if (!vals.every((v, i) => i === 0 || v > vals[i - 1])) continue;
    const xs = sorted.map(cx);
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n, mv = vals.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (vals[i] - mv); sxx += (xs[i] - mx) ** 2; }
    if (!(sxx > 0)) continue;
    const slope = sxy / sxx;
    const span = vals[n - 1] - vals[0];
    const maxRes = Math.max(...xs.map((x, i) => Math.abs(mv + slope * (x - mx) - vals[i])));
    const residualPct = span > 0 ? (maxRes / span) * 100 : 100;
    if (slope > 0 && residualPct < 2) return { ftPerPt: slope, labels: vals, residualPct };
  }
  return null;
}

/** "BLDG. AREA = 7,381 SQ. FT." in a text layer. */
export function statedBuildingArea(runs: TextRunLike[]): number | null {
  for (const r of runs) {
    const m = r.str.match(/(?:bldg\.?|building)\s*(?:area)?\s*[=:]?\s*([\d,]{3,7})\s*(?:sq\.?\s*ft|s\.?f\.?)/i);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}

function areaCheck(ftPerPt: number, box: SheetScaleInput['buildingBoxPt'], known: KnownArea[]): AreaCheck {
  if (!box || !(box.w > 0 && box.h > 0) || !known.length) return { status: 'not_checked' };
  const areaSf = Math.round(box.w * box.h * ftPerPt * ftPerPt);
  const hit = known.find(k => Math.abs(areaSf - k.sqFt) / k.sqFt <= 0.3);
  const k = hit ?? known[0];
  return { status: hit ? 'ok' : 'failed', areaSf, knownSf: k.sqFt, source: k.source };
}

export function sheetScale(input: SheetScaleInput): SheetScale {
  const row = input.row ?? {};
  const reasons: string[] = [];
  const confirmed = num(row.ft_per_pt);
  if (confirmed && (row.scale_source === 'calibrated' || row.scale_source === 'titleblock')) {
    return { label: input.label, tier: 'confirmed', ftPerPt: confirmed, source: row.scale_source === 'calibrated' ? 'calibrated' : 'titleblock', basis: row.scale_source === 'calibrated' ? 'calibrated by the estimator' : 'title-block scale accepted by the estimator', area: { status: 'not_checked' }, reasons };
  }
  const main = (input.viewports ?? []).find(v => v.kind === 'main_plan');
  const known = [...(input.knownAreas ?? [])];
  const stated = input.textRuns ? statedBuildingArea(input.textRuns) : null;
  if (stated) known.push({ sqFt: stated, source: 'text "BLDG. AREA"' });

  type Cand = { ftPerPt: number; source: ScaleSource; basis: string; checkArea: boolean };
  const cands: Cand[] = [];
  const sugg = num(row.suggested_ft_per_pt);
  if (sugg) cands.push({ ftPerPt: sugg, source: 'suggested_titleblock', basis: `title block ${row.suggested_label ?? ''}`.trim(), checkArea: false });
  const bar = input.textRuns ? graphicScaleFromRuns(input.textRuns) : null;
  if (bar) cands.push({ ftPerPt: bar.ftPerPt, source: 'scale_bar', basis: `graphic scale bar ${bar.labels.map(v => Math.abs(v)).join('/')} ft (text layer)`, checkArea: true });
  if (main && !NTS_RE.test(main.scale ?? '') && num(main.inPerFt)) {
    const f = (1 / (Number(main.inPerFt) * 72)) * (row.half_size ? 2 : 1);
    cands.push({ ftPerPt: f, source: 'viewport', basis: `${main.scale} (main-plan viewport "${main.title ?? ''}", vision-read${row.half_size ? ', half-size set ×2' : ''})`, checkArea: true });
  }
  if (!cands.length) {
    if (main && NTS_RE.test(main.scale ?? '')) reasons.push(`the main plan says "${main.scale}"`);
    else reasons.push('no scale found on the sheet');
    return { label: input.label, tier: 'unverified', ftPerPt: null, source: null, basis: reasons[0], area: { status: 'not_checked' }, reasons };
  }
  const lo = Math.min(...cands.map(c => c.ftPerPt)), hi = Math.max(...cands.map(c => c.ftPerPt));
  if ((hi - lo) / lo > 0.05) {
    reasons.push(`scales disagree: ${cands.map(c => `${c.basis} → ${c.ftPerPt.toFixed(4)} ft/pt`).join('; ')}`);
    return { label: input.label, tier: 'unverified', ftPerPt: null, source: null, basis: reasons[0], area: { status: 'not_checked' }, reasons };
  }
  // Prefer the text sources over vision.
  const pick = cands.find(c => c.source === 'scale_bar') ?? cands.find(c => c.source === 'suggested_titleblock') ?? cands[0];
  const area = pick.checkArea ? areaCheck(pick.ftPerPt, input.buildingBoxPt, known) : { status: 'not_checked' as const };
  if (area.status === 'failed') {
    reasons.push(`building-area check failed: ${area.areaSf} SF measured vs ${area.knownSf} SF (${area.source})`);
    return { label: input.label, tier: 'unverified', ftPerPt: null, source: pick.source, basis: `${pick.basis}; ${reasons[0]}`, area, reasons };
  }
  if (area.status === 'not_checked') reasons.push('area not checked');
  return { label: input.label, tier: 'suggested', ftPerPt: pick.ftPerPt, source: pick.source, basis: pick.basis, area, reasons };
}

/** The building box on a sheet from marks inside its main-plan viewport
 *  (>= 10 marks), in PDF points. */
export function buildingBoxFromMarks(marks: Array<{ x: number; y: number }>, main: ViewportLike | undefined): { w: number; h: number } | null {
  const b = main?.bboxPt;
  const inside = b ? marks.filter(m => m.x >= b.x0 && m.x <= b.x1 && m.y >= b.y0 && m.y <= b.y1) : [];
  if (inside.length < 10) return null;
  const xs = inside.map(m => m.x), ys = inside.map(m => m.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function describeScale(s: SheetScale): string {
  if (s.tier === 'unverified' || s.ftPerPt == null) return `${s.label}: scale unverified (${s.basis})`;
  const area = s.area.status === 'ok' ? `; area ${s.area.areaSf?.toLocaleString('en-US')} vs ${s.area.knownSf?.toLocaleString('en-US')} SF ✓` : s.area.status === 'not_checked' ? '; area not checked' : '';
  return `${s.ftPerPt.toFixed(4)} ft/pt (${s.label} ${s.basis}${area})`;
}
