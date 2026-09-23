// Estimating labor engine — Task 5: load/save a bid's priced lines. This is
// the seam between the pure engine (pricing.ts, mapper.ts) and the DB — it
// resolves est_bid_lines against the library, prices them, and on save
// upserts bid_estimates + bids.amount in the same transaction so the two
// never drift apart. Existing readers of bid_estimates keep working: this
// module WRITES that table, nothing downstream changes.
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { computeBidComps } from '../utils/bidComps';
import { priceBid, PricingLineInput, PricingSettings, PricingFactorInput, PricingRecap, EstUnit, LineConfidence } from './pricing';
import { mapTakeoffLines, fromLegacyTakeoff, LibraryCandidate, normalizeUnit, unitFamily, isUnitCompatible } from './mapper';
import { getLibrary, resolveAssemblyCost, Library, LibraryItem } from './library';

// Fix round 1 / B2 — thrown instead of writing a recap whose grand total (or
// any other total) isn't finite; routes/estimating.ts catches this specific
// error and turns it into a 400 rather than a 500 or a silently-corrupt write.
export class NonFiniteTotalError extends Error {
  constructor() {
    super('Computed totals are not finite — refusing to save');
    this.name = 'NonFiniteTotalError';
  }
}

function assertFiniteRecap(recap: PricingRecap): void {
  const t = recap.totals;
  const values = [
    t.materialSubtotal, t.consumables, t.materialTax, t.laborHours, t.laborCost,
    t.smallTools, t.directCost, t.overhead, t.profit, t.grandTotal, t.crewWeeks,
  ];
  if (t.sellPerSf != null) values.push(t.sellPerSf);
  if (values.some(v => !Number.isFinite(v))) throw new NonFiniteTotalError();
}

// A vanished-from-takeoff line is excluded rather than deleted (Task 5), with
// this prefix on its description recording why — est_bid_lines has no
// separate notes column (Task 1's schema), so the note lives in the text
// itself. Idempotent: re-syncing an already-vanished line doesn't double the
// prefix.
export const VANISHED_PREFIX = '[No longer in takeoff] ';

export interface ClientLineInput {
  id?: string;
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  assembly_id?: string | null;
  item_id?: string | null;
  takeoff_key?: string | null;
  /** Agent 4's short takeoff item id (e.g. "5.1") for a takeoff-sourced line —
   *  null for a manual line (it has no takeoff item to key on; its
   *  description is what composeBidData's line_items.item carries instead —
   *  see saveBidEstimate()'s legacyLineItems construction). */
  takeoff_item_id?: string | null;
  material_unit_override?: number | null;
  labor_hours_override?: number | null;
  confidence?: LineConfidence | null;
  excluded?: boolean;
  /** Fix round 1 / B5 — true when the ESTIMATOR (not the takeoff) set this
   *  line's qty by hand. sync-takeoff never overwrites qty on a line where
   *  this is true, no matter what the current takeoff says. The frontend
   *  sets this the moment the estimator edits a takeoff-sourced line's qty
   *  field; it is never inferred server-side from a value diff. */
  qty_overridden?: boolean;
  source: 'takeoff' | 'manual';
  sort?: number;
}

export interface BidLineRow extends ClientLineInput {
  id: string;
  sort: number;
  /** Fix round 1 / B5 — true when this line's CURRENT excluded=true was set
   *  BY sync-takeoff because the line vanished from the takeoff, as opposed
   *  to the estimator deliberately excluding it. A line that reappears in a
   *  later takeoff un-excludes only when this is true; a user-excluded line
   *  (this false) stays excluded through a sync. Read-only from the client's
   *  perspective — sync-takeoff is the only writer. */
  sync_excluded?: boolean;
}

