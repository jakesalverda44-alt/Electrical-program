// Estimating labor engine — Task 5: load/save a bid's priced lines. This is
// the seam between the pure engine (pricing.ts, mapper.ts) and the DB — it
// resolves est_bid_lines against the library, prices them, and on save
// upserts bid_estimates + bids.amount in the same transaction so the two
// never drift apart. Existing readers of bid_estimates keep working: this
// module WRITES that table, nothing downstream changes.
import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { computeBidComps } from '../utils/bidComps';
import { priceBid, PricingLineInput, PricingSettings, PricingFactorInput, PricingRecap, EstUnit, LineConfidence } from './pricing';
import { mapTakeoffLines, fromLegacyTakeoff, LibraryCandidate, normalizeUnit, unitFamily, isUnitCompatible, MapConfidence } from './mapper';
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
  /** Phase B, Task 1 — stable across every save/sync (est_bid_lines rows are
   *  replaced wholesale on every save; `id` is not stable, this is). The
   *  client round-trips whatever it last received on GET/PUT/sync-takeoff;
   *  absent (a brand-new line) mints a fresh one server-side. Markups
   *  (est_markups.line_key) point at this, not at `id`. */
  line_key?: string;
  /** Fix round 2 / R2-S1 — the RAW, unvalidated line_key exactly as the
   *  client sent it (routes/estimating.ts's validateLines strips
   *  `line_key` itself down to undefined for anything that isn't a
   *  well-formed UUID — e.g. a "proposed-N" placeholder — since that's
   *  the only value ever trusted for the actual INSERT). This field
   *  keeps the ORIGINAL string around anyway, for ONE purpose only:
   *  letting saveBidEstimate build remappedLineKeys (below) so the
   *  client can find out what real UUID a "proposed-N" line actually
   *  got. Never used for anything else — never trusted, never written
   *  to the DB. */
  line_key_as_sent?: string;
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
  /** Fix round 2 / B2 — true when this line's CURRENT excluded=true was set
   *  BY sync-takeoff because the line vanished from the takeoff, as opposed
   *  to the estimator deliberately excluding it. A line that reappears in a
   *  later takeoff un-excludes only when this is true; a user-excluded line
   *  (this false) stays excluded through a sync. The CLIENT round-trips this
   *  (received on the last GET/sync-takeoff response, sent back unchanged on
   *  save for any line it didn't touch) — a plain save is no longer the one
   *  place that always resets it to false, which used to defeat sync-
   *  takeoff's own un-exclude-on-reappearance logic on the very next sync.
   *  The frontend clears it the moment the estimator toggles the exclusion
   *  checkbox in either direction; saveBidEstimate() also enforces the
   *  invariant server-side (can never be true while excluded is false). */
  sync_excluded?: boolean;
  /** Fix round 2 / SF1 — how confident the mapper was about this line's
   *  match (null for a manual line). Round-tripped by the client the same
   *  way as sync_excluded/qty_overridden, so the UI can badge a fuzzy match
   *  "check match" after a reload, not just live right after a sync. */
  match_confidence?: MapConfidence | null;
  /** Fix round 2 / SF4 — whether this line's current item_id/assembly_id
   *  came from the mapper ('auto') or an estimator's manual resolve
   *  ('manual'). Sync-takeoff re-runs the mapper on an 'auto' line whose
   *  underlying takeoff description changed; a 'manual' pick is left alone
   *  (flagged instead — see synced_description). */
  match_source?: 'auto' | 'manual' | null;
  /** Fix round 2 / SF4 — the raw takeoff description this line was last
   *  synced against. Lets a later sync tell "the takeoff line itself
   *  changed" apart from "the estimator renamed this line's description". */
  synced_description?: string | null;
  /** Phase B, Task 1 — why this line's CURRENT qty is what it is: the takeoff
   *  (default), an estimator's hand-typed qty ('manual'), or a confirmed
   *  Plan Viewer markup rollup ('markup', set only by apply-markups —
   *  Task 3). Round-tripped by the client the same way as qty_overridden;
   *  never inferred server-side from a value diff. */
  qty_source?: 'takeoff' | 'manual' | 'markup';
  /** Re-run reset — set (to the new run's id) on a takeoff line the
   *  estimator had touched when the analysis was re-run: "From previous run
   *  — re-check". The next sync-takeoff re-binds it to the new takeoff; the
   *  client sends null once the estimator has checked it. */
  recheck_run_id?: string | null;
  source: 'takeoff' | 'manual';
  sort?: number;
}

