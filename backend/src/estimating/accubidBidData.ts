// Next round Part B, Task 2/3 — DB access for a bid's Accubid-mode pricing:
// per-bid crew/OH/markup settings, quotes, equipment/GE lines, alternates,
// and the per-GC overhead default table. The pure math lives in
// accubidRecap.ts; this module resolves a bid's saved lines against the
// library (reusing bidEstimate.ts's resolveLines/priceBid — the SAME
// material $/labor hours Phase A prices from, so switching a bid between
// modes never changes what a line resolves to) and assembles the recap
// input, then writes bid_estimates/bids.amount from the result — the same
// contract writeBidEstimateSnapshot already guarantees for Phase A.
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { getLibrary } from './library';
import { priceBid, PricingSettings } from './pricing';
import { getBidLines, resolveLines, BidLineRow, getBidSettings, persistPhaseAPriceForBid, buildLegacyLineItemsAndSubtotals } from './bidEstimate';
import { computeBidComps } from '../utils/bidComps';
import {
  computeAccubidRecap, AccubidRecapInput, AccubidRecapResult, QuoteLine, CrewConfig, CrewMember,
  computeFieldLaborCost, DEFAULT_LABOR_OVERHEAD_PCT, DEFAULT_MATERIAL_MARKUP_PCT,
  DEFAULT_LABOR_MARKUP_PCT, DEFAULT_QUOTE_MARKUP_PCT, DEFAULT_ADJUSTMENT_PCT,
  DEFAULT_BURDEN_PCT, DEFAULT_FRINGE_PER_HR,
} from './accubidRecap';
import { computeAutoDeductAmount, formatAutoDeductLabel } from './autoDeductAlternate';
import { matchAccountRule } from '../bidstd/accountRules';
import { listAccountRules } from '../bidstd/accountRulesDb';

function numberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── Per-bid Accubid settings ─────────────────────────────────────────────────

export interface AccubidSettings {
  shift: 'day' | 'night';
  journeymanCount: number; journeymanRate: number;
  apprenticeCount: number; apprenticeRate: number;
  foremanCount: number; foremanRate: number;
  nightJourneymanRate: number | null;
  nightApprenticeRate: number | null;
  nightForemanRate: number | null;
  burdenPct: number;
  fringePerHr: number;
  materialTaxPct: number;
  laborOverheadPct: number;
  materialMarkupPct: number;
  laborMarkupPct: number;
  quoteMarkupDefaultPct: number;
  adjustmentMarkupPct: number;
  salesMarkupPct: number;
}

