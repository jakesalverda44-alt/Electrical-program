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
import { mapTakeoffLines, fromLegacyTakeoff, LibraryCandidate, SourceConfidence } from './mapper';
import { getLibrary, resolveAssemblyCost, Library, LibraryItem } from './library';

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
  source: 'takeoff' | 'manual';
  sort?: number;
}

export interface BidLineRow extends ClientLineInput {
  id: string;
  sort: number;
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
    source: r.source as 'takeoff' | 'manual',
    sort: Number(r.sort),
  };
}

export async function getBidSettings(bidId: string): Promise<ClientSettingsInput> {
  const { rows } = await pool.query('SELECT * FROM est_bid_settings WHERE bid_id = $1', [bidId]);
  if (rows.length) {
    const r = rows[0];
    return {
      labor_rate: Number(r.labor_rate),
      factor_ids: (r.factor_ids as string[]) ?? [],
      material_tax_pct: Number(r.material_tax_pct),
      small_tools_pct: Number(r.small_tools_pct),
      supervision_pct: Number(r.supervision_pct),
      consumables_pct: Number(r.consumables_pct),
      overhead_pct: Number(r.overhead_pct),
      profit_pct: Number(r.profit_pct),
      crew_size: Number(r.crew_size),
    };
  }
  const [laborRate, taxPct, toolsPct, supervisionPct, consumablesPct] = await Promise.all([
    getSetting('est_default_labor_rate'),
    getSetting('est_default_material_tax_pct'),
    getSetting('est_default_small_tools_pct'),
    getSetting('est_default_supervision_pct'),
    getSetting('est_default_consumables_pct'),
  ]);
  return {
    labor_rate: Number(laborRate) || 38,
    factor_ids: [],
    material_tax_pct: Number(taxPct) || 7,
    small_tools_pct: Number(toolsPct) || 3,
    supervision_pct: Number(supervisionPct) || 0,
    consumables_pct: Number(consumablesPct) || 2,
    overhead_pct: 10,
    profit_pct: 15,
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

    if (line.item_id) {
      const item = itemsById.get(line.item_id);
      if (item) {
        materialUnitCost = item.material_cost;
        laborHoursUnit = item.labor_hours;
        unverifiedPrice = item.material_price_date == null;
        matched = true;
      }
    } else if (line.assembly_id) {
      const asm = assembliesById.get(line.assembly_id);
      if (asm) {
        const resolved = resolveAssemblyCost(asm, itemsById);
        materialUnitCost = resolved.materialCost;
        laborHoursUnit = resolved.laborHours;
        unverifiedPrice = resolved.unverified;
        matched = true;
      }
    }

    // A takeoff-sourced line that never resolved to a library row still needs
    // resolving in the UI — a manual line (typed material $/hours, no
    // assembly/item) is intentionally unmatched and isn't a warning.
    const unresolved = line.source === 'takeoff' && !matched;

    return {
      id: line.id,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      materialUnitCost,
      laborHoursUnit,
      materialUnitOverride: line.material_unit_override,
      laborHoursOverride: line.labor_hours_override,
      confidence: line.confidence,
      excluded: !!line.excluded,
      matched,
      unresolved,
      unverifiedPrice,
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

  const lines: BidLineRow[] = mapped.map((m, idx) => ({
    id: `proposed-${idx}`,
    category: m.category,
    description: m.description,
    qty: m.qty,
    unit: m.unit as EstUnit,
    assembly_id: m.matchedKind === 'assembly' ? m.matchedId : null,
    item_id: m.matchedKind === 'item' ? m.matchedId : null,
    takeoff_key: takeoffKey(rawRows[idx]),
    takeoff_item_id: rawRows[idx].item ?? null,
    material_unit_override: null,
    labor_hours_override: null,
    confidence: m.sourceConfidence,
    excluded: false,
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
 *  Manual lines (source='manual') are never touched. */
export async function syncTakeoff(bidId: string): Promise<SyncResult> {
  const [rawRows, existing, library] = await Promise.all([
    getCurrentTakeoffRows(bidId), getBidLines(bidId), getLibrary(),
  ]);
  const candidates = toLibraryCandidates(library);
  const normalized = fromLegacyTakeoff(rawRows);
  const mapped = mapTakeoffLines(normalized, candidates);

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
      const key = takeoffKey(row);
      freshKeys.add(key);
      const m = mapped[i];
      const existingLine = existingByKey.get(key);

      if (existingLine) {
        // Keep the existing match/overrides/exclusion; refresh the takeoff-owned facts
        // (takeoff_item_id included — it's a takeoff fact, not an estimator edit).
        await client.query(
          `UPDATE est_bid_lines SET qty=$1, unit=$2, description=$3, confidence=$4, takeoff_item_id=$5, updated_at=now() WHERE id=$6`,
          [m.qty, m.unit, m.description, m.sourceConfidence ?? null, row.item ?? null, existingLine.id]
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
        `UPDATE est_bid_lines SET excluded=true, description=$1, updated_at=now() WHERE id=$2`,
        [note, line.id]
      );
      vanished++;
    }

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

  const subtotals: Record<string, number> = {};
  for (const cat of recap.categories) subtotals[cat.category] = round2(cat.material + cat.labor);

  // Pair each recap line with its ORIGINAL input by index BEFORE filtering out
  // excluded lines — filtering first and then indexing `lines[idx]` against the
  // filtered array misaligns every line after the first excluded one.
  const legacyLineItems: LegacyLineItem[] = recap.lines
    .map((l, idx) => ({ l, original: lines[idx] }))
    .filter(({ l }) => !l.excluded)
    .map(({ l, original }) => {
      const total = round2(l.materialExt + l.laborExt);
      return {
        category: l.category,
        // Agent 4's short takeoff item id when this line has one (so
        // composeBidData's SavedConfidenceItem lookup, keyed on that id, hits
        // for a new-engine-saved bid) — a manual line has none, so its
        // description is what's carried here instead.
        item: original?.takeoff_item_id ?? l.description,
        qty: l.qty,
        unit: l.unit,
        unit_cost: l.qty !== 0 ? round2(total / l.qty) : 0,
        total,
        overridden: original?.material_unit_override != null || original?.labor_hours_override != null,
        confidence: l.confidence,
      };
    });

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM est_bid_lines WHERE bid_id = $1', [bidId]);
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i];
      await client.query(
        `INSERT INTO est_bid_lines
           (bid_id, sort, category, description, qty, unit, assembly_id, item_id, takeoff_key, takeoff_item_id,
            material_unit_override, labor_hours_override, confidence, excluded, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [bidId, l.sort, l.category, l.description, l.qty, l.unit,
         l.assembly_id ?? null, l.item_id ?? null, l.takeoff_key ?? null, l.takeoff_item_id ?? null,
         l.material_unit_override ?? null, l.labor_hours_override ?? null,
         l.confidence ?? null, !!l.excluded, l.source]
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

    const { rows: beRows } = await client.query(
      `INSERT INTO bid_estimates
         (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total, comp_count, confidence, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         overhead_pct=$2, profit_pct=$3, line_items=$4::jsonb, subtotals=$5::jsonb,
         total_direct=$6, total_overhead=$7, total_profit=$8, grand_total=$9, comp_count=$10, confidence=$11, updated_at=now()
       RETURNING *`,
      [bidId, settings.overhead_pct, settings.profit_pct, JSON.stringify(legacyLineItems), JSON.stringify(subtotals),
       recap.totals.directCost, recap.totals.overhead, recap.totals.profit, recap.totals.grandTotal,
       comps.compCount, comps.confidence]
    );

    await client.query('UPDATE bids SET amount = $1 WHERE id = $2 AND deleted_at IS NULL', [recap.totals.grandTotal, bidId]);

    await client.query('COMMIT');
    return { recap, bidEstimate: beRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