export interface ClientSettingsInput {
  labor_rate: number;
  factor_ids: string[];
  material_tax_pct: number;
  small_tools_pct: number;
  supervision_pct: number;
  consumables_pct: number;
  overhead_pct: number;
  profit_pct: number;
  crew_size: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function getBidLines(bidId: string): Promise<BidLineRow[]> {
  const { rows } = await pool.query(
    'SELECT * FROM est_bid_lines WHERE bid_id = $1 ORDER BY sort, created_at',
    [bidId]
  );
  return rows.map(rowToBidLine);
}

function rowToBidLine(r: Record<string, unknown>): BidLineRow {
  return {
    id: r.id as string,
    category: r.category as string,
    description: r.description as string,
    qty: Number(r.qty),
    unit: r.unit as EstUnit,
    assembly_id: (r.assembly_id as string | null) ?? null,
    item_id: (r.item_id as string | null) ?? null,
    takeoff_key: (r.takeoff_key as string | null) ?? null,
    takeoff_item_id: (r.takeoff_item_id as string | null) ?? null,
    material_unit_override: r.material_unit_override != null ? Number(r.material_unit_override) : null,
    labor_hours_override: r.labor_hours_override != null ? Number(r.labor_hours_override) : null,
    confidence: (r.confidence as LineConfidence | null) ?? null,
    excluded: !!r.excluded,
    qty_overridden: !!r.qty_overridden,
    sync_excluded: !!r.sync_excluded,
    source: r.source as 'takeoff' | 'manual',
    sort: Number(r.sort),
  };
}

// Fix round 1 / S5 — `Number(x) || fallback` silently drops an explicit,
// legitimate 0 (0% supervision, 0% tax) and falls back instead. Use this
// everywhere a stored/settable numeric value has a fallback default.
function numberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Fix round 1 / S6 — a bid's first-ever settings row (no est_bid_settings
 *  saved yet) should inherit overhead_pct/profit_pct from wherever this SAME
 *  bid already recorded them, rather than always starting at the hardcoded
 *  10/15: the bid's own bid_workspaces row (the estimator may have set these
 *  in the legacy pricing flow already) takes priority, then bid_estimates
 *  (a prior legacy-engine save), then the 10/15 default. */
async function inheritedOverheadProfit(bidId: string): Promise<{ overhead_pct: number; profit_pct: number }> {
  const [{ rows: wsRows }, { rows: beRows }] = await Promise.all([
    pool.query('SELECT overhead_pct, profit_pct FROM bid_workspaces WHERE bid_id = $1', [bidId]),
    pool.query('SELECT overhead_pct, profit_pct FROM bid_estimates WHERE bid_id = $1', [bidId]),
  ]);
  const ws = wsRows[0];
  const be = beRows[0];
  const overhead_pct = ws?.overhead_pct != null ? numberOr(ws.overhead_pct, 10)
    : be?.overhead_pct != null ? numberOr(be.overhead_pct, 10)
    : 10;
  const profit_pct = ws?.profit_pct != null ? numberOr(ws.profit_pct, 15)
    : be?.profit_pct != null ? numberOr(be.profit_pct, 15)
    : 15;
  return { overhead_pct, profit_pct };
}

export async function getBidSettings(bidId: string): Promise<ClientSettingsInput> {
  const { rows } = await pool.query('SELECT * FROM est_bid_settings WHERE bid_id = $1', [bidId]);
  if (rows.length) {
    const r = rows[0];
    return {
      labor_rate: numberOr(r.labor_rate, 38),
      factor_ids: (r.factor_ids as string[]) ?? [],
      material_tax_pct: numberOr(r.material_tax_pct, 7),
      small_tools_pct: numberOr(r.small_tools_pct, 3),
      supervision_pct: numberOr(r.supervision_pct, 0),
      consumables_pct: numberOr(r.consumables_pct, 2),
      overhead_pct: numberOr(r.overhead_pct, 10),
      profit_pct: numberOr(r.profit_pct, 15),
      crew_size: numberOr(r.crew_size, 3),
    };
  }
  const [laborRate, taxPct, toolsPct, supervisionPct, consumablesPct, inherited] = await Promise.all([
    getSetting('est_default_labor_rate'),
    getSetting('est_default_material_tax_pct'),
    getSetting('est_default_small_tools_pct'),
    getSetting('est_default_supervision_pct'),
    getSetting('est_default_consumables_pct'),
    inheritedOverheadProfit(bidId),
  ]);
  return {
    labor_rate: numberOr(laborRate, 38),
    factor_ids: [],
    material_tax_pct: numberOr(taxPct, 7),
    small_tools_pct: numberOr(toolsPct, 3),
    supervision_pct: numberOr(supervisionPct, 0),
    consumables_pct: numberOr(consumablesPct, 2),
    overhead_pct: inherited.overhead_pct,
    profit_pct: inherited.profit_pct,
    crew_size: 3,
  };
}