export async function getAccubidSettings(bidId: string): Promise<AccubidSettings> {
  const { rows } = await pool.query('SELECT * FROM est_accubid_settings WHERE bid_id = $1', [bidId]);
  if (rows.length) {
    const r = rows[0];
    return {
      shift: r.shift === 'night' ? 'night' : 'day',
      journeymanCount: numberOr(r.journeyman_count, 1), journeymanRate: numberOr(r.journeyman_rate, 37),
      apprenticeCount: numberOr(r.apprentice_count, 2), apprenticeRate: numberOr(r.apprentice_rate, 27),
      foremanCount: numberOr(r.foreman_count, 0), foremanRate: numberOr(r.foreman_rate, 45),
      nightJourneymanRate: r.night_journeyman_rate != null ? Number(r.night_journeyman_rate) : null,
      nightApprenticeRate: r.night_apprentice_rate != null ? Number(r.night_apprentice_rate) : null,
      nightForemanRate: r.night_foreman_rate != null ? Number(r.night_foreman_rate) : null,
      burdenPct: numberOr(r.burden_pct, DEFAULT_BURDEN_PCT),
      fringePerHr: numberOr(r.fringe_per_hr, DEFAULT_FRINGE_PER_HR),
      materialTaxPct: numberOr(r.material_tax_pct, 0),
      laborOverheadPct: numberOr(r.labor_overhead_pct, DEFAULT_LABOR_OVERHEAD_PCT),
      materialMarkupPct: numberOr(r.material_markup_pct, DEFAULT_MATERIAL_MARKUP_PCT),
      laborMarkupPct: numberOr(r.labor_markup_pct, DEFAULT_LABOR_MARKUP_PCT),
      quoteMarkupDefaultPct: numberOr(r.quote_markup_default_pct, DEFAULT_QUOTE_MARKUP_PCT),
      adjustmentMarkupPct: numberOr(r.adjustment_markup_pct, DEFAULT_ADJUSTMENT_PCT),
      salesMarkupPct: numberOr(r.sales_markup_pct, 0),
    };
  }
  // No row saved yet — Settings' per-GC overhead default table (Decision 5)
  // decides the starting labor_overhead_pct for a bid against a known GC;
  // falls back to the flat 38% default when the GC has no row of its own.
  const { rows: bidRows } = await pool.query('SELECT gc FROM bids WHERE id = $1', [bidId]);
  const gc = (bidRows[0]?.gc as string | null) ?? null;
  const laborOverheadPct = gc ? await getGcOverheadDefault(gc) : DEFAULT_LABOR_OVERHEAD_PCT;
  return {
    shift: 'day',
    journeymanCount: 1, journeymanRate: 37, apprenticeCount: 2, apprenticeRate: 27, foremanCount: 0, foremanRate: 45,
    nightJourneymanRate: null, nightApprenticeRate: null, nightForemanRate: null,
    burdenPct: DEFAULT_BURDEN_PCT, fringePerHr: DEFAULT_FRINGE_PER_HR, materialTaxPct: 0,
    laborOverheadPct, materialMarkupPct: DEFAULT_MATERIAL_MARKUP_PCT, laborMarkupPct: DEFAULT_LABOR_MARKUP_PCT,
    quoteMarkupDefaultPct: DEFAULT_QUOTE_MARKUP_PCT, adjustmentMarkupPct: DEFAULT_ADJUSTMENT_PCT, salesMarkupPct: 0,
  };
}

export async function saveAccubidSettings(bidId: string, s: AccubidSettings): Promise<void> {
  await pool.query(
    `INSERT INTO est_accubid_settings
       (bid_id, shift, journeyman_count, journeyman_rate, apprentice_count, apprentice_rate, foreman_count, foreman_rate,
        night_journeyman_rate, night_apprentice_rate, night_foreman_rate, burden_pct, fringe_per_hr, material_tax_pct,
        labor_overhead_pct, material_markup_pct, labor_markup_pct, quote_markup_default_pct, adjustment_markup_pct, sales_markup_pct, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       shift=$2, journeyman_count=$3, journeyman_rate=$4, apprentice_count=$5, apprentice_rate=$6, foreman_count=$7, foreman_rate=$8,
       night_journeyman_rate=$9, night_apprentice_rate=$10, night_foreman_rate=$11, burden_pct=$12, fringe_per_hr=$13, material_tax_pct=$14,
       labor_overhead_pct=$15, material_markup_pct=$16, labor_markup_pct=$17, quote_markup_default_pct=$18, adjustment_markup_pct=$19, sales_markup_pct=$20, updated_at=now()`,
    [bidId, s.shift, s.journeymanCount, s.journeymanRate, s.apprenticeCount, s.apprenticeRate, s.foremanCount, s.foremanRate,
     s.nightJourneymanRate, s.nightApprenticeRate, s.nightForemanRate, s.burdenPct, s.fringePerHr, s.materialTaxPct,
     s.laborOverheadPct, s.materialMarkupPct, s.laborMarkupPct, s.quoteMarkupDefaultPct, s.adjustmentMarkupPct, s.salesMarkupPct]
  );
}

