// Takeoff accuracy, Task 7 — DB half of the Needs-review list and its gate.
// See ai/reviewItems.ts for the pure rules.
import { pool } from '../db/pool';
import { getBidLines } from './bidEstimate';
import { lineForType } from './aiMarkers';
import {
  reviewStatus, validateResolution, reviewItemIsOpen,
  type ReviewItem, type ResolveInput,
} from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

export interface TakeoffReview {
  status: 'clear' | 'needs_review' | null;
  items: ReviewItem[];
}

export async function getTakeoffReview(bidId: string): Promise<TakeoffReview> {
  const { rows } = await pool.query('SELECT review_status, review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
  return { status: (rows[0]?.review_status as TakeoffReview['status']) ?? null, items: (rows[0]?.review_items as ReviewItem[] | null) ?? [] };
}

export interface GateBlock {
  error: string;
  openItems: Array<Pick<ReviewItem, 'id' | 'kind' | 'title' | 'detail'>>;
}

/** null = not blocked. A takeoff with open review items blocks Agent 4, the
 *  proposal .docx, the GC takeoff .xlsx and the proposal send. A run from
 *  before the counting stage (review_status NULL) is never blocked. */
export async function takeoffGate(bidId: string): Promise<GateBlock | null> {
  const review = await getTakeoffReview(bidId);
  if (review.status !== 'needs_review') return null;
  const open = review.items.filter(reviewItemIsOpen);
  if (!open.length) return null;
  return {
    error: `The takeoff needs review before a proposal can be generated or sent: ${open.length} item${open.length === 1 ? '' : 's'} open (${open.slice(0, 4).map(i => i.title).join('; ')}${open.length > 4 ? '; …' : ''}). Resolve them in the Takeoff step.`,
    openItems: open.map(i => ({ id: i.id, kind: i.kind, title: i.title, detail: i.detail })),
  };
}

/** Confirmed count markers for a type on this bid: markers labeled with the
 *  type tag, or sitting on the one saved line the type maps to. */
export async function countConfirmedMarkersForType(bidId: string, typeKey: string): Promise<number> {
  const { rows } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const target = (rows[0]?.count_result as CountResult | null)?.targets?.find(t => t.key === typeKey);
  const tag = (target?.type ?? typeKey).toUpperCase();
  const lineKey = target ? lineForType(target, await getBidLines(bidId)) : null;
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM est_markups
      WHERE bid_id = $1 AND kind = 'count' AND status = 'confirmed' AND deleted_at IS NULL
        AND (upper(coalesce(label, '')) = $2 OR ($3::uuid IS NOT NULL AND line_key = $3::uuid))`,
    [bidId, tag, lineKey]
  );
  return Number(res.rows[0]?.n ?? 0);
}

export type ResolveOutcome =
  | { ok: true; review: TakeoffReview }
  | { ok: false; status: number; error: string };

async function applyResolution(
  bidId: string,
  itemIds: string[],
  input: ResolveInput | null,
  by: string,
): Promise<ResolveOutcome> {
  // 'markers' needs a count computed outside the row lock.
  const markerCounts = new Map<string, number>();
  if (input?.action === 'markers') {
    for (const id of itemIds) {
      const isTypeItem = id.startsWith('count:') && !id.endsWith(':heads');
      markerCounts.set(id, isTypeItem ? await countConfirmedMarkersForType(bidId, id.slice('count:'.length)) : 0);
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1 FOR UPDATE', [bidId]);
    if (!rows.length) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'No takeoff for this bid.' }; }
    const items = ((rows[0].review_items as ReviewItem[] | null) ?? []).map(i => ({ ...i }));
    for (const id of itemIds) {
      const item = items.find(i => i.id === id);
      if (!item) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: `Review item not found: ${id}` }; }
      if (!input) { delete item.resolution; continue; }
      if (id.endsWith(':heads') && input.action === 'markers') {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'Heads are not marked on the plans — enter the head count.' };
      }
      const check = validateResolution(item, input, markerCounts.get(id) ?? null);
      if (!check.ok) { await client.query('ROLLBACK'); return { ok: false, status: 400, error: check.error }; }
      item.resolution = { ...check.resolution, by, at: new Date().toISOString() };
    }
    const status = reviewStatus(items);
    await client.query('UPDATE takeoff_results SET review_items = $1, review_status = $2 WHERE bid_id = $3', [JSON.stringify(items), status, bidId]);
    await client.query('COMMIT');
    return { ok: true, review: { status, items } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function resolveReviewItems(bidId: string, itemIds: string[], input: ResolveInput, by: string): Promise<ResolveOutcome> {
  return applyResolution(bidId, itemIds, input, by);
}

export function reopenReviewItem(bidId: string, itemId: string): Promise<ResolveOutcome> {
  return applyResolution(bidId, [itemId], null, '');
}
