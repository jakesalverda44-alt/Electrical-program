// Takeoff accuracy, Task 7 — DB half of the Needs-review list and its gate.
// See ai/reviewItems.ts for the pure rules.
import { laborDuplicatePairs, describePair } from './duplicateLines';
import { pool } from '../db/pool';
import { getBidLines } from './bidEstimate';
import { lineForType } from './aiMarkers';
import {
  reviewStatus, validateResolution, reviewItemIsOpen, perItemInput, groupOf, applyGroupMemberResolution,
  applyReconcileMemberResolution,
  type ReviewItem, type ResolveInput,
} from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';
import { agreeRadiusPt } from '../ai/evidence/consistency';
import { missingEvidenceTypes, manualLinesMissingReason } from '../ai/evidence/evidenceGate';
import { logLabeledEvents } from './labeledEvents';

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
  openItems: Array<Pick<ReviewItem, 'id' | 'title' | 'detail'> & {
    kind: ReviewItem['kind'] | 'duplicate';
    /** B5 — for a Labor & Pricing line missing its evidence reason: its
     *  line_key, so the frontend can jump to that row and focus the field. */
    lineKey?: string;
  }>;
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

/** Evidence round 4.1 — the GC-facing evidence gate: every counted,
 *  GC-facing type must carry evidence (a marker, a schedule row, a typical
 *  expansion, an accepted gap-fill mark — ai/evidence/evidenceGate.ts), and
 *  every manual line (or a hand-overridden takeoff quantity) needs a
 *  reason. null = not blocked.
 *
 *  Deliberately NEVER called by generate-prebid-package / email-prebid-
 *  chris, the same way budgetPendingGate is exempt for it: the pre-bid
 *  package is internal, confidence-coded already (Decision, evidence round
 *  plan), and composed before pricing exists at all. A GC-facing generate/
 *  send route calls this the same way it calls takeoffGate / budgetPendingGate. */