function crewFromSettings(s: AccubidSettings): CrewConfig {
  const night = s.shift === 'night';
  return {
    shift: s.shift,
    burdenPct: s.burdenPct,
    fringePerHr: s.fringePerHr,
    members: ([
      { role: 'journeyman', count: s.journeymanCount, rate: (night && s.nightJourneymanRate != null) ? s.nightJourneymanRate : s.journeymanRate },
      { role: 'apprentice', count: s.apprenticeCount, rate: (night && s.nightApprenticeRate != null) ? s.nightApprenticeRate : s.apprenticeRate },
      { role: 'foreman', count: s.foremanCount, rate: (night && s.nightForemanRate != null) ? s.nightForemanRate : s.foremanRate },
    ] as CrewMember[]).filter(m => m.count > 0),
  };
}

// ── Quotes ───────────────────────────────────────────────────────────────────

export interface QuoteRow { id: string; description: string; amount: number; taxPct: number; markupPct: number; status: 'firm' | 'budget_pending'; vendor: string | null; sort: number }

export async function getQuotes(bidId: string): Promise<QuoteRow[]> {
  const { rows } = await pool.query('SELECT * FROM est_bid_quotes WHERE bid_id = $1 ORDER BY sort, created_at', [bidId]);
  return rows.map(r => ({
    id: r.id, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), markupPct: Number(r.markup_pct),
    status: r.status, vendor: r.vendor ?? null, sort: Number(r.sort),
  }));
}

export interface QuoteInput { description: string; amount: number; taxPct?: number; markupPct: number; status: 'firm' | 'budget_pending'; vendor?: string | null; sort?: number }

export async function createQuote(bidId: string, q: QuoteInput): Promise<QuoteRow> {
  const { rows } = await pool.query(
    `INSERT INTO est_bid_quotes (bid_id, description, amount, tax_pct, markup_pct, status, vendor, sort)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [bidId, q.description, q.amount, q.taxPct ?? 0, q.markupPct, q.status, q.vendor ?? null, q.sort ?? 0]
  );
  const r = rows[0];
  return { id: r.id, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), markupPct: Number(r.markup_pct), status: r.status, vendor: r.vendor, sort: Number(r.sort) };
}

// Fix round 2 / B6 — every by-id query is scoped `WHERE id=$1 AND bid_id=$2`
// (after the route's own loadAccessibleBid check on :bidId), so a quote id
// from one bid can never be read, edited or deleted through a different
// bid's URL — the reviewer's repro used their OWN accessible bid's URL with
// the TARGET bid's quote id to bypass the ownership check entirely.
export async function updateQuote(id: string, bidId: string, patch: Partial<QuoteInput>): Promise<QuoteRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_quotes WHERE id=$1 AND bid_id=$2', [id, bidId]);
  if (!existingRows.length) return null;
  const e = existingRows[0];
  const next = {
    description: patch.description ?? e.description, amount: patch.amount ?? Number(e.amount),
    taxPct: patch.taxPct ?? Number(e.tax_pct), markupPct: patch.markupPct ?? Number(e.markup_pct),
    status: patch.status ?? e.status, vendor: patch.vendor !== undefined ? patch.vendor : e.vendor,
    sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_quotes SET description=$1, amount=$2, tax_pct=$3, markup_pct=$4, status=$5, vendor=$6, sort=$7, updated_at=now() WHERE id=$8 AND bid_id=$9 RETURNING *`,
    [next.description, next.amount, next.taxPct, next.markupPct, next.status, next.vendor, next.sort, id, bidId]
  );
  const r = rows[0];
  return { id: r.id, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), markupPct: Number(r.markup_pct), status: r.status, vendor: r.vendor, sort: Number(r.sort) };
}

export async function deleteQuote(id: string, bidId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_quotes WHERE id=$1 AND bid_id=$2', [id, bidId]);
  return (rowCount ?? 0) > 0;
}

// ── Equipment / General Expenses ─────────────────────────────────────────────

export interface CostLineRow { id: string; kind: 'equipment' | 'general_expense'; description: string; amount: number; taxPct: number; sort: number }
export interface CostLineInput { kind: 'equipment' | 'general_expense'; description: string; amount: number; taxPct?: number; sort?: number }

