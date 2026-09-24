// Estimating Phase B, Task 3 — markups CRUD (batch, idempotent), per-line
// rollup, and "Apply marked qty" (confirmed markups -> est_bid_lines.qty,
// through the existing saveBidEstimate transaction).
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { MarkupKind, MarkupStatus, MarkupPoint, rollupLines, RollupLineInput, RollupMarkupInput, LineRollup } from './markupMath';
import { getBidLines, getBidSettings, getProposedLinesFromTakeoff, saveBidEstimate, ClientLineInput, BidLineRow, SaveResult } from './bidEstimate';
import { EstUnit } from './pricing';

export interface MarkupRow {
  id: string;
  bidId: string;
  documentId: string;
  pageIndex: number;
  lineKey: string | null;
  kind: MarkupKind;
  points: MarkupPoint[];
  drops: number;
  dropFt: number | null;
  slackPct: number | null;
  status: MarkupStatus;
  label: string | null;
  createdBy: string | null;
  /** Takeoff accuracy Task 6 — 'ai_count' for a marker the counting stage
   *  suggested; null otherwise. Server-set only (never from a client batch). */
  source: 'ai_count' | 'gap_fill' | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function rowToMarkup(r: Record<string, unknown>): MarkupRow {
  return {
    id: r.id as string,
    bidId: r.bid_id as string,
    documentId: r.document_id as string,
    pageIndex: Number(r.page_index),
    lineKey: (r.line_key as string | null) ?? null,
    kind: r.kind as MarkupKind,
    points: (r.points as MarkupPoint[]) ?? [],
    drops: Number(r.drops ?? 0),
    dropFt: r.drop_ft != null ? Number(r.drop_ft) : null,
    slackPct: r.slack_pct != null ? Number(r.slack_pct) : null,
    status: r.status as MarkupStatus,
    label: (r.label as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    source: (r.source as 'ai_count' | 'gap_fill' | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    deletedAt: (r.deleted_at as string | null) ?? null,
  };
}

/** Fix round 2 / R2-S3 — the route's per-item line_key-belongs-to-this-bid
 *  check needs to know each update's CURRENT stored line_key, to tell
 *  "unchanged" (the marker already had this now-orphaned line_key before
 *  its line was deleted — allow the rest of the update through) from
 *  "changed to something invalid" (reject). Scoped to just the ids the
 *  batch actually touches, and to this bid — an id belonging to a
 *  different bid, or a soft-deleted marker, simply won't appear in the
 *  returned map, which the caller treats the same as "no prior value",
 *  i.e. any non-null line_key on that update is a change. */
export async function getMarkupLineKeysByIds(bidId: string, ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT id, line_key FROM est_markups WHERE bid_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [bidId, ids]
  );
  for (const r of rows) map.set(r.id as string, (r.line_key as string | null) ?? null);
  return map;
}

export async function getMarkups(bidId: string, opts: { documentId?: string; pageIndex?: number } = {}): Promise<MarkupRow[]> {
  const conds = ['bid_id = $1', 'deleted_at IS NULL'];
  const params: unknown[] = [bidId];
  if (opts.documentId) { params.push(opts.documentId); conds.push(`document_id = $${params.length}`); }
  if (opts.pageIndex != null) { params.push(opts.pageIndex); conds.push(`page_index = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM est_markups WHERE ${conds.join(' AND ')} ORDER BY created_at`,
    params
  );
  return rows.map(rowToMarkup);
}

// ── Batch create/update/delete ──────────────────────────────────────────────

export interface MarkupCreateInput {
  id: string; // client-generated uuid — idempotent (see batchMarkups below)
  documentId: string;
  pageIndex: number;
  lineKey?: string | null;
  kind: MarkupKind;
  points: MarkupPoint[];
  drops?: number;
  dropFt?: number | null;
  slackPct?: number | null;
  status?: MarkupStatus;
  label?: string | null;
}

export interface MarkupUpdateInput {
  id: string;
  lineKey?: string | null;
  points?: MarkupPoint[];
  drops?: number;
  dropFt?: number | null;
  slackPct?: number | null;
  status?: MarkupStatus;
  label?: string | null;
}

export interface MarkupBatchRequest {
  creates: MarkupCreateInput[];
  updates: MarkupUpdateInput[];
  deletes: string[];
}

export interface MarkupBatchResult {
  created: MarkupRow[];
  updated: MarkupRow[];
  deleted: string[];
  /** ids the batch touched but had no effect for (an update/delete for an id
   *  that doesn't exist under this bid, or that belongs to a different
   *  bid) — surfaced rather than silently dropped so the client's autosave
   *  can reconcile instead of assuming success. */
  skipped: { id: string; reason: string }[];
}

async function insertMarkup(client: PoolClient, bidId: string, userId: string | null, input: MarkupCreateInput): Promise<MarkupRow | null> {
  // Fix round 1 / B3(a) — the WHERE clause used to also require
  // `deleted_at IS NULL`, so re-upserting the id of a markup that was
  // already SOFT-deleted (the normal outcome of a delete-then-undo, or a
  // redo of an undone create) never matched, and ON CONFLICT DO UPDATE's
  // failed-WHERE-clause behavior is to act like DO NOTHING — 0 rows
  // returned, RETURNING empty, the caller treating it as "skipped: id
  // already belongs to a different bid" even though it belongs to THIS
  // bid and was simply deleted. Delete 30 markers, undo, and the client
  // showed them reappearing (autosave said "Saved") while the server kept
  // them deleted forever.
  //
  // Fix: the WHERE clause now checks only bid_id — an id that exists
  // under THIS bid, deleted or not, is always revivable by re-upserting
  // it with the new values (`deleted_at = NULL` is now in the SET list
  // too). Only an id that belongs to a genuinely DIFFERENT bid is still
  // skipped (the WHERE clause is exactly what keeps a create from ever
  // overwriting another bid's row — see batchMarkups's own comment).
  const { rows } = await client.query(
    `INSERT INTO est_markups (id, bid_id, document_id, page_index, line_key, kind, points, drops, drop_ft, slack_pct, status, label, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,now())
     ON CONFLICT (id) DO UPDATE SET
       document_id = EXCLUDED.document_id, page_index = EXCLUDED.page_index, line_key = EXCLUDED.line_key,
       kind = EXCLUDED.kind, points = EXCLUDED.points, drops = EXCLUDED.drops, drop_ft = EXCLUDED.drop_ft,
       slack_pct = EXCLUDED.slack_pct, status = EXCLUDED.status, label = EXCLUDED.label,
       deleted_at = NULL, updated_at = now()
     WHERE est_markups.bid_id = $2
     RETURNING *`,
    [input.id, bidId, input.documentId, input.pageIndex, input.lineKey ?? null, input.kind,
     JSON.stringify(input.points), input.drops ?? 0, input.dropFt ?? null, input.slackPct ?? null,
     input.status ?? 'confirmed', input.label ?? null, userId]
  );
  return rows[0] ? rowToMarkup(rows[0]) : null;
}

async function updateMarkup(client: PoolClient, bidId: string, input: MarkupUpdateInput): Promise<MarkupRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  function set(col: string, value: unknown) {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  if (input.lineKey !== undefined) set('line_key', input.lineKey);
  if (input.points !== undefined) set('points', JSON.stringify(input.points));
  if (input.drops !== undefined) set('drops', input.drops);
  if (input.dropFt !== undefined) set('drop_ft', input.dropFt);
  if (input.slackPct !== undefined) set('slack_pct', input.slackPct);
  if (input.status !== undefined) set('status', input.status);
  if (input.label !== undefined) set('label', input.label);
  if (sets.length === 0) {
    const { rows } = await client.query('SELECT * FROM est_markups WHERE id=$1 AND bid_id=$2 AND deleted_at IS NULL', [input.id, bidId]);
    return rows[0] ? rowToMarkup(rows[0]) : null;
  }
  sets.push('updated_at = now()');
  params.push(input.id, bidId);
  const { rows } = await client.query(
    `UPDATE est_markups SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND bid_id = $${params.length} AND deleted_at IS NULL RETURNING *`,
    params
  );
  return rows[0] ? rowToMarkup(rows[0]) : null;
}

async function softDeleteMarkup(client: PoolClient, bidId: string, id: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE est_markups SET deleted_at = now(), updated_at = now() WHERE id = $1 AND bid_id = $2 AND deleted_at IS NULL`,
    [id, bidId]
  );
  return (rowCount ?? 0) > 0;
}

/** Applies a batch of markup create/update/delete operations in ONE
 *  transaction. Creates are idempotent by the client-generated uuid — the
 *  viewer autosaves in batches and a retried/duplicated create for an id
 *  already persisted (same bid) just re-applies the same values rather than
 *  throwing a duplicate-key error; a create id that collides with a DIFFERENT
 *  bid's markup is silently rejected (the WHERE on the ON CONFLICT DO UPDATE
 *  never matches), never overwriting another bid's row. */
export async function batchMarkups(bidId: string, userId: string | null, req: MarkupBatchRequest): Promise<MarkupBatchResult> {
  const created: MarkupRow[] = [];
  const updated: MarkupRow[] = [];
  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of req.creates) {
      const row = await insertMarkup(client, bidId, userId, c);
      if (row) created.push(row);
      else skipped.push({ id: c.id, reason: 'id already belongs to a different bid' });
    }
    for (const u of req.updates) {
      const row = await updateMarkup(client, bidId, u);
      if (row) updated.push(row);
      else skipped.push({ id: u.id, reason: 'not found for this bid (already deleted, or never created)' });
    }
    for (const id of req.deletes) {
      const ok = await softDeleteMarkup(client, bidId, id);
      if (ok) deleted.push(id);
      else skipped.push({ id, reason: 'not found for this bid (already deleted, or never created)' });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { created, updated, deleted, skipped };
}

// ── Rollup ───────────────────────────────────────────────────────────────

export interface RollupEntry extends LineRollup {
  category: string;
  description: string;
  unit: EstUnit;
  currentQty: number;
  qtySource: string;
  /** The takeoff's own (re-mapped-fresh) qty for this line, when it still
   *  has one — the same value a re-sync would compute. null for a manual
   *  line with no takeoff_key, or when the current takeoff no longer has a
   *  row at this line's key. */
  aiQty: number | string | null;
}

async function buildSheetScaleMap(bidId: string): Promise<Map<string, number | null>> {
  const { rows } = await pool.query(
    `SELECT document_id, page_index, ft_per_pt FROM est_sheets WHERE bid_id = $1`,
    [bidId]
  );
  const map = new Map<string, number | null>();
  for (const r of rows) {
    map.set(`${r.document_id}::${r.page_index}`, r.ft_per_pt != null ? Number(r.ft_per_pt) : null);
  }
  return map;
}

/** GET .../markups/rollup — per line_key: marked qty (Decision 3/Task 3),
 *  sheets contributing, current saved qty, and the takeoff's own current
 *  qty for comparison (so the UI can show Matches/Differs/Not marked). */
export async function getRollup(bidId: string): Promise<RollupEntry[]> {
  const [lines, markups, scaleMap, proposed] = await Promise.all([
    getBidLines(bidId),
    getMarkups(bidId),
    buildSheetScaleMap(bidId),
    // Fresh AI mapping (same computation a re-sync would do) — used only
    // for the informational aiQty comparison, never written anywhere.
    getProposedLinesFromTakeoff(bidId).catch(() => ({ hasTakeoff: false, lines: [] as BidLineRow[] })),
  ]);

  const aiQtyByTakeoffKey = new Map<string, number | string>();
  for (const l of proposed.lines) {
    if (l.takeoff_key) aiQtyByTakeoffKey.set(l.takeoff_key, l.qty);
  }

  const rollupLineInputs: RollupLineInput[] = lines.map(l => ({ lineKey: l.line_key, unit: l.unit }));
  const rollupMarkupInputs: RollupMarkupInput[] = markups.map(m => ({
    id: m.id, documentId: m.documentId, pageIndex: m.pageIndex, lineKey: m.lineKey,
    kind: m.kind, status: m.status, points: m.points,
    drops: m.drops, dropFt: m.dropFt ?? 0, slackPct: m.slackPct ?? 0,
  }));
  const sheetScale = (documentId: string, pageIndex: number) => scaleMap.get(`${documentId}::${pageIndex}`);

  const results = rollupLines(rollupLineInputs, rollupMarkupInputs, sheetScale);
  const resultsByKey = new Map(results.map(r => [r.lineKey, r]));

  return lines.map(l => {
    const r = resultsByKey.get(l.line_key)!;
    return {
      ...r,
      category: l.category,
      description: l.description,
      unit: l.unit,
      currentQty: l.qty,
      qtySource: l.qty_source ?? 'takeoff',
      aiQty: l.takeoff_key ? (aiQtyByTakeoffKey.get(l.takeoff_key) ?? null) : null,
    };
  });
}

// ── Apply marked qty ─────────────────────────────────────────────────────

export interface ApplyMarkupsResult {
  applied: string[];
  skipped: { lineKey: string; reason: string }[];
  save: SaveResult;
}

/** POST .../apply-markups {line_keys}: for each requested line, sets
 *  qty := rollup.markedQty, qty_source='markup', qty_overridden=true,
 *  confidence FIRM, through the SAME saveBidEstimate() transaction every
 *  other save goes through — bid_estimates/bids.amount stay consistent
 *  with est_bid_lines automatically (Decision 4), and the composeBidData
 *  fix (qty_source routing, see bidEstimate.ts's legacyLineItems and
 *  bidstd/composeBidData.ts) picks the confirmed qty up for the takeoff
 *  outputs the very next time they're generated. A line whose rollup has
 *  nothing to apply (markedQty null) is skipped with a reason, never
 *  applied as a silent 0 — Decision 4's "never overwrites anything
 *  silently" applies here as much as it does to a manual edit. */
export async function applyMarkups(bidId: string, lineKeys: string[]): Promise<ApplyMarkupsResult> {
  const [lines, settings, rollup] = await Promise.all([
    getBidLines(bidId), getBidSettings(bidId), getRollup(bidId),
  ]);
  const rollupByKey = new Map(rollup.map(r => [r.lineKey, r]));
  const requested = new Set(lineKeys);

  const applied: string[] = [];
  const skipped: { lineKey: string; reason: string }[] = [];

  const patchedLines: ClientLineInput[] = lines.map(l => {
    if (!requested.has(l.line_key)) return l;
    const r = rollupByKey.get(l.line_key);
    if (!r || r.markedQty == null) {
      skipped.push({ lineKey: l.line_key, reason: 'No confirmed, unit-compatible markups for this line' });
      return l;
    }
    // Hard safety rule: every number written to the DB must be finite and
    // non-negative — rollupLines() can never actually produce anything
    // else given its own inputs are validated the same way, but this is
    // the one place that number reaches a qty column, so it gets its own
    // explicit guard rather than trusting the math transitively.
    if (!Number.isFinite(r.markedQty) || r.markedQty < 0) {
      skipped.push({ lineKey: l.line_key, reason: 'Computed quantity is not a valid non-negative number' });
      return l;
    }
    applied.push(l.line_key);
    return {
      ...l,
      // Fix round 1 / N6 — a linear run's markedQty is a SUM of many
      // segment lengths (each itself point-distance * ft_per_pt), which
      // routinely lands on long floating-point noise (123.45678199...).
      // Applied quantities used to be stored at that raw precision and
      // flowed straight into the GC takeoff as "123.4568 LF". Rounding to
      // 2 decimals here is a no-op for an EA (count) line's markedQty,
      // which is already a whole number — this is safe to apply
      // unconditionally rather than branching on the line's own unit.
      qty: Math.round(r.markedQty * 100) / 100,
      qty_source: 'markup',
      qty_overridden: true,
      confidence: 'FIRM',
    };
  });

  for (const key of requested) {
    if (!lines.some(l => l.line_key === key)) {
      skipped.push({ lineKey: key, reason: 'Line not found on this bid' });
    }
  }

  const save = await saveBidEstimate(bidId, patchedLines, settings);
  return { applied, skipped, save };
}