async function getBidSqFt(bidId: string): Promise<number | null> {
  const { rows } = await pool.query('SELECT sq_ft FROM bids WHERE id = $1', [bidId]);
  const v = rows[0]?.sq_ft;
  return v != null && v !== '' ? Number(v) : null;
}

// ── Resolving lines/settings against the library ────────────────────────────

export function toLibraryCandidates(library: Library, opts: { activeOnly?: boolean } = {}): LibraryCandidate[] {
  const activeOnly = opts.activeOnly ?? true;
  const assemblies: LibraryCandidate[] = library.assemblies
    .filter(a => !activeOnly || a.active)
    .map(a => ({ kind: 'assembly', id: a.id, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases }));
  const items: LibraryCandidate[] = library.items
    .filter(i => !activeOnly || i.active)
    .map(i => ({ kind: 'item', id: i.id, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases }));
  // Assemblies first so the mapper's "prefer an assembly over a bare item" tie-break
  // has an assembly candidate to prefer regardless of DB row order.
  return [...assemblies, ...items];
}

export function resolveLines(lines: BidLineRow[], library: Library): PricingLineInput[] {
  const itemsById = new Map<string, LibraryItem>(library.items.map(i => [i.id, i]));
  const assembliesById = new Map(library.assemblies.map(a => [a.id, a]));

  return lines.map(line => {
    let materialUnitCost = 0;
    let laborHoursUnit = 0;
    let unverifiedPrice = false;
    let matched = false;
    let libraryUnit: EstUnit | null = null;

    // Fix round 1 / B2 — a line whose raw unit isn't one of the four known
    // EstUnit values (LS/SET/LOT/blank/anything else) can never be priced
    // against a library row, no matter what item_id/assembly_id it carries —
    // treat it as unmatched and let pricing.ts's unitUnknown path handle it
    // (0 unless an explicit override is given, never NaN).
    const unitUnknown = unitFamily(line.unit) === 'OTHER';

    if (!unitUnknown && line.item_id) {
      const item = itemsById.get(line.item_id);
      // Fix round 1 / B1 — never let a line match an item in an incompatible
      // unit family (EA vs LF/C/M). If stale/bad data ever put an item_id on
      // a unit-incompatible line, treat it the same as no match at all
      // rather than pricing it in the wrong basis.
      if (item && isUnitCompatible(line.unit, item.unit)) {
        materialUnitCost = item.material_cost;
        laborHoursUnit = item.labor_hours;
        unverifiedPrice = item.material_price_date == null;
        matched = true;
        libraryUnit = item.unit;
      }
    } else if (!unitUnknown && line.assembly_id) {
      const asm = assembliesById.get(line.assembly_id);
      if (asm && isUnitCompatible(line.unit, asm.unit)) {
        const resolved = resolveAssemblyCost(asm, itemsById);
        materialUnitCost = resolved.materialCost;
        laborHoursUnit = resolved.laborHours;
        unverifiedPrice = resolved.unverified;
        matched = true;
        libraryUnit = asm.unit;
      }
    }

    // A takeoff-sourced line that never resolved to a library row still needs
    // resolving in the UI — a manual line (typed material $/hours, no
    // assembly/item) is intentionally unmatched and isn't a warning. A
    // unit-unknown line is always "unresolved" too (it can never auto-match).
    const unresolved = (line.source === 'takeoff' || unitUnknown) && !matched;

    return {
      id: line.id,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      libraryUnit,
      materialUnitCost,
      laborHoursUnit,
      materialUnitOverride: line.material_unit_override,
      laborHoursOverride: line.labor_hours_override,
      confidence: line.confidence,
      excluded: !!line.excluded,
      matched,
      unresolved,
      unverifiedPrice,
      unitUnknown,
    };
  });
}

export function resolveFactors(factorIds: string[], library: Library): PricingFactorInput[] {
  const byId = new Map(library.factors.map(f => [f.id, f]));
  const out: PricingFactorInput[] = [];
  for (const id of factorIds) {
    const f = byId.get(id);
    if (f) out.push({ code: f.code, pct: f.pct, groupKey: f.group_key });
  }
  return out;
}

function toPricingSettings(settings: ClientSettingsInput, sqFt: number | null): PricingSettings {
  return {
    laborRate: settings.labor_rate,
    materialTaxPct: settings.material_tax_pct,
    smallToolsPct: settings.small_tools_pct,
    supervisionPct: settings.supervision_pct,
    consumablesPct: settings.consumables_pct,
    overheadPct: settings.overhead_pct,
    profitPct: settings.profit_pct,
    crewSize: settings.crew_size,
    sqFt,
  };
}