export async function getCostLines(bidId: string): Promise<CostLineRow[]> {
  const { rows } = await pool.query('SELECT * FROM est_bid_cost_lines WHERE bid_id = $1 ORDER BY sort, created_at', [bidId]);
  return rows.map(r => ({ id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), sort: Number(r.sort) }));
}

export async function createCostLine(bidId: string, c: CostLineInput): Promise<CostLineRow> {
  const { rows } = await pool.query(
    `INSERT INTO est_bid_cost_lines (bid_id, kind, description, amount, tax_pct, sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [bidId, c.kind, c.description, c.amount, c.taxPct ?? 0, c.sort ?? 0]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), sort: Number(r.sort) };
}

export async function updateCostLine(id: string, bidId: string, patch: Partial<CostLineInput>): Promise<CostLineRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_cost_lines WHERE id=$1 AND bid_id=$2', [id, bidId]);
  if (!existingRows.length) return null;
  const e = existingRows[0];
  const next = {
    kind: patch.kind ?? e.kind, description: patch.description ?? e.description,
    amount: patch.amount ?? Number(e.amount), taxPct: patch.taxPct ?? Number(e.tax_pct), sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_cost_lines SET kind=$1, description=$2, amount=$3, tax_pct=$4, sort=$5, updated_at=now() WHERE id=$6 AND bid_id=$7 RETURNING *`,
    [next.kind, next.description, next.amount, next.taxPct, next.sort, id, bidId]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), sort: Number(r.sort) };
}

export async function deleteCostLine(id: string, bidId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_cost_lines WHERE id=$1 AND bid_id=$2', [id, bidId]);
  return (rowCount ?? 0) > 0;
}

// ── Alternates (add/deduct) ──────────────────────────────────────────────────

export interface AlternateRow { id: string; kind: 'add' | 'deduct'; description: string; amount: number; auto: boolean; sourceRule: string | null; sort: number }
export interface AlternateInput { kind: 'add' | 'deduct'; description: string; amount: number; sort?: number }

export async function getAlternates(bidId: string): Promise<AlternateRow[]> {
  const { rows } = await pool.query('SELECT * FROM est_bid_alternates WHERE bid_id = $1 ORDER BY sort, created_at', [bidId]);
  return rows.map(r => ({ id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), auto: !!r.auto, sourceRule: r.source_rule, sort: Number(r.sort) }));
}

export async function createAlternate(bidId: string, a: AlternateInput): Promise<AlternateRow> {
  const { rows } = await pool.query(
    `INSERT INTO est_bid_alternates (bid_id, kind, description, amount, sort) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [bidId, a.kind, a.description, a.amount, a.sort ?? 0]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), auto: !!r.auto, sourceRule: r.source_rule, sort: Number(r.sort) };
}

export async function updateAlternate(id: string, bidId: string, patch: Partial<AlternateInput>): Promise<AlternateRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_alternates WHERE id=$1 AND bid_id=$2 AND auto=false', [id, bidId]);
  if (!existingRows.length) return null; // an auto alternate is never hand-edited — only replaced by the next sync
  const e = existingRows[0];
  const next = {
    kind: patch.kind ?? e.kind, description: patch.description ?? e.description,
    amount: patch.amount ?? Number(e.amount), sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_alternates SET kind=$1, description=$2, amount=$3, sort=$4, updated_at=now() WHERE id=$5 AND bid_id=$6 RETURNING *`,
    [next.kind, next.description, next.amount, next.sort, id, bidId]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), auto: !!r.auto, sourceRule: r.source_rule, sort: Number(r.sort) };
}

export async function deleteAlternate(id: string, bidId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_alternates WHERE id=$1 AND bid_id=$2 AND auto=false', [id, bidId]);
  return (rowCount ?? 0) > 0;
}

