// Takeoff accuracy, Task 7 — DB half of the Needs-review list and its gate.
// See ai/reviewItems.ts for the pure rules.
import { laborDuplicatePairs, describePair } from './duplicateLines';
import { pool } from '../db/pool';
import { getBidLines } from './bidEstimate';
import { lineForType } from './aiMarkers';
import {
  reviewStatus, validateResolution, reviewItemIsOpen, perItemInput, groupOf,
  type ReviewItem, type ResolveInput,
} from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

export interface TakeoffReview {
  status: 'clear' | 'needs_review' | 'pending' | null;
  items: ReviewItem[];
}

export async function getTakeoffReview(bidId: string): Promise<TakeoffReview> {
  const { rows } = await pool.query('SELECT review_status, review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
  return { status: (rows[0]?.review_status as TakeoffReview['status']) ?? null, items: (rows[0]?.review_items as ReviewItem[] | null) ?? [] };
}

export interface GateBlock {
  error: string;
  openItems: Array<Pick<ReviewItem, 'id' | 'title' | 'detail'> & { kind: ReviewItem['kind'] | 'duplicate' }>;
}

/** null = not blocked. A takeoff with open review items blocks Agent 4, the
 *  proposal .docx, the GC takeoff .xlsx and the proposal send. A run from
 *  before the counting stage (review_status NULL) is never blocked. */
export async function takeoffGate(bidId: string): Promise<GateBlock | null> {
  const review = await getTakeoffReview(bidId);
  // Fix round 1 / B5 — a run in progress (or one that stopped before the
  // counting stage wrote its review) blocks everything, never 'ungated'.
  if (review.status === 'pending') {
    return {
      error: 'The takeoff analysis is running or did not finish — wait for it to complete (or re-run it) before generating or sending a proposal.',
      openItems: [],
    };
  }
  // Next round A7 — a possible double count in Labor & Pricing blocks the
  // proposal the same way it blocks the save.
  const dupBlock = await laborDuplicateGate(bidId);
  if (review.status !== 'needs_review') return dupBlock;
  const open = review.items.filter(reviewItemIsOpen);
  if (!open.length) return dupBlock;
  return {
    error: `The takeoff needs review before a proposal can be generated or sent: ${open.length} item${open.length === 1 ? '' : 's'} open (${open.slice(0, 4).map(i => i.title).join('; ')}${open.length > 4 ? '; …' : ''}). Resolve them in the Takeoff step.`,
    openItems: open.map(i => ({ id: i.id, kind: i.kind, title: i.title, detail: i.detail })),
  };
}

/** Fix round 2 / B5 — a budget-pending vendor quote (Accubid's
 *  status='budget_pending', accubidRecap.ts's blocksSend) used to block
 *  nothing on the server: only the Labor & Pricing UI's own banner knew
 *  about it. null = not blocked. A GC-facing generate/send route calls this
 *  the SAME way it calls takeoffGate — both return the identical GateBlock
 *  shape, and a caller that needs both checks calls each in turn.
 *  Deliberately NEVER called by generate-prebid-package / email-prebid-
 *  chris (the internal pre-bid package to Chris) — that package is scope/
 *  quantities only, composed from the pre-bid draft before pricing exists
 *  at all, and stays allowed regardless of quote status. */
export async function budgetPendingGate(bidId: string): Promise<GateBlock | null> {
  const { rows } = await pool.query(
    `SELECT description FROM est_bid_quotes WHERE bid_id = $1 AND status = 'budget_pending' ORDER BY sort, created_at`,
    [bidId]
  );
  if (!rows.length) return null;
  const names = rows.map(r => (r.description as string) || 'Untitled quote');
  return {
    error: `A vendor quote is still budget-pending (${names.slice(0, 4).join('; ')}${names.length > 4 ? '; …' : ''}) — firm it up in Labor & Pricing before a proposal is generated or sent.`,
    openItems: [],
  };
}

export interface MarkerTally {
  /** Confirmed markers on the sheets the merge takes this type from. */
  counted: number;
  /** Confirmed markers elsewhere — shown, never counted (S15). */
  excluded: Array<{ label: string; count: number }>;
}

/** Confirmed count markers for a type on this bid: markers labeled with the
 *  type tag, or sitting on the one saved line the type maps to — counted only
 *  on the sheets that are eligible for the type (fix round 1 / S15: a lighting
 *  type's markers on the power plan's background don't add to the lighting
 *  plan's). A run from before sheet/document tracking counts every page. */
export async function confirmedMarkersForType(bidId: string, typeKey: string): Promise<MarkerTally> {
  const { rows } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const cr = rows[0]?.count_result as (CountResult & { markers?: { sheetDocuments?: Array<{ sheetKey: string; label: string; documentId: string; pageIndex: number }> } }) | null;
  const target = cr?.targets?.find(t => t.key === typeKey);
  const tag = (target?.type ?? typeKey).toUpperCase();
  const lineKey = target ? lineForType(target, await getBidLines(bidId)) : null;
  const res = await pool.query(
    `SELECT document_id, page_index, count(*)::int AS n FROM est_markups
      WHERE bid_id = $1 AND kind = 'count' AND status = 'confirmed' AND deleted_at IS NULL
        AND (upper(coalesce(label, '')) = $2 OR ($3::uuid IS NOT NULL AND line_key = $3::uuid))
      GROUP BY document_id, page_index`,
    [bidId, tag, lineKey]
  );
  const docs = cr?.markers?.sheetDocuments;
  const type = cr?.types?.find(t => t.key === typeKey);
  if (!docs || !type) {
    return { counted: res.rows.reduce((s, r) => s + Number(r.n), 0), excluded: [] };
  }
  const tally: MarkerTally = { counted: 0, excluded: [] };
  for (const r of res.rows) {
    const sheet = docs.find(d => d.documentId === r.document_id && d.pageIndex === Number(r.page_index));
    const eligible = sheet ? type.sheets.find(x => x.sheetKey === sheet.sheetKey)?.eligible === true : false;
    if (eligible) tally.counted += Number(r.n);
    else tally.excluded.push({ label: sheet ? `${sheet.label} (not a sheet ${type.type} is counted from)` : `page ${Number(r.page_index) + 1} of a plan set that was not counted`, count: Number(r.n) });
  }
  return tally;
}

/** Back-compat: the number that counts. */
export async function countConfirmedMarkersForType(bidId: string, typeKey: string): Promise<number> {
  return (await confirmedMarkersForType(bidId, typeKey)).counted;
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
  const markerCounts = new Map<string, MarkerTally>();
  if (input?.action === 'markers') {
    for (const id of itemIds) {
      const m = /^(?:count|coverage):(.+)$/.exec(id);
      const isTypeItem = !!m && !id.endsWith(':heads');
      markerCounts.set(id, isTypeItem ? await confirmedMarkersForType(bidId, m![1]) : { counted: 0, excluded: [] });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1 FOR UPDATE', [bidId]);
    if (!rows.length) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'No takeoff for this bid.' }; }
    const items = ((rows[0].review_items as ReviewItem[] | null) ?? []).map(i => ({ ...i }));
    // Fix round N9 — a bulk resolution covers ONE cause group (the UI's
    // bulk actions); the one exception is "not on this job" across count
    // items (the multi-select).
    if (input && itemIds.length > 1) {
      const picked = itemIds.map(id => items.find(i => i.id === id)).filter((i): i is ReviewItem => !!i);
      const groups = new Set(picked.map(i => i.group ?? groupOf(i)));
      const nojCounts = input.action === 'not_on_job' && picked.every(i => i.kind === 'count');
      if (groups.size > 1 && !nojCounts) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'A bulk resolution must cover items of one group.' };
      }
    }
    for (const id of itemIds) {
      const item = items.find(i => i.id === id);
      if (!item) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: `Review item not found: ${id}` }; }
      if (!input) { delete item.resolution; continue; }
      if (id.endsWith(':heads') && input.action === 'markers') {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'Heads are not marked on the plans — enter the head count.' };
      }
      const tally = markerCounts.get(id);
      // Next round A7 — a bulk answer resolves to each item's own option.
      const mine = perItemInput(item, input);
      if ('error' in mine) { await client.query('ROLLBACK'); return { ok: false, status: 400, error: mine.error }; }
      const check = validateResolution(item, mine, tally?.counted ?? null);
      if (!check.ok) {
        await client.query('ROLLBACK');
        const excl = tally?.excluded.length ? ` Not counted: ${tally.excluded.map(e => `${e.count} on ${e.label}`).join('; ')}.` : '';
        return { ok: false, status: 400, error: check.error + excl };
      }
      item.resolution = {
        ...check.resolution,
        ...(tally?.excluded.length ? { reason: `Markers not counted: ${tally.excluded.map(e => `${e.count} on ${e.label}`).join('; ')}` } : {}),
        by, at: new Date().toISOString(),
      };
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

/** Next round A7 — the saved Labor & Pricing lines hold an unresolved
 *  possible duplicate (a kept line from the previous run + a fresh takeoff
 *  line for the same item). */
export async function laborDuplicateGate(bidId: string): Promise<GateBlock | null> {
  const pairs = laborDuplicatePairs(await getBidLines(bidId));
  if (!pairs.length) return null;
  return {
    error: `Labor & Pricing has ${pairs.length === 1 ? 'a possible duplicate' : `${pairs.length} possible duplicates`}: ${describePair(pairs[0])}${pairs.length > 1 ? '; …' : ''}. Resolve it in Labor & Pricing (remove one, or keep both with a reason) before generating or sending a proposal.`,
    openItems: pairs.map(p => ({ id: `dup:${p.keptKey}:${p.newKey}`, kind: 'duplicate', title: `Possible duplicate: ${p.keptDescription} / ${p.newDescription}`, detail: describePair(p) })),
  };
}