/** Fresh recap for a bid's currently SAVED lines/settings. */
export async function computeRecapForBid(bidId: string): Promise<PricingRecap> {
  const [library, lines, settings, sqFt] = await Promise.all([
    getLibrary(), getBidLines(bidId), getBidSettings(bidId), getBidSqFt(bidId),
  ]);
  const resolved = resolveLines(lines, library);
  const factors = resolveFactors(settings.factor_ids, library);
  return priceBid(resolved, toPricingSettings(settings, sqFt), factors);
}

/** Price an unsaved payload (POST /:bidId/price) — no writes. */
export async function priceUnsaved(
  bidId: string, lines: ClientLineInput[], settings: ClientSettingsInput
): Promise<PricingRecap> {
  const [library, sqFt] = await Promise.all([getLibrary(), getBidSqFt(bidId)]);
  const rows = lines.map((l, idx) => ({ ...l, id: l.id ?? `unsaved-${idx}`, sort: l.sort ?? idx })) as BidLineRow[];
  const resolved = resolveLines(rows, library);
  const factors = resolveFactors(settings.factor_ids, library);
  return priceBid(resolved, toPricingSettings(settings, sqFt), factors);
}

// ── Parsing the current takeoff (Agent 2/4 JSON in takeoff_results) ────────

export interface RawTakeoffRow {
  category: string;
  /** Agent 4's short takeoff item id ("5.1") — see mapper.ts's LegacyTakeoffRow
   *  for the corrected understanding of this field (Part 1 follow-up). */
  item: string;
  /** The descriptive text to match against the library; falls back to `item`
   *  when absent. */
  spec?: string;
  qty: number | string;
  unit: string;
  confidence?: string;
}

/** Extracts the `{ takeoff: [...] }` JSON block from Agent 2/4's raw text
 *  output — mirrors frontend/src/features/preconstruction/PcWorkspace/
 *  parsing.ts's buildLineItemsFromTakeoff exactly (fenced code block, then
 *  the first `{`), so both read the same stored agent2_output the same way. */
export function parseAgent2Takeoff(raw: string | null | undefined): RawTakeoffRow[] {
  if (!raw) return [];
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as { takeoff?: RawTakeoffRow[] };
    return parsed.takeoff ?? [];
  } catch {
    return [];
  }
}

async function getCurrentTakeoffRows(bidId: string): Promise<RawTakeoffRow[]> {
  const { rows } = await pool.query('SELECT agent2_output FROM takeoff_results WHERE bid_id = $1', [bidId]);
  return parseAgent2Takeoff(rows[0]?.agent2_output ?? null);
}

function takeoffKey(row: RawTakeoffRow): string {
  return `${row.category}||${row.item}`;
}

/** Fix round 1 / B5 — Agent 2/4 output can legitimately repeat the same
 *  category+item id (e.g. two "5.1" rows after a manual re-split). A bare
 *  `takeoffKey()` collapses every duplicate onto the SAME map entry, so all
 *  but the last are silently dropped from syncTakeoff's bookkeeping. Suffix
 *  every occurrence after the first with `::1`, `::2`, ... so each row gets
 *  its own stable, order-derived key and none are ever dropped. The first
 *  occurrence keeps the unsuffixed key so existing stored takeoff_key values
 *  (from before this fix, or for the common non-duplicate case) keep
 *  matching across a re-sync. */