/** Upserts (by bid_id + source_rule) a system-computed alternate — e.g. the
 *  7-Eleven Graybar-package auto deduct. A zero/negative amount removes it
 *  (nothing to deduct means no alternate line, not a $0.00 one). */
export async function upsertAutoAlternate(bidId: string, sourceRule: string, input: { kind: 'add' | 'deduct'; description: string; amount: number }): Promise<void> {
  if (!(input.amount > 0)) {
    await pool.query('DELETE FROM est_bid_alternates WHERE bid_id=$1 AND source_rule=$2', [bidId, sourceRule]);
    return;
  }
  await pool.query(
    `INSERT INTO est_bid_alternates (bid_id, kind, description, amount, auto, source_rule)
     VALUES ($1,$2,$3,$4,true,$5)
     ON CONFLICT (bid_id, source_rule) WHERE auto DO UPDATE SET kind=$2, description=$3, amount=$4, updated_at=now()`,
    [bidId, input.kind, input.description, input.amount, sourceRule]
  );
}

// ── Per-GC overhead default table (Settings) ─────────────────────────────────

export async function getGcOverheadDefault(gcName: string): Promise<number> {
  const { rows } = await pool.query('SELECT overhead_pct FROM est_gc_overhead_defaults WHERE gc_name = $1', [gcName]);
  return rows.length ? Number(rows[0].overhead_pct) : DEFAULT_LABOR_OVERHEAD_PCT;
}

export async function listGcOverheadDefaults(): Promise<Array<{ gcName: string; overheadPct: number }>> {
  const { rows } = await pool.query('SELECT gc_name, overhead_pct FROM est_gc_overhead_defaults ORDER BY gc_name');
  return rows.map(r => ({ gcName: r.gc_name, overheadPct: Number(r.overhead_pct) }));
}

export async function setGcOverheadDefault(gcName: string, overheadPct: number): Promise<void> {
  await pool.query(
    `INSERT INTO est_gc_overhead_defaults (gc_name, overhead_pct, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (gc_name) DO UPDATE SET overhead_pct=$2, updated_at=now()`,
    [gcName, overheadPct]
  );
}

// ── Assembling and saving the recap for a bid ───────────────────────────────

export interface AccubidBidRecap {
  recap: AccubidRecapResult;
  settings: AccubidSettings;
  crew: CrewConfig;
  totalHours: number;
  quotes: QuoteRow[];
  costLines: CostLineRow[];
  alternates: AlternateRow[];
}

/** Raw material $ and labor hours from the bid's saved est_bid_lines,
 *  resolved against the SAME library Phase A prices from (priceBid with
 *  every add-on pct zeroed out — this is purely "what do the lines cost/
 *  take, before any Accubid-side overhead or markup is layered on"). */
async function materialAndHoursFromLines(bidId: string): Promise<{ material: number; hours: number }> {
  const [library, lines] = await Promise.all([getLibrary(), getBidLines(bidId)]);
  const resolved = resolveLines(lines, library);
  const neutralSettings: PricingSettings = {
    laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1,
  };
  const recap = priceBid(resolved, neutralSettings, []);
  return { material: recap.totals.materialSubtotal, hours: recap.totals.laborHours };
}

