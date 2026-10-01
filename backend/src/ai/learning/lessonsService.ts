// Level 2 learning, Task 12 — lessons: proposing (from every bid's human
// answers and the example captures), approving with versions, dismissing,
// retiring, restoring. Approval defaults to "all jobs" (Jake); a lesson is a
// hint and never changes a count.
import { pool } from '../../db/pool';
import { logger } from '../../utils/logger';
import type { ReviewItem } from '../reviewItems';
import { proposeLessons, reconcileProposals, lessonFromItem, type LessonSourceBid, type ConfusionExample, type Proposal } from './proposeLessons';
import { listLessons, insertLesson, updateLesson, getLesson, lessonLineage, type LessonRow, type ScopeKind } from './learningDb';

export async function defaultRuleId(): Promise<string | null> {
  const { rows } = await pool.query('SELECT id FROM account_rules WHERE is_default LIMIT 1').catch(() => ({ rows: [] as Array<{ id: string }> }));
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function loadLessonSources(): Promise<LessonSourceBid[]> {
  const { rows } = await pool.query(
    `SELECT tr.bid_id, b.name, b.project_type, tr.account_terms->>'ruleId' AS rule_id, tr.review_items
       FROM takeoff_results tr JOIN bids b ON b.id = tr.bid_id WHERE tr.review_items IS NOT NULL`);
  return rows.map(r => ({ bidId: r.bid_id as string, bidName: (r.name as string) || 'a bid', projectType: (r.project_type as string | null) ?? null, ruleId: (r.rule_id as string | null) ?? null, items: (r.review_items as ReviewItem[]) ?? [] }));
}

async function loadConfusions(): Promise<ConfusionExample[]> {
  const { rows } = await pool.query(
    `SELECT e.id, e.source_bid_id, b.name, e.meaning->>'deviceClass' AS to_cls, e.confused_with->>'deviceClass' AS from_cls, e.not_a_device, e.created_at
       FROM symbol_examples e LEFT JOIN bids b ON b.id = e.source_bid_id
      WHERE e.polarity = 'negative' AND e.status <> 'retired' AND e.source_kind IN ('marker_reclass', 'marker_delete') AND e.source_bid_id IS NOT NULL`);
  return rows.map(r => ({ exampleId: r.id as string, bidId: r.source_bid_id as string, bidName: (r.name as string) || 'a bid', to: (r.to_cls as ConfusionExample['to']) ?? null, from: (r.from_cls as ConfusionExample['from']) ?? null, notADevice: !!r.not_a_device, at: new Date(r.created_at as string).toISOString() }));
}

async function store(p: Proposal): Promise<LessonRow> {
  return insertLesson({ text: p.text, appliesTo: p.appliesTo, match: p.match, evidence: p.evidence, pattern: p.pattern, suggestedScope: p.suggestedScope });
}

/** "Check for new lessons" / the end of an analysis run. Never throws. */
export async function refreshLessonProposals(): Promise<{ proposed: number; appended: number }> {
  try {
    const props = proposeLessons(await loadLessonSources(), await loadConfusions(), await defaultRuleId());
    const { inserts, appends } = reconcileProposals(props, await listLessons());
    for (const p of inserts) await store(p);
    for (const a of appends) await updateLesson(a.lessonId, { evidence: a.evidence });
    return { proposed: inserts.length, appended: appends.length };
  } catch (err) {
    logger.warn({ err }, '[learning] lesson proposals failed (non-fatal)');
    return { proposed: 0, appended: 0 };
  }
}

/** "Make a lesson from this answer": one proposal from one human answer. */
export async function lessonFromReviewItem(bidId: string, itemId: string): Promise<{ ok: true; lesson: LessonRow } | { ok: false; status: number; error: string }> {
  const { rows } = await pool.query(
    `SELECT tr.review_items, b.name, b.project_type, tr.account_terms->>'ruleId' AS rule_id FROM takeoff_results tr JOIN bids b ON b.id = tr.bid_id WHERE tr.bid_id = $1`, [bidId]);
  if (!rows.length) return { ok: false, status: 404, error: 'No takeoff for this bid.' };
  const items = (rows[0].review_items as ReviewItem[] | null) ?? [];
  const item = items.find(i => i.id === itemId);
  if (!item) return { ok: false, status: 404, error: `Review item not found: ${itemId}` };
  const p = lessonFromItem({ bidId, bidName: rows[0].name as string, projectType: (rows[0].project_type as string | null) ?? null, ruleId: (rows[0].rule_id as string | null) ?? null, items }, item, await defaultRuleId());
  if (!p) return { ok: false, status: 400, error: 'Only an answer the estimator gave can become a lesson (not an automatic one, not an open item).' };
  return { ok: true, lesson: await store(p) };
}

export interface ApproveInput { text?: string; scopeKind?: ScopeKind; scopeValue?: string | null; appliesTo?: Array<'counter' | 'review'> }

/** Approve (scope defaults to all jobs). Edited text → a new version in
 *  the same lineage; the previous version is retired. */
export async function approveLesson(id: string, input: ApproveInput, by: string): Promise<{ ok: true; lesson: LessonRow } | { ok: false; status: number; error: string }> {
  const l = await getLesson(id);
  if (!l) return { ok: false, status: 404, error: 'No such lesson.' };
  if (l.status === 'retired') return { ok: false, status: 400, error: 'A retired version cannot be approved — restore it instead.' };
  const scopeKind = input.scopeKind ?? 'all';
  if (!['all', 'project_type', 'account'].includes(scopeKind)) return { ok: false, status: 400, error: 'scope_kind must be all, project_type or account.' };
  const scopeValue = scopeKind === 'all' ? null : (input.scopeValue ?? null);
  if (scopeKind !== 'all' && !scopeValue) return { ok: false, status: 400, error: 'Say which project type / client this lesson is for.' };
  if (scopeKind === 'account' && scopeValue === await defaultRuleId()) return { ok: false, status: 400, error: 'The Default rule is not a client.' };
  const appliesTo = (input.appliesTo ?? l.appliesTo).filter(a => a === 'counter' || a === 'review');
  if (!appliesTo.length) return { ok: false, status: 400, error: 'Use it in counting, in review questions, or both.' };
  const text = typeof input.text === 'string' ? input.text.trim() : l.text;
  if (!text || text.length > 300) return { ok: false, status: 400, error: 'A lesson is 1-300 characters.' };
  if (text !== l.text) {
    const lineage = await lessonLineage(l.lineageId);
    const next = await insertLesson({ lineageId: l.lineageId, version: Math.max(...lineage.map(x => x.version)) + 1, text, appliesTo, scopeKind, scopeValue,
      match: l.match, status: 'approved', evidence: l.evidence, pattern: l.pattern, suggestedScope: l.suggestedScope, decidedBy: by });
    for (const x of lineage) if (x.status !== 'retired' && x.status !== 'dismissed') await updateLesson(x.id, { status: 'retired', decidedBy: by });
    return { ok: true, lesson: next };
  }
  const updated = await updateLesson(id, { status: 'approved', scopeKind, scopeValue, appliesTo, decidedBy: by });
  return { ok: true, lesson: updated! };
}

export async function setLessonStatus(id: string, status: 'dismissed' | 'retired', by: string): Promise<LessonRow | null> {
  return updateLesson(id, { status, decidedBy: by });
}

/** "Restore v2": a new version with v2's text (approved), the lineage's current one retired. */
export async function restoreLesson(id: string, by: string): Promise<{ ok: true; lesson: LessonRow } | { ok: false; status: number; error: string }> {
  const l = await getLesson(id);
  if (!l) return { ok: false, status: 404, error: 'No such lesson.' };
  const lineage = await lessonLineage(l.lineageId);
  for (const x of lineage) if (x.status === 'approved') await updateLesson(x.id, { status: 'retired', decidedBy: by });
  const next = await insertLesson({ lineageId: l.lineageId, version: Math.max(...lineage.map(x => x.version)) + 1, text: l.text, appliesTo: l.appliesTo, scopeKind: l.scopeKind, scopeValue: l.scopeValue,
    match: l.match, status: 'approved', evidence: l.evidence, pattern: l.pattern, suggestedScope: l.suggestedScope, decidedBy: by });
  return { ok: true, lesson: next };
}