export interface BidLineRow extends ClientLineInput {
  id: string;
  line_key: string;
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
  /** Fix round 1 / N3 — multiplies the MULTI-STORY labor factor's pct. */
  floors_above_2: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phase B, Task 1 — the value saveBidEstimate() writes for a line's
 *  line_key: the client's own value when it's a real UUID (an existing line
 *  round-tripping what it was given), a fresh one otherwise (a brand-new
 *  line, or the placeholder getProposedLinesFromTakeoff() hands out before
 *  anything is ever saved). Computed in JS rather than leaned on the
 *  column's DEFAULT so the INSERT below can always supply an explicit,
 *  non-null value — passing SQL NULL here would trip the NOT NULL
 *  constraint instead of falling through to the default. */
function resolveLineKey(clientValue: string | undefined | null): string {
  return clientValue && UUID_RE.test(clientValue) ? clientValue : randomUUID();
}

/** Phase B, Task 1 — same backfill rule migration 108 applied once to
 *  existing rows, applied per-request for any line whose client didn't send
 *  qty_source explicitly (true of every caller until frontend Task 9 wires
 *  the field through): a hand-typed qty is 'manual', anything else is
 *  'takeoff'. A caller that DOES send qty_source (apply-markups, Task 3) is
 *  always honored as-is. */
function resolveQtySource(l: Pick<ClientLineInput, 'qty_source' | 'qty_overridden'>): 'takeoff' | 'manual' | 'markup' {
  return l.qty_source ?? (l.qty_overridden ? 'manual' : 'takeoff');
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
    line_key: r.line_key as string,
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
    match_confidence: (r.match_confidence as MapConfidence | null) ?? null,
    match_source: (r.match_source as 'auto' | 'manual' | null) ?? null,
    synced_description: (r.synced_description as string | null) ?? null,
    qty_source: (r.qty_source as 'takeoff' | 'manual' | 'markup' | undefined) ?? 'takeoff',
    recheck_run_id: (r.recheck_run_id as string | null) ?? null,
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
// Fix round 2 / SF7 (previously S6) — bid_estimates now wins over
// bid_workspaces regardless of recency, not the other way around.
// bid_estimates is written only by a deliberate Save (the legacy "Save
// Estimate" flow while it existed, and now the new engine's own save/sync);
// bid_workspaces.overhead_pct/profit_pct are just a continuous autosave
// mirror of whatever ws.overheadPct/ws.profitPct last held in a session,
// which — since the fix round 2 / B3 cleanup removed the only UI that ever
// edited those ws fields — is now nothing but stale hydration echoing an
// old bid_estimates value back at itself. Falling back to it (then to the
// hardcoded 10/15) only matters for a bid that predates the new engine.
async function inheritedOverheadProfit(bidId: string): Promise<{ overhead_pct: number; profit_pct: number }> {
  const [{ rows: wsRows }, { rows: beRows }] = await Promise.all([
    pool.query('SELECT overhead_pct, profit_pct FROM bid_workspaces WHERE bid_id = $1', [bidId]),
    pool.query('SELECT overhead_pct, profit_pct FROM bid_estimates WHERE bid_id = $1', [bidId]),
  ]);
  const ws = wsRows[0];
  const be = beRows[0];
  const overhead_pct = be?.overhead_pct != null ? numberOr(be.overhead_pct, 10)
    : ws?.overhead_pct != null ? numberOr(ws.overhead_pct, 10)
    : 10;
  const profit_pct = be?.profit_pct != null ? numberOr(be.profit_pct, 15)
    : ws?.profit_pct != null ? numberOr(ws.profit_pct, 15)
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
      floors_above_2: numberOr(r.floors_above_2, 0),
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
    floors_above_2: 0,
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
      matchConfidence: line.match_confidence ?? null,
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
    floorsAbove2: settings.floors_above_2,
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

/** Fix round 2 / SF3 — computeRecapForBid() always recomputes LIVE against
 *  the current library/settings, which can legitimately differ from what
 *  was actually saved to bid_estimates.grand_total (a library edit or a
 *  calibration apply changes every recap that touches the items it
 *  changed, for every bid, without anyone re-saving those bids). Callers
 *  that need to detect that drift (S3's "stale estimate" warning) compare
 *  this against the live recap's totals.grandTotal — null when the bid has
 *  never been saved through the new engine at all. */
export async function getSavedGrandTotal(bidId: string): Promise<number | null> {
  const { rows } = await pool.query('SELECT grand_total FROM bid_estimates WHERE bid_id = $1', [bidId]);
  return rows[0]?.grand_total != null ? Number(rows[0].grand_total) : null;
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
    // Not a real UUID — a proposed mapping was never saved, so it has no
    // real line_key yet. validateLines() (routes/estimating.ts) only ever
    // passes a well-formed UUID through to saveBidEstimate, so if a client
    // ever echoed this placeholder back unchanged on save, the server would
    // simply mint a fresh line_key rather than choke on it.
    line_key: `proposed-${idx}`,
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
    // Fix round 2 / SF1 + SF4 — a proposed mapping is always an 'auto'
    // mapper result (there's no way to have manually resolved a line that
    // was never saved), so match_confidence/match_source are meaningful
    // from the very first GET, not just after a sync.
    match_confidence: m.matchedKind ? m.matchConfidence : null,
    match_source: m.matchedKind ? 'auto' : null,
    synced_description: m.description,
    qty_source: 'takeoff',
    recheck_run_id: null,
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
  /** Re-run reset — carried-over ("re-check") lines bound to a different
   *  takeoff row than the key they had, by category + description. */
  rebound: number;
  /** Re-run reset — carried-over lines with no match in the new takeoff:
   *  left as they are (still priced, still flagged), never auto-excluded. */
  unbound: number;
  lines: BidLineRow[];
}

function normText(s: string | null | undefined): string {
  return String(s ?? '').replace(VANISHED_PREFIX, '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  const carried: BidLineRow[] = [];
  for (const line of existing) {
    if (line.source !== 'takeoff') continue;
    if (line.recheck_run_id) carried.push(line);
    else if (line.takeoff_key) existingByKey.set(line.takeoff_key, line);
  }

  // Re-run reset — a line the estimator had touched survives a re-run with
  // recheck_run_id set, and re-binds here. The new run can renumber item
  // ids, so a key alone isn't trusted when a row with the line's own
  // description exists: same key + same description, then same category +
  // same description, then same key. A carried line with no match at all is
  // left alone (still priced and flagged) rather than excluded.
  const rowDescs = (i: number) => [normText(mapped[i].description), normText(rawRows[i].spec), normText(rawRows[i].item)].filter(Boolean);
  const lineDescs = (l: BidLineRow) => [normText(l.synced_description), normText(l.description)].filter(Boolean);
  const descMatch = (l: BidLineRow, i: number) => rowDescs(i).some(d => lineDescs(l).includes(d));
  const catMatch = (l: BidLineRow, i: number) => normText(rawRows[i].category) === normText(l.category);
  let pending = [...carried];
  let rebound = 0;
  const bindPass = (pred: (l: BidLineRow, i: number) => boolean) => {
    pending = pending.filter(line => {
      const i = keys.findIndex((k, idx) => !existingByKey.has(k) && pred(line, idx));
      if (i < 0) return true;
      existingByKey.set(keys[i], line);
      if (keys[i] !== line.takeoff_key) rebound++;
      return false;
    });
  };
  bindPass((l, i) => keys[i] === l.takeoff_key && descMatch(l, i));
  bindPass((l, i) => catMatch(l, i) && descMatch(l, i));
  bindPass((l, i) => keys[i] === l.takeoff_key);
  const unbound = pending.length;

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
        // Phase B — this is also how a markup-confirmed qty (qty_source=
        // 'markup', which apply-markups always sets alongside
        // qty_overridden=true) survives a re-sync: the plan's "sync-takeoff
        // must treat qty_source='markup' like an estimator override" is
        // exactly what qty_overridden already does here, with no extra
        // branching needed. When a line's qty DOES refresh from the takeoff
        // (qty_overridden false), its qty_source resets to 'takeoff' — it's
        // no longer anything but a fresh takeoff value.
        const nextQty = existingLine.qty_overridden ? existingLine.qty : m.qty;
        const nextQtySource = existingLine.qty_overridden ? (existingLine.qty_source ?? 'manual') : 'takeoff';
        // Reappearance un-excludes only a line SYNC itself excluded earlier;
        // a line the estimator excluded on purpose stays excluded.
        const wasSyncExcluded = !!existingLine.excluded && !!existingLine.sync_excluded;
        const nextExcluded = wasSyncExcluded ? false : !!existingLine.excluded;
        const nextSyncExcluded = wasSyncExcluded ? false : !!existingLine.sync_excluded;

        // Fix round 2 / SF4 — an 'auto' (mapper-picked) match re-runs the
        // mapper whenever the underlying takeoff description at this same
        // key has changed since the last sync (e.g. "5.1" respecs from 3/4"
        // EMT to 1" EMT) — round 1 kept the OLD match forever regardless. A
        // 'manual' pick is never touched by sync no matter what the takeoff
        // now says; a line with no recorded match_source yet (any line
        // saved before this feature) defaults to 'auto' — safer than
        // assuming a manual resolution we have no record of.
        const isAuto = existingLine.match_source !== 'manual';
        const descriptionChanged = existingLine.synced_description != null
          && existingLine.synced_description !== m.description;
        const rematch = isAuto && descriptionChanged;
        const nextAssemblyId = rematch ? (m.matchedKind === 'assembly' ? m.matchedId : null) : (existingLine.assembly_id ?? null);
        const nextItemId = rematch ? (m.matchedKind === 'item' ? m.matchedId : null) : (existingLine.item_id ?? null);
        const nextMatchConfidence = rematch ? m.matchConfidence : (existingLine.match_confidence ?? null);
        // A manual line's synced_description is deliberately NOT advanced —
        // it stays the description the estimator's pick was actually made
        // against, so a later read can still tell "the takeoff changed
        // since this manual pick" apart from "nothing changed".
        const nextSyncedDescription = isAuto ? m.description : existingLine.synced_description;

        // Keep the existing overrides; refresh the takeoff-owned facts
        // (takeoff_item_id included — it's a takeoff fact, not an estimator
        // edit). `m.description` is always the FRESH mapped text, so a line
        // that reappears after being vanished-prefixed is naturally restored
        // to its real description here, not the old "[No longer in
        // takeoff]"-prefixed one.
        // takeoff_key: a carried-over line may have re-bound to a new key.
        await client.query(
          `UPDATE est_bid_lines
             SET qty=$1, unit=$2, description=$3, confidence=$4, takeoff_item_id=$5,
                 excluded=$6, sync_excluded=$7, assembly_id=$8, item_id=$9,
                 match_confidence=$10, synced_description=$11, qty_source=$12, takeoff_key=$14, updated_at=now()
           WHERE id=$13`,
          [nextQty, m.unit, m.description, m.sourceConfidence ?? null, row.item ?? null,
           nextExcluded, nextSyncExcluded, nextAssemblyId, nextItemId,
           nextMatchConfidence, nextSyncedDescription, nextQtySource, existingLine.id, key]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, assembly_id, item_id, takeoff_key, takeoff_item_id, confidence, source, excluded, match_confidence, match_source, synced_description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'takeoff',false,$12,$13,$14)`,
          [bidId, i, row.category, m.description, m.qty, m.unit,
           m.matchedKind === 'assembly' ? m.matchedId : null,
           m.matchedKind === 'item' ? m.matchedId : null,
           key, row.item ?? null, m.sourceConfidence ?? null,
           m.matchedKind ? m.matchConfidence : null, m.matchedKind ? 'auto' : null, m.description]
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
  return { added, updated, vanished, rebound, unbound, lines };
}

// ── Save (PUT /:bidId) ───────────────────────────────────────────────────────

export interface SaveResult {
  recap: PricingRecap;
  bidEstimate: Record<string, unknown>;
  /** Phase B, Task 1 — the freshly-saved lines, each carrying the line_key
   *  that survived (or was newly minted for) this save. The client needs
   *  this to know what a brand-new line's line_key ended up being, so a
   *  markup created against it right after saving has something stable to
   *  point at without a second round-trip. */
  lines: BidLineRow[];
  /** Fix round 2 / R2-S1 — every line whose CLIENT-sent line_key was NOT
   *  a real UUID (a "proposed-N" placeholder — see
   *  getProposedLinesFromTakeoff's own line_key, or any other malformed
   *  value resolveLineKey below would have minted a fresh UUID for)
   *  mapped to the real UUID this save actually gave it. The one-click
   *  "Save the estimate" flow (PlansWorkspace.tsx's own
   *  onSaveProposedMapping) uses this to remap the active line and any
   *  pending/quarantined markers still pointing at the placeholder —
   *  without it, the first-use flow (pick a line -> Save -> mark it up)
   *  silently sent a marker at a line_key ("proposed-0") the server
   *  would reject per-item (S5), and nothing on screen remapped it to
   *  the line's own new real key. */
  remappedLineKeys: Record<string, string>;
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
  /** Phase B, Task 3 — carried so composeBidData.ts can tell a Plan Viewer-
   *  confirmed qty apart from an AI/manual one and route the TAKEOFF
   *  OUTPUTS (takeoff xlsx / pre-bid package / the embedded proposal
   *  takeoff table) through the confirmed value instead of Agent 4's own
   *  echoed qty — see composeBidData.ts's SavedConfidenceItem. */
  qty_source: 'takeoff' | 'manual' | 'markup';
  /** Fix round 1 / B5 — the ORIGINATING takeoff row's own key (dedupe
   *  Taken from `dedupeTakeoffKeys()`: `${category}||${item}` for a first
   *  occurrence, `::1`/`::2`/... for later ones sharing the same
   *  category+item). Lets composeBidData.ts match a markup-confirmed qty
   *  to the SPECIFIC Agent 4 takeoff row it belongs to, by occurrence
   *  order, instead of overwriting every row that happens to share the
   *  same category+item text. null for a manual line (no originating
   *  takeoff row). */
  takeoff_key: string | null;
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
      qty_source: original?.qty_source ?? 'takeoff',
      takeoff_key: original?.takeoff_key ?? null,
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

  let bidEstimate: Record<string, unknown>;
  // Fix round 2 / R2-S1 — captured at the exact point each line's real
  // line_key is minted (inside the loop below), rather than inferred
  // later from array position (which a reorder, insert, or delete
  // elsewhere in this same save could silently break). Only ever
  // populated for a line whose CLIENT-sent key wasn't already a real
  // UUID. Declared out here (not inside the try block) so it's still in
  // scope for the return statement after the transaction commits.
  const remappedLineKeys: Record<string, string> = {};
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM est_bid_lines WHERE bid_id = $1', [bidId]);
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i];
      const resolvedLineKey = resolveLineKey(l.line_key);
      if (l.line_key_as_sent && l.line_key_as_sent !== resolvedLineKey) remappedLineKeys[l.line_key_as_sent] = resolvedLineKey;
      await client.query(
        `INSERT INTO est_bid_lines
           (bid_id, sort, category, description, qty, unit, assembly_id, item_id, takeoff_key, takeoff_item_id,
            material_unit_override, labor_hours_override, confidence, excluded, source, qty_overridden, sync_excluded,
            match_confidence, match_source, synced_description, line_key, qty_source, recheck_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [bidId, l.sort, l.category, l.description, l.qty, l.unit,
         l.assembly_id ?? null, l.item_id ?? null, l.takeoff_key ?? null, l.takeoff_item_id ?? null,
         l.material_unit_override ?? null, l.labor_hours_override ?? null,
         l.confidence ?? null, !!l.excluded, l.source, !!l.qty_overridden,
         // Fix round 2 / B2 — a save round-trips whatever sync_excluded the
         // client sent (it received it on the last GET/sync-takeoff and
         // carries it forward on every line it didn't touch), instead of
         // always writing false. The one invariant enforced here rather than
         // trusted from the client: sync_excluded can never be true on a
         // line that isn't excluded at all — the frontend already clears it
         // the moment the estimator toggles the exclusion checkbox (either
         // direction), but this guarantees it even if a client build
         // forgets to. Round 1's bug was hardcoding this to false
         // unconditionally, which defeated sync-takeoff's own un-exclude-on-
         // reappearance logic on the very next sync.
         !!l.excluded && !!l.sync_excluded,
         // Fix round 2 / SF1 + SF4 — round-tripped the same way as
         // sync_excluded/qty_overridden: the client received these on the
         // last GET/sync-takeoff and carries them forward on save.
         l.match_confidence ?? null, l.match_source ?? null, l.synced_description ?? null,
         // Phase B, Task 1 — line_key survives THIS save/reinsert cycle by
         // being explicitly re-supplied (see resolveLineKey's comment);
         // qty_source is the client's own value, or the same
         // qty_overridden-implies-'manual' backfill migration 108 applied.
         resolvedLineKey, resolveQtySource(l),
         // Re-run reset — round-tripped; a manual line never carries it.
         l.source === 'takeoff' ? (l.recheck_run_id ?? null) : null]
      );
    }

    await client.query(
      `INSERT INTO est_bid_settings
         (bid_id, labor_rate, factor_ids, material_tax_pct, small_tools_pct, supervision_pct, consumables_pct, overhead_pct, profit_pct, crew_size, floors_above_2, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         labor_rate=$2, factor_ids=$3, material_tax_pct=$4, small_tools_pct=$5,
         supervision_pct=$6, consumables_pct=$7, overhead_pct=$8, profit_pct=$9, crew_size=$10, floors_above_2=$11, updated_at=now()`,
      [bidId, settings.labor_rate, settings.factor_ids, settings.material_tax_pct, settings.small_tools_pct,
       settings.supervision_pct, settings.consumables_pct, settings.overhead_pct, settings.profit_pct, settings.crew_size,
       settings.floors_above_2]
    );

    bidEstimate = await writeBidEstimateSnapshot(
      client, bidId, recap, rows, settings.overhead_pct, settings.profit_pct, comps
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Phase B, Task 1 — read back the persisted rows (same pattern as
  // syncTakeoff) so the caller gets each line's actual line_key, not just
  // what it sent (a brand-new line's was minted server-side).
  const savedLines = await getBidLines(bidId);
  return { recap, bidEstimate, lines: savedLines, remappedLineKeys };
}