export async function computeAccubidRecapForBid(bidId: string): Promise<AccubidBidRecap> {
  const [settings, { material, hours }, quotes, costLines, alternates] = await Promise.all([
    getAccubidSettings(bidId), materialAndHoursFromLines(bidId), getQuotes(bidId), getCostLines(bidId), getAlternates(bidId),
  ]);
  const crew = crewFromSettings(settings);
  const fieldLabor = computeFieldLaborCost(hours, crew);

  const equipmentLines = costLines.filter(c => c.kind === 'equipment');
  const geLines = costLines.filter(c => c.kind === 'general_expense');
  const equipmentTotal = equipmentLines.reduce((s, c) => s + c.amount, 0);
  const geTotal = geLines.reduce((s, c) => s + c.amount, 0);
  // Review round 2 / N14 — each cost line can carry its OWN tax %, so the
  // exact tax dollars are summed per line here and passed through as
  // AccubidRecapInput's taxAmount, instead of blending every line's rate
  // into one weighted-average % (rounded to 2 decimals) and re-deriving tax
  // from that — lossy the moment two lines in the same list don't share a
  // tax rate (a taxed piece of equipment next to a non-taxed permit fee,
  // say). Rounding each line's own tax to the cent before summing matches
  // how a real invoice/PO actually taxes each item.
  const roundMoneyLine = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const equipmentTax = equipmentLines.reduce((s, c) => s + roundMoneyLine(c.amount * (c.taxPct / 100)), 0);
  const geTax = geLines.reduce((s, c) => s + roundMoneyLine(c.amount * (c.taxPct / 100)), 0);

  const quoteLines: QuoteLine[] = quotes.map(q => ({ description: q.description, amount: q.amount, taxPct: q.taxPct, markupPct: q.markupPct, status: q.status }));

  const input: AccubidRecapInput = {
    material: { amount: material, taxPct: settings.materialTaxPct },
    fieldLaborCost: fieldLabor.totalCost,
    equipment: { amount: equipmentTotal, taxAmount: equipmentTax },
    generalExpenses: { amount: geTotal, taxAmount: geTax },
    quotes: quoteLines,
    laborOverheadPct: settings.laborOverheadPct,
    materialMarkupPct: settings.materialMarkupPct,
    laborMarkupPct: settings.laborMarkupPct,
    adjustmentMarkupPct: settings.adjustmentMarkupPct,
    salesMarkupPct: settings.salesMarkupPct,
  };
  const recap = computeAccubidRecap(input);
  return { recap, settings, crew, totalHours: hours, quotes, costLines, alternates };
}

/** Next round Part B (coordinator follow-up) — recomputes and upserts the
 *  bid's account-rule auto deduct alternate (the 7-Eleven Graybar package),
 *  if the bid's matched account rule has one configured. A no-op (and
 *  removes any stale auto alternate) when the rule has none, or when
 *  nothing on the bid matches its termKeys. Uses Phase A's own
 *  resolveLines/priceBid for the per-line material breakdown — the same
 *  basis regardless of which pricing mode (phase_a/accubid) the bid is in,
 *  since est_bid_lines and the library are shared. */
export async function syncAutoDeductAlternateForBid(bidId: string): Promise<void> {
  const { rows: bidRows } = await pool.query('SELECT brand, name, project_type FROM bids WHERE id = $1 AND deleted_at IS NULL', [bidId]);
  const bid = bidRows[0] as { brand?: string | null; name?: string | null; project_type?: string | null } | undefined;
  const SOURCE_RULE = 'account_rule_auto_deduct';
  if (!bid) { await pool.query('DELETE FROM est_bid_alternates WHERE bid_id=$1 AND source_rule=$2', [bidId, SOURCE_RULE]); return; }

  const rules = await listAccountRules();
  const { rule } = matchAccountRule(rules, { brand: bid.brand, bidName: bid.name, projectType: bid.project_type });
  const config = rule?.autoDeductAlternate;
  if (!config?.enabled) {
    await pool.query('DELETE FROM est_bid_alternates WHERE bid_id=$1 AND source_rule=$2', [bidId, SOURCE_RULE]);
    return;
  }

  const [library, lines, settings] = await Promise.all([getLibrary(), getBidLines(bidId), getAccubidSettings(bidId)]);
  const resolved = resolveLines(lines, library);
  const neutralSettings: PricingSettings = { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 };
  const priced = priceBid(resolved, neutralSettings, []);

  const result = computeAutoDeductAmount(
    priced.lines.map(l => ({ category: l.category, description: l.description, materialExt: l.materialExt, excluded: l.excluded })),
    { termKeys: config.termKeys, materialMarkupPct: settings.materialMarkupPct, taxable: config.taxable, materialTaxPct: settings.materialTaxPct }
  );

  await upsertAutoAlternate(bidId, SOURCE_RULE, {
    kind: 'deduct',
    description: formatAutoDeductLabel(config.label, result.amount),
    amount: result.amount,
  });
}