function dedupeTakeoffKeys(rows: RawTakeoffRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const base = takeoffKey(row);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}::${n}`;
  });
}

// ── Proposed mapping (GET /:bidId when no est_bid_lines exist yet) ─────────

export interface ProposedResult {
  hasTakeoff: boolean;
  lines: BidLineRow[];
}

/** Builds an UNSAVED proposed mapping from the bid's current takeoff, for a
 *  bid with no est_bid_lines rows yet. Never writes to the DB. */
export async function getProposedLinesFromTakeoff(bidId: string): Promise<ProposedResult> {
  const rawRows = await getCurrentTakeoffRows(bidId);
  if (!rawRows.length) return { hasTakeoff: false, lines: [] };

  const library = await getLibrary();
  const candidates = toLibraryCandidates(library);
  const normalized = fromLegacyTakeoff(rawRows);
  const mapped = mapTakeoffLines(normalized, candidates);
  const keys = dedupeTakeoffKeys(rawRows); // B5: never collapse duplicate category+item takeoff rows onto one key

  const lines: BidLineRow[] = mapped.map((m, idx) => ({
    id: `proposed-${idx}`,
    category: m.category,
    description: m.description,
    qty: m.qty,
    unit: m.unit as EstUnit,
    assembly_id: m.matchedKind === 'assembly' ? m.matchedId : null,
    item_id: m.matchedKind === 'item' ? m.matchedId : null,
    takeoff_key: keys[idx],
    takeoff_item_id: rawRows[idx].item ?? null,
    material_unit_override: null,
    labor_hours_override: null,
    confidence: m.sourceConfidence,
    excluded: false,
    qty_overridden: false,
    sync_excluded: false,
    source: 'takeoff',
    sort: idx,
  }));
  return { hasTakeoff: true, lines };
}

// ── Sync from takeoff (POST /:bidId/sync-takeoff) ───────────────────────────

export interface SyncResult {
  added: number;
  updated: number;
  vanished: number;
  lines: BidLineRow[];
}

/** Rebuilds a bid's takeoff-sourced lines from the current takeoff, keyed by
 *  takeoff_key: existing matches/overrides/exclusions are preserved, new
 *  takeoff lines are added (mapped against the library), and takeoff lines
 *  that no longer appear are excluded with a note rather than deleted.
 *  Manual lines (source='manual') are never touched.
 *
 *  Fix round 1 / B5:
 *  - A qty_overridden line's qty is NEVER refreshed from the takeoff (the
 *    estimator typed it by hand — most often to fill in a VERIFY line's 0
 *    qty; a re-sync must not wipe that back to 0).
 *  - excluded/sync_excluded are tracked separately so a line that vanishes
 *    and later reappears un-excludes only if SYNC excluded it — a line the
 *    estimator deliberately excluded stays excluded through any number of
 *    re-syncs.
 *  - Duplicate category+item takeoff rows get distinct, disambiguated keys
 *    (dedupeTakeoffKeys) so a re-run never silently drops one.
 *  - bid_estimates/bids.amount are recomputed and written in the SAME
 *    transaction as the est_bid_lines changes, so what's shown never drifts
 *    from what sync just did to the lines underneath it. */
export async function syncTakeoff(bidId: string): Promise<SyncResult> {
  const [rawRows, existing, library, settings, sqFt, comps] = await Promise.all([
    getCurrentTakeoffRows(bidId), getBidLines(bidId), getLibrary(),
    getBidSettings(bidId), getBidSqFt(bidId), computeBidComps(bidId),
  ]);
  const candidates = toLibraryCandidates(library);
  const normalized = fromLegacyTakeoff(rawRows);
  const mapped = mapTakeoffLines(normalized, candidates);
  const keys = dedupeTakeoffKeys(rawRows);

  const existingByKey = new Map<string, BidLineRow>();
  for (const line of existing) {
    if (line.source === 'takeoff' && line.takeoff_key) existingByKey.set(line.takeoff_key, line);
  }

  const freshKeys = new Set<string>();
  let added = 0;
  let updated = 0;
  let vanished = 0;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const key = keys[i];
      freshKeys.add(key);
      const m = mapped[i];
      const existingLine = existingByKey.get(key);

      if (existingLine) {
        // qty_overridden: the estimator's hand-typed qty survives untouched.
        const nextQty = existingLine.qty_overridden ? existingLine.qty : m.qty;
        // Reappearance un-excludes only a line SYNC itself excluded earlier;
        // a line the estimator excluded on purpose stays excluded.
        const wasSyncExcluded = !!existingLine.excluded && !!existingLine.sync_excluded;
        const nextExcluded = wasSyncExcluded ? false : !!existingLine.excluded;
        const nextSyncExcluded = wasSyncExcluded ? false : !!existingLine.sync_excluded;

        // Keep the existing match/overrides; refresh the takeoff-owned facts
        // (takeoff_item_id included — it's a takeoff fact, not an estimator
        // edit). `m.description` is always the FRESH mapped text, so a line
        // that reappears after being vanished-prefixed is naturally restored
        // to its real description here, not the old "[No longer in
        // takeoff]"-prefixed one.
        await client.query(
          `UPDATE est_bid_lines
             SET qty=$1, unit=$2, description=$3, confidence=$4, takeoff_item_id=$5,
                 excluded=$6, sync_excluded=$7, updated_at=now()
           WHERE id=$8`,
          [nextQty, m.unit, m.description, m.sourceConfidence ?? null, row.item ?? null,
           nextExcluded, nextSyncExcluded, existingLine.id]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, assembly_id, item_id, takeoff_key, takeoff_item_id, confidence, source, excluded)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'takeoff',false)`,
          [bidId, i, row.category, m.description, m.qty, m.unit,
           m.matchedKind === 'assembly' ? m.matchedId : null,
           m.matchedKind === 'item' ? m.matchedId : null,
           key, row.item ?? null, m.sourceConfidence ?? null]
        );
        added++;
      }
    }

    for (const [key, line] of existingByKey) {
      if (freshKeys.has(key) || line.excluded) continue;
      const note = line.description.startsWith(VANISHED_PREFIX) ? line.description : `${VANISHED_PREFIX}${line.description}`;
      await client.query(
        `UPDATE est_bid_lines SET excluded=true, sync_excluded=true, description=$1, updated_at=now() WHERE id=$2`,
        [note, line.id]
      );
      vanished++;
    }

    // Fix round 1 / B5 — persist bid_estimates/bids.amount from the exact
    // lines sync just wrote, in the same transaction.
    const { rows: freshLineRows } = await client.query(
      'SELECT * FROM est_bid_lines WHERE bid_id = $1 ORDER BY sort, created_at', [bidId]
    );
    const freshLines = freshLineRows.map(rowToBidLine);
    const resolved = resolveLines(freshLines, library);
    const factors = resolveFactors(settings.factor_ids, library);
    const recap = priceBid(resolved, toPricingSettings(settings, sqFt), factors);
    await writeBidEstimateSnapshot(client, bidId, recap, freshLines, settings.overhead_pct, settings.profit_pct, comps);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const lines = await getBidLines(bidId);
  return { added, updated, vanished, lines };
}