export async function evidenceGate(bidId: string): Promise<GateBlock | null> {
  const { rows } = await pool.query('SELECT count_result, review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const cr = (rows[0]?.count_result as CountResult | null) ?? null;
  // S14 — a type the estimator resolved (any action: not on job, a typed
  // count, confirmed markers) has its own evidence already; never re-gated.
  const reviewItems = (rows[0]?.review_items as ReviewItem[] | null) ?? [];
  const resolvedKeys = new Set(reviewItems.filter(i => i.resolution && i.typeKey).map(i => i.typeKey!));
  const missingTypes = missingEvidenceTypes(cr?.types ?? [], resolvedKeys);
  const missingLines = manualLinesMissingReason((await getBidLines(bidId)).map(l => ({ ...l, lineKey: l.line_key })));
  if (!missingTypes.length && !missingLines.length) return null;
  const openItems: GateBlock['openItems'] = [
    ...missingTypes.map(t => ({
      // N5 — the type's own key is already stable (unlike a line's
      // description); this half never needed a fix, but is kept explicit.
      id: `evidence:${t.key}`, kind: 'count' as const,
      title: `Type ${t.type}${t.description ? ` — ${t.description}` : ''}`,
      detail: 'This counted quantity carries no evidence (no marker, schedule row or typical expansion) — check the Plans view or the Takeoff review.',
    })),
    // B5 / N5 — keyed by line_key (stable, never collides on a shared
    // description) so the frontend can jump straight to the row and focus
    // its reason field.
    ...missingLines.map(l => ({
      id: `evidence:line:${l.lineKey}`, kind: 'confirm' as const,
      title: l.description || '(untitled line)',
      detail: 'A manual line (or a hand-typed quantity) needs a reason before it can go on a GC document — add one in Labor & Pricing.',
      lineKey: l.lineKey,
    })),
  ];
  const names = openItems.map(i => i.title);
  const n = openItems.length;
  return {
    error: `${n} takeoff line${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} evidence before a GC document can be generated or sent: ${names.slice(0, 4).join('; ')}${names.length > 4 ? '; …' : ''}. Add a marker/schedule reference, or a reason, in Labor & Pricing.`,
    openItems,
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

/** Review fix S8 — the consistency check's own SUGGESTED marks the
 *  estimator confirmed, for one type: "confirm the found marks" ADDS these
 *  to the kept (first-pass) count, never replaces it with a bid-wide tally.
 *  Round 2 fix S15 — a confirmed marker outlives a re-run: one the CURRENT
 *  first pass already counts (within the same matching radius, on the same
 *  sheet) is that fixture, never added again. */
export async function confirmedConsistencyMarkers(bidId: string, typeKey: string): Promise<number> {
  const { rows } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const cr = rows[0]?.count_result as (CountResult & { markers?: { sheetDocuments?: Array<{ sheetKey: string; documentId: string; pageIndex: number }> } }) | null;
  const tag = (cr?.targets?.find(t => t.key === typeKey)?.type ?? typeKey).toUpperCase();
  const r = await pool.query(
    `SELECT document_id, page_index, points FROM est_markups
      WHERE bid_id = $1 AND kind = 'count' AND status = 'confirmed' AND deleted_at IS NULL
        AND source = 'gap_fill' AND created_by = 'Consistency check' AND upper(coalesce(label, '')) = $2`,
    [bidId, tag]
  );
  const docs = cr?.markers?.sheetDocuments ?? [];
  return extraConfirmedMarks(r.rows.map(x => ({
    sheetKey: docs.find(d => d.documentId === x.document_id && d.pageIndex === Number(x.page_index))?.sheetKey ?? null,
    point: (x.points as Array<{ x: number; y: number }>)?.[0] ?? null,
  })), (cr?.marks ?? []).filter(m => m.typeKey === typeKey)).length;
}

/** Pure (S15): the confirmed marks the current first pass does not already
 *  count. A marker on an unknown sheet, or with no point, is kept. */
export function extraConfirmedMarks<T extends { sheetKey: string | null; point: { x: number; y: number } | null }>(
  confirmed: T[], current: Array<{ sheetKey: string; x: number; y: number }>,
): T[] {
  return confirmed.filter(c => {
    if (!c.sheetKey || !c.point) return true;
    const mine = current.filter(m => m.sheetKey === c.sheetKey);
    const radius = agreeRadiusPt(mine);
    return !mine.some(m => Math.hypot(m.x - c.point!.x, m.y - c.point!.y) <= radius);
  });
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
  // 'markers' needs a count computed outside the row lock. Fix round 3 /
  // B11 — a `gapfill:`/`reconcile:` id's marker tally is no longer summed
  // across every type it names (that was B11's own bug: the sum was then
  // given to EACH member); those items resolve member by member, each
  // tallied on its own single key, inline in the per-member branch below.
  const markerCounts = new Map<string, MarkerTally>();
  if (input?.action === 'markers') {
    for (const id of itemIds) {
      const m = /^(?:count|coverage):(.+)$/.exec(id);
      if (!m || id.endsWith(':heads')) { markerCounts.set(id, { counted: 0, excluded: [] }); continue; }
      markerCounts.set(id, await confirmedMarkersForType(bidId, m[1]));
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT review_items, run_id FROM takeoff_results WHERE bid_id = $1 FOR UPDATE', [bidId]);
    if (!rows.length) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'No takeoff for this bid.' }; }
    const items = ((rows[0].review_items as ReviewItem[] | null) ?? []).map(i => ({ ...i }));
    // Fix round B6 — which member(s) of a legend-zero group this call
    // actually answered, for the labeled-events block below (never
    // re-logs a member's earlier answer just because it's still there).
    const touchedGroupMembers = new Map<string, string[]>();
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
      // Fix round 3 / S16 — equipment can't be zeroed by ANY bulk action
      // (the zero-count group's "mark all", the cross-group multi-select,
      // or anything else): each equipment item is answered on its own.
      const equipment = picked.filter(i => i.category === 'equipment');
      if (equipment.length) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: `Equipment is never resolved in bulk — answer each one on its own: ${equipment.map(i => i.title).join(', ')}.` };
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
      // Fix round B6 — a legend-zero GROUP resolves member by member, each
      // with its own action, never a single blanket flag for the whole
      // group.
      if (item.id.startsWith('legend-zero:')) {
        const memberKey = typeof input.memberKey === 'string' ? input.memberKey : undefined;
        const targets = memberKey
          ? (item.groupedTypes ?? []).filter(m => m.key === memberKey)
          : (item.groupedTypes ?? []).filter(m => !m.resolution);
        if (memberKey && !targets.length) {
          await client.query('ROLLBACK');
          return { ok: false, status: 404, error: `${memberKey} is not in this group, or already resolved.` };
        }
        const touchedKeys: string[] = [];
        for (const t of targets) {
          const memberItem: ReviewItem = { id: `count:${t.key}`, kind: 'count', title: t.type, detail: t.description, typeKey: t.key, type: t.type, description: t.description, actions: ['count', 'markers', 'not_on_job'] };
          const mine = perItemInput(memberItem, input);
          if ('error' in mine) { await client.query('ROLLBACK'); return { ok: false, status: 400, error: mine.error }; }
          const markerTally = mine.action === 'markers' ? await confirmedMarkersForType(bidId, t.key) : null;
          const check = validateResolution(memberItem, mine, markerTally?.counted ?? null);
          if (!check.ok) {
            await client.query('ROLLBACK');
            const excl = markerTally?.excluded.length ? ` Not counted: ${markerTally.excluded.map(e => `${e.count} on ${e.label}`).join('; ')}.` : '';
            return { ok: false, status: 400, error: `${t.type}: ${check.error}${excl}` };
          }
          Object.assign(item, applyGroupMemberResolution(item, t.key, check.resolution, by));
          touchedKeys.push(t.key);
        }
        if (touchedKeys.length) touchedGroupMembers.set(id, touchedKeys);
        continue;
      }
      // Fix round 3 / B10, B11 — a gap-fill/reconcile finding resolves per
      // TYPE, never a single number broadcast to every type it covers. With
      // exactly one type there's no ambiguity (memberKey optional); with
      // 2+, 'count'/'markers' (a real number) REQUIRE memberKey — omitting
      // it 400s instead of guessing which type the number was for. Only
      // 'confirm' ("No more on this job — keep current count") may still
      // apply to every unanswered type at once: it carries no shared
      // number, each type just keeps its own current value.
      if (item.id.startsWith('gapfill:') || item.id.startsWith('reconcile:') || item.id.startsWith('consistency:')) {
        const members = item.reconcileMembers ?? [];
        const memberKey = typeof input.memberKey === 'string' ? input.memberKey : undefined;
        let targets: NonNullable<ReviewItem['reconcileMembers']>;
        if (memberKey) {
          targets = members.filter(m => m.key === memberKey);
          if (!targets.length) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: `${memberKey} is not part of this finding.` }; }
        } else if (members.length <= 1) {
          targets = members;
        } else if (input.action === 'confirm') {
          targets = members.filter(m => !m.resolution || !!m.resolution.needs);
        } else {
          await client.query('ROLLBACK');
          return { ok: false, status: 400, error: `This covers ${members.length} types — answer each one separately (${members.map(m => m.type).join(', ')}).` };
        }
        const touchedKeys: string[] = [];
        for (const t of targets) {
          const memberItem: ReviewItem = {
            id: `${item.id.split(':')[0]}:${t.key}`, kind: item.kind, title: t.type, detail: item.detail,
            typeKey: t.key, type: t.type, description: t.description, actions: item.actions,
          };
          const mine = perItemInput(memberItem, input);
          if ('error' in mine) { await client.query('ROLLBACK'); return { ok: false, status: 400, error: mine.error }; }
          const consistency = item.id.startsWith('consistency:');
          const markerTally = mine.action === 'markers'
            ? (consistency ? { counted: await confirmedConsistencyMarkers(bidId, t.key), excluded: [] as MarkerTally['excluded'] } : await confirmedMarkersForType(bidId, t.key))
            : null;
          const check = validateResolution(memberItem, mine, markerTally?.counted ?? null);
          if (!check.ok) {
            await client.query('ROLLBACK');
            const excl = markerTally?.excluded.length ? ` Not counted: ${markerTally.excluded.map(e => `${e.count} on ${e.label}`).join('; ')}.` : '';
            return { ok: false, status: 400, error: `${t.type}: ${check.error}${excl}` };
          }
          // B11 — the entered/confirmed number is in the member's OWN unit
          // (heads for site_lighting); 'confirm' keeps its current value in
          // that same unit, never null, never someone else's number.
          // Fix round 4 / B13 — a heads member: a marker tally is POLES
          // (x heads-per-pole = heads, or heads still needed); a number may
          // complete a half-done answer (N9).
          const resolution: Parameters<typeof applyReconcileMemberResolution>[2] = check.resolution.action === 'confirm'
            ? { ...check.resolution, qty: t.currentQty }
            // Review fix S8 — the confirmed consistency suggestions are added to the kept count.
            : consistency && check.resolution.action === 'markers' ? { ...check.resolution, qty: t.currentQty + (check.resolution.qty ?? 0) }
            : check.resolution; // heads members: applyReconcileMemberResolution turns it into poles + heads
          Object.assign(item, applyReconcileMemberResolution(item, t.key, resolution, by));
          // B10 — "No more on this job" rejects only THIS type's own
          // SUGGESTED gap-fill markers; a confirmed marker (or the type's
          // real count) is never touched.
          if (check.resolution.action === 'confirm') {
            await client.query(`DELETE FROM est_markups WHERE bid_id = $1 AND label = $2 AND source = 'gap_fill' AND status = 'suggested'`, [bidId, t.key]);
          }
          touchedKeys.push(t.key);
        }
        if (touchedKeys.length) touchedGroupMembers.set(id, touchedKeys);
        continue;
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
    // Evidence round 5.1 — labeled data, best-effort, outside the
    // transaction (never lets logging delay or fail the actual resolve).
    if (input) {
      const runId = rows[0].run_id as string | null;
      void (async () => {
        const { rows: b } = await pool.query('SELECT brand, project_type FROM bids WHERE id = $1', [bidId]).catch(() => ({ rows: [] as Array<{ brand: string | null; project_type: string | null }> }));
        const brand = b[0]?.brand ?? null;
        const projectType = b[0]?.project_type ?? null;
        // Fix round B6 — a legend-zero group logs one event per member it
        // actually answered THIS call (touchedGroupMembers), never the
        // members it already answered on an earlier call.
        const events: Parameters<typeof logLabeledEvents>[0] = [];
        for (const id of itemIds) {
          const item = items.find(i => i.id === id);
          if (!item) continue;
          const touched = touchedGroupMembers.get(id);
          if (touched) {
            for (const key of touched) {
              const m = item.groupedTypes?.find(g => g.key === key) ?? item.reconcileMembers?.find(g => g.key === key);
              if (!m?.resolution) continue;
              events.push({
                bidId, runId, kind: 'review_resolution' as const, typeKey: key, client: brand, projectType, by,
                detail: { itemId: id, memberKey: key, group: item.group, action: m.resolution.action, qty: m.resolution.qty ?? null },
              });
            }
            continue;
          }
          if (!item.resolution) continue;
          events.push({
            bidId, runId, kind: 'review_resolution' as const, typeKey: item.typeKey ?? null, client: brand, projectType, by,
            detail: { itemId: id, group: item.group, action: item.resolution.action, answer: item.resolution.answer ?? null, qty: item.resolution.qty ?? null },
          });
        }
        await logLabeledEvents(events);
      })();
    }
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