/** Writes the recap's Selling Price into bid_estimates/bids.amount — the
 *  same downstream contract Phase A's writeBidEstimateSnapshot guarantees
 *  (composeProposal / the proposal price flow read bids.amount either way,
 *  never caring which pricing mode produced it).
 *
 *  Fix round 2 / B4 ("Also") — line_items/subtotals are now built the SAME
 *  way writeBidEstimateSnapshot builds them (a Phase A recap of the bid's
 *  actual lines, at neutral 0% settings — used ONLY for its per-line
 *  category/qty_source/confidence/takeoff_key facts, never for the total),
 *  instead of being hardcoded to '[]'/'{}' forever on a bid's first Accubid
 *  save. Before this fix, a brand-new bid (which defaults to Accubid mode)
 *  saved its very first lines through this path and never got real
 *  line_items at all — composeBidData.ts's SavedConfidenceItem lookup came
 *  back empty for every takeoff item, breaking Agent 4's per-line
 *  confidence/qty routing on every Accubid-mode bid. */
export async function saveAccubidRecapForBid(bidId: string): Promise<AccubidBidRecap> {
  const [result, lines, library] = await Promise.all([
    computeAccubidRecapForBid(bidId), getBidLines(bidId), getLibrary(),
  ]);
  const comps = await computeBidComps(bidId);
  const resolved = resolveLines(lines, library);
  const neutralSettings: PricingSettings = { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 };
  const phaseARecapForLineFacts = priceBid(resolved, neutralSettings, []);
  const { legacyLineItems, subtotals } = buildLegacyLineItemsAndSubtotals(phaseARecapForLineFacts, lines);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bid_estimates (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total, comp_count, confidence, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         overhead_pct=$2, profit_pct=$3, line_items=$4::jsonb, subtotals=$5::jsonb,
         total_direct=$6, total_overhead=$7, total_profit=$8, grand_total=$9, comp_count=$10, confidence=$11, updated_at=now()`,
      [bidId, result.settings.laborOverheadPct, result.settings.materialMarkupPct,
       JSON.stringify(legacyLineItems), JSON.stringify(subtotals),
       result.recap.primeCost, result.recap.totalOverhead, result.recap.totalMarkup, result.recap.sellingPrice,
       comps.compCount, comps.confidence]
    );
    await client.query('UPDATE bids SET amount = $1 WHERE id = $2 AND deleted_at IS NULL', [result.recap.sellingPrice, bidId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // Outside the transaction (its own upsert, non-critical to the save
  // succeeding — a failure here shouldn't roll back a real price save).
  await syncAutoDeductAlternateForBid(bidId).catch(() => {});
  return result;
}

/** Fix round 2 / B4 — the ONE entry point every quote/cost-line/alternate
 *  mutation calls after writing its own row: re-persists
 *  bid_estimates/bids.amount from whichever pricing engine the bid is
 *  ACTUALLY in right now, so the two engines can never leave a stale number
 *  behind after an edit (the reviewer's repro: adding a $5,000 quote left
 *  bids.amount showing the pre-quote total until someone happened to press
 *  the Accubid settings Save button). Phase A's own saveBidEstimate/
 *  syncTakeoff call the same two functions directly (see bidEstimate.ts) —
 *  this dispatcher exists for every OTHER mutation that doesn't already
 *  know the bid's mode. */
export async function persistPriceForBid(bidId: string): Promise<void> {
  const settings = await getBidSettings(bidId);
  if (settings.pricing_mode === 'phase_a') {
    await persistPhaseAPriceForBid(bidId);
  } else {
    await saveAccubidRecapForBid(bidId);
  }
}