// ── Save (PUT /:bidId) ───────────────────────────────────────────────────────

export interface SaveResult {
  recap: PricingRecap;
  bidEstimate: Record<string, unknown>;
}

interface LegacyLineItem {
  category: string;
  item: string;
  qty: number;
  unit: string;
  unit_cost: number;
  total: number;
  overridden: boolean;
  confidence: LineConfidence | null;
}

/** Shared by saveBidEstimate() and syncTakeoff() — both need to write the
 *  SAME bid_estimates/bids.amount snapshot from a freshly-computed recap, in
 *  the same transaction as whatever changed est_bid_lines, so the two can
 *  never drift apart (Fix round 1 / B5: sync-takeoff used to leave
 *  bid_estimates/bids.amount stale after changing lines underneath them).
 *  Fix round 1 / B2: refuses (throws NonFiniteTotalError) rather than
 *  writing a non-finite total. */
async function writeBidEstimateSnapshot(
  client: PoolClient,
  bidId: string,
  recap: PricingRecap,
  rows: BidLineRow[],
  overheadPct: number,
  profitPct: number,
  comps: { compCount: number; confidence: string }
): Promise<Record<string, unknown>> {
  assertFiniteRecap(recap);

  // Fix round 1 / S10 — category subtotals and each line's fully-loaded
  // directShare (not material+labor / materialExt+laborExt alone) so the
  // legacy line_items/subtotals Agent 4 and the Review step read actually
  // sum to the real, fully-loaded price shown on screen.
  const subtotals: Record<string, number> = {};
  for (const cat of recap.categories) subtotals[cat.category] = round2(cat.subtotal);

  // Pair each recap line with its ORIGINAL input by index BEFORE filtering out
  // excluded lines — filtering first and then indexing `rows[idx]` against the
  // filtered array misaligns every line after the first excluded one.
  const legacyLineItems: LegacyLineItem[] = recap.lines
    .map((l, idx) => ({ l, original: rows[idx] }))
    .filter(({ l }) => !l.excluded)
    .map(({ l, original }) => ({
      category: l.category,
      // Agent 4's short takeoff item id when this line has one (so
      // composeBidData's SavedConfidenceItem lookup, keyed on that id, hits
      // for a new-engine-saved bid) — a manual line has none, so its
      // description is what's carried here instead.
      item: original?.takeoff_item_id ?? l.description,
      qty: l.qty,
      unit: l.unit,
      unit_cost: l.qty !== 0 ? round2(l.directShare / l.qty) : 0,
      total: round2(l.directShare),
      overridden: original?.material_unit_override != null || original?.labor_hours_override != null,
      confidence: l.confidence,
    }));

  const { rows: beRows } = await client.query(
    `INSERT INTO bid_estimates
       (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total, comp_count, confidence, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       overhead_pct=$2, profit_pct=$3, line_items=$4::jsonb, subtotals=$5::jsonb,
       total_direct=$6, total_overhead=$7, total_profit=$8, grand_total=$9, comp_count=$10, confidence=$11, updated_at=now()
     RETURNING *`,
    [bidId, overheadPct, profitPct, JSON.stringify(legacyLineItems), JSON.stringify(subtotals),
     recap.totals.directCost, recap.totals.overhead, recap.totals.profit, recap.totals.grandTotal,
     comps.compCount, comps.confidence]
  );

  await client.query('UPDATE bids SET amount = $1 WHERE id = $2 AND deleted_at IS NULL', [recap.totals.grandTotal, bidId]);
  return beRows[0];
}

