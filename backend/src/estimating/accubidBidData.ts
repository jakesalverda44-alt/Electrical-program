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
import { getBidLines, resolveLines, BidLineRow } from './bidEstimate';
import { computeBidComps } from '../utils/bidComps';
import {
  computeAccubidRecap, AccubidRecapInput, AccubidRecapResult, QuoteLine, CrewConfig, CrewMember,
  computeFieldLaborCost, DEFAULT_LABOR_OVERHEAD_PCT, DEFAULT_MATERIAL_MARKUP_PCT,
  DEFAULT_LABOR_MARKUP_PCT, DEFAULT_QUOTE_MARKUP_PCT, DEFAULT_ADJUSTMENT_PCT,
  DEFAULT_BURDEN_PCT, DEFAULT_FRINGE_PER_HR,
} from './accubidRecap';

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

export async function updateQuote(id: string, patch: Partial<QuoteInput>): Promise<QuoteRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_quotes WHERE id=$1', [id]);
  if (!existingRows.length) return null;
  const e = existingRows[0];
  const next = {
    description: patch.description ?? e.description, amount: patch.amount ?? Number(e.amount),
    taxPct: patch.taxPct ?? Number(e.tax_pct), markupPct: patch.markupPct ?? Number(e.markup_pct),
    status: patch.status ?? e.status, vendor: patch.vendor !== undefined ? patch.vendor : e.vendor,
    sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_quotes SET description=$1, amount=$2, tax_pct=$3, markup_pct=$4, status=$5, vendor=$6, sort=$7, updated_at=now() WHERE id=$8 RETURNING *`,
    [next.description, next.amount, next.taxPct, next.markupPct, next.status, next.vendor, next.sort, id]
  );
  const r = rows[0];
  return { id: r.id, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), markupPct: Number(r.markup_pct), status: r.status, vendor: r.vendor, sort: Number(r.sort) };
}

export async function deleteQuote(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_quotes WHERE id=$1', [id]);
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

export async function updateCostLine(id: string, patch: Partial<CostLineInput>): Promise<CostLineRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_cost_lines WHERE id=$1', [id]);
  if (!existingRows.length) return null;
  const e = existingRows[0];
  const next = {
    kind: patch.kind ?? e.kind, description: patch.description ?? e.description,
    amount: patch.amount ?? Number(e.amount), taxPct: patch.taxPct ?? Number(e.tax_pct), sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_cost_lines SET kind=$1, description=$2, amount=$3, tax_pct=$4, sort=$5, updated_at=now() WHERE id=$6 RETURNING *`,
    [next.kind, next.description, next.amount, next.taxPct, next.sort, id]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), taxPct: Number(r.tax_pct), sort: Number(r.sort) };
}

export async function deleteCostLine(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_cost_lines WHERE id=$1', [id]);
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

export async function updateAlternate(id: string, patch: Partial<AlternateInput>): Promise<AlternateRow | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_bid_alternates WHERE id=$1 AND auto=false', [id]);
  if (!existingRows.length) return null; // an auto alternate is never hand-edited — only replaced by the next sync
  const e = existingRows[0];
  const next = {
    kind: patch.kind ?? e.kind, description: patch.description ?? e.description,
    amount: patch.amount ?? Number(e.amount), sort: patch.sort ?? Number(e.sort),
  };
  const { rows } = await pool.query(
    `UPDATE est_bid_alternates SET kind=$1, description=$2, amount=$3, sort=$4, updated_at=now() WHERE id=$5 RETURNING *`,
    [next.kind, next.description, next.amount, next.sort, id]
  );
  const r = rows[0];
  return { id: r.id, kind: r.kind, description: r.description, amount: Number(r.amount), auto: !!r.auto, sourceRule: r.source_rule, sort: Number(r.sort) };
}

export async function deleteAlternate(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM est_bid_alternates WHERE id=$1 AND auto=false', [id]);
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
  // Cost lines can each carry their own tax; the recap's TaxedAmount is a
  // single net+pct pair, so a mixed-tax list is pre-taxed here and passed
  // through at 0% (the recap would otherwise apply one blended % twice).
  const equipmentNetPlusTax = equipmentLines.reduce((s, c) => s + c.amount * (1 + c.taxPct / 100), 0);
  const geNetPlusTax = geLines.reduce((s, c) => s + c.amount * (1 + c.taxPct / 100), 0);

  const quoteLines: QuoteLine[] = quotes.map(q => ({ description: q.description, amount: q.amount, taxPct: q.taxPct, markupPct: q.markupPct, status: q.status }));

  const input: AccubidRecapInput = {
    material: { amount: material, taxPct: settings.materialTaxPct },
    fieldLaborCost: fieldLabor.totalCost,
    equipment: { amount: equipmentTotal, taxPct: equipmentTotal > 0 ? Math.round(((equipmentNetPlusTax / equipmentTotal) - 1) * 10000) / 100 : 0 },
    generalExpenses: { amount: geTotal, taxPct: geTotal > 0 ? Math.round(((geNetPlusTax / geTotal) - 1) * 10000) / 100 : 0 },
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

/** Writes the recap's Selling Price into bid_estimates/bids.amount — the
 *  same downstream contract Phase A's writeBidEstimateSnapshot guarantees
 *  (composeProposal / the proposal price flow read bids.amount either way,
 *  never caring which pricing mode produced it). */
export async function saveAccubidRecapForBid(bidId: string): Promise<AccubidBidRecap> {
  const result = await computeAccubidRecapForBid(bidId);
  const comps = await computeBidComps(bidId);
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bid_estimates (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total, comp_count, confidence, updated_at)
       VALUES ($1,$2,$3,'[]'::jsonb,'{}'::jsonb,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         overhead_pct=$2, profit_pct=$3, total_direct=$4, total_overhead=$5, total_profit=$6, grand_total=$7, comp_count=$8, confidence=$9, updated_at=now()`,
      [bidId, result.settings.laborOverheadPct, result.settings.materialMarkupPct,
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
  return result;
}
