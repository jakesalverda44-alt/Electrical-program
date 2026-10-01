// Level 2 learning, Task 10 — what a correction says about a symbol (pure:
// an event → capture payloads; the harvester crops and stores them later).
//
// | correction                                   | polarity            | quality |
// | estimator creates a count marker             | positive            | 3       |
// | AI or estimator-created marker moved         | positive (new spot; the old-position example retires: newest capture of a marker wins) | 3 |
// | AI marker confirmed unchanged                | positive            | 2       |
// | AI marker re-typed X→Y                       | positive Y + negative "looks like X, is Y" | 3 |
// | AI suggested marker deleted                  | negative "not a X" (a re-type when re-placed ≤ 24 pt as another type in the batch) | 2 |
// | unlisted:<TAG> counted with qty = its marks  | positive per mark (cap 4) | 1 |
// | per-pole type answered (typicalassign)       | positive for the pole tag | 2 |
// Never captured: area / scope / not-on-job rows (no instance to crop) and
// AUTOMATIC answers. Undo (un-confirm, reopen, re-delete) retires.
import type { ReviewItem, ReviewResolution } from '../reviewItems';
import type { CaptureKind } from './learningDb';

export interface MarkerLike {
  id: string; documentId: string; pageIndex: number; kind: string; status: string; label: string | null; lineKey: string | null;
  source: string | null; points: Array<{ x: number; y: number }>;
}
export interface MarkerCreate { id: string; documentId: string; pageIndex: number; kind: string; label?: string | null; lineKey?: string | null; points: Array<{ x: number; y: number }> }
export interface MarkerUpdate { id: string; status?: string; points?: Array<{ x: number; y: number }>; label?: string | null; lineKey?: string | null }

export interface Capture { kind: CaptureKind; payload: Record<string, unknown> }

export const RETYPE_RADIUS_PT = 24;
export const UNLISTED_CAP = 4;
const isAi = (m: Pick<MarkerLike, 'source'>) => m.source === 'ai_count' || m.source === 'gap_fill';
const centre = (pts: Array<{ x: number; y: number }>) => (pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : null);
const samePoints = (a?: Array<{ x: number; y: number }>, b?: Array<{ x: number; y: number }>) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const typeOf = (m: { label?: string | null; lineKey?: string | null }) => ({ label: m.label ?? null, lineKey: m.lineKey ?? null });

/** Captures for one markups batch. `before` = the rows as they were. */
export function capturesFromMarkupBatch(batch: { creates: MarkerCreate[]; updates: MarkerUpdate[]; deletes: string[] }, before: MarkerLike[]): Capture[] {
  const out: Capture[] = [];
  const prev = new Map(before.map(m => [m.id, m]));
  const deletedAi = batch.deletes.map(id => prev.get(id)).filter((m): m is MarkerLike => !!m && m.kind === 'count');
  const retyped = new Set<string>();
  for (const c of batch.creates) {
    if (c.kind !== 'count') continue;
    const at = centre(c.points);
    if (!at) continue;
    // A deleted AI marker re-placed within 24 pt as ANOTHER type: a re-type.
    const was = deletedAi.find(d => isAi(d) && d.status === 'suggested' && d.documentId === c.documentId && d.pageIndex === c.pageIndex
      && (centre(d.points) ? Math.hypot(centre(d.points)!.x - at.x, centre(d.points)!.y - at.y) <= RETYPE_RADIUS_PT : false)
      && (d.label ?? '') !== (c.label ?? '') && !retyped.has(d.id));
    if (was) {
      retyped.add(was.id);
      out.push({ kind: 'marker_reclass', payload: { markupId: c.id, documentId: c.documentId, pageIndex: c.pageIndex, point: at, to: typeOf(c), from: typeOf(was), quality: 3 } });
      continue;
    }
    out.push({ kind: 'marker_create', payload: { markupId: c.id, documentId: c.documentId, pageIndex: c.pageIndex, point: at, to: typeOf(c), quality: 3 } });
  }
  for (const u of batch.updates) {
    const p = prev.get(u.id);
    if (!p || p.kind !== 'count') continue;
    const labelChanged = (u.label !== undefined && (u.label ?? null) !== p.label) || (u.lineKey !== undefined && (u.lineKey ?? null) !== p.lineKey);
    const moved = u.points !== undefined && !samePoints(u.points, p.points);
    const point = centre(u.points ?? p.points);
    if (!point) continue;
    const base = { markupId: p.id, documentId: p.documentId, pageIndex: p.pageIndex, point };
    if (u.status === 'suggested' && p.status === 'confirmed') { out.push({ kind: 'undo', payload: { markupId: p.id } }); continue; }
    if (labelChanged && isAi(p)) {
      out.push({ kind: 'marker_reclass', payload: { ...base, to: { label: u.label !== undefined ? u.label ?? null : p.label, lineKey: u.lineKey !== undefined ? u.lineKey ?? null : p.lineKey }, from: typeOf(p), quality: 3 } });
      continue;
    }
    if (moved) { out.push({ kind: 'marker_move', payload: { ...base, to: typeOf({ label: u.label ?? p.label, lineKey: u.lineKey ?? p.lineKey }), quality: 3 } }); continue; }
    if (u.status === 'confirmed' && p.status === 'suggested' && isAi(p)) out.push({ kind: 'marker_confirm', payload: { ...base, to: typeOf(p), quality: 2 } });
  }
  for (const d of deletedAi) {
    if (retyped.has(d.id)) continue;
    if (d.status === 'confirmed') { out.push({ kind: 'undo', payload: { markupId: d.id } }); continue; }
    if (!isAi(d) || d.status !== 'suggested') continue;
    const point = centre(d.points);
    if (point) out.push({ kind: 'marker_delete', payload: { markupId: d.id, documentId: d.documentId, pageIndex: d.pageIndex, point, from: typeOf(d), quality: 2 } });
  }
  return out;
}

const human = (r?: ReviewResolution) => !!r && !r.auto;

/** Captures for a review answer (never an automatic one). */
export function capturesFromReview(item: ReviewItem, memberKey: string | undefined, unlistedMarks: Array<{ x: number; y: number; sheetKey: string }> = []): Capture[] {
  if (item.id.startsWith('unlisted:') && human(item.resolution) && item.resolution!.action === 'count' && item.resolution!.qty === unlistedMarks.length) {
    return unlistedMarks.slice(0, UNLISTED_CAP).map((m, i) => ({ kind: 'review_unlisted' as const, payload: {
      itemId: item.id, memberKey: `mark:${i}`, sheetKey: m.sheetKey, point: { x: m.x, y: m.y }, reason: item.resolution!.reason ?? '', symbol: item.description ?? '', tag: item.type ?? '', quality: 1,
    } }));
  }
  if (item.id.startsWith('typicalassign:') && memberKey && item.hostAssignment?.perPole) {
    const m = item.reconcileMembers?.find(x => x.key === memberKey);
    const pole = item.hostAssignment.perPole.poles.find(p => p.id === memberKey);
    const answer = m?.resolution?.action === 'answer' ? m.resolution.answer : undefined;
    const type = item.hostAssignment.perPole.types.find(t => t.typeId === answer);
    if (!human(m?.resolution) || !pole?.pdf || !type) return [];
    return [{ kind: 'review_pole_type', payload: { itemId: item.id, memberKey, sheetKey: pole.pdf.sheetKey, point: { x: pole.pdf.x, y: pole.pdf.y }, poleType: type.label, hostNoun: item.hostAssignment.hostNoun ?? 'power pole', quality: 2 } }];
  }
  return [];
}