/**
 * Save a bid's complete line set + settings: recomputes the recap server-side
 * and, in the SAME transaction, upserts bid_estimates and updates bids.amount
 * — the two can never drift apart because they're written from the one recap
 * that was just computed, in one transaction.
 *
 * Full replace: every call writes exactly the lines given (existing
 * est_bid_lines rows for the bid are deleted first). sync-takeoff is the
 * operation that preserves rows across a takeoff re-run; a plain save always
 * reflects exactly what the caller sent.
 */
export async function saveBidEstimate(
  bidId: string, lines: ClientLineInput[], settings: ClientSettingsInput
): Promise<SaveResult> {
  const [library, sqFt, comps] = await Promise.all([getLibrary(), getBidSqFt(bidId), computeBidComps(bidId)]);
  const rows = lines.map((l, idx) => ({ ...l, id: l.id ?? '', sort: l.sort ?? idx })) as BidLineRow[];
  const resolved = resolveLines(rows, library);
  const factors = resolveFactors(settings.factor_ids, library);
  const recap = priceBid(resolved, toPricingSettings(settings, sqFt), factors);
  assertFiniteRecap(recap); // fail fast, before opening a transaction

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM est_bid_lines WHERE bid_id = $1', [bidId]);
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i];
      await client.query(
        `INSERT INTO est_bid_lines
           (bid_id, sort, category, description, qty, unit, assembly_id, item_id, takeoff_key, takeoff_item_id,
            material_unit_override, labor_hours_override, confidence, excluded, source, qty_overridden, sync_excluded)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [bidId, l.sort, l.category, l.description, l.qty, l.unit,
         l.assembly_id ?? null, l.item_id ?? null, l.takeoff_key ?? null, l.takeoff_item_id ?? null,
         l.material_unit_override ?? null, l.labor_hours_override ?? null,
         l.confidence ?? null, !!l.excluded, l.source, !!l.qty_overridden,
         // A plain save always reflects exactly what the caller sent — a line
         // the client still marks excluded:true here is a USER exclusion
         // (sync-takeoff is the only writer of sync_excluded:true; a normal
         // save never sets it).
         false]
      );
    }

    await client.query(
      `INSERT INTO est_bid_settings
         (bid_id, labor_rate, factor_ids, material_tax_pct, small_tools_pct, supervision_pct, consumables_pct, overhead_pct, profit_pct, crew_size, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         labor_rate=$2, factor_ids=$3, material_tax_pct=$4, small_tools_pct=$5,
         supervision_pct=$6, consumables_pct=$7, overhead_pct=$8, profit_pct=$9, crew_size=$10, updated_at=now()`,
      [bidId, settings.labor_rate, settings.factor_ids, settings.material_tax_pct, settings.small_tools_pct,
       settings.supervision_pct, settings.consumables_pct, settings.overhead_pct, settings.profit_pct, settings.crew_size]
    );

    const bidEstimate = await writeBidEstimateSnapshot(
      client, bidId, recap, rows, settings.overhead_pct, settings.profit_pct, comps
    );

    await client.query('COMMIT');
    return { recap, bidEstimate };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
