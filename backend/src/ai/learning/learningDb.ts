// Level 2 learning — loaders and writers (migration 163). Every writer is
// best-effort where it sits on a user's path (captures are enqueued
// fire-and-forget; the harvester never throws to the user). Nothing here
// reads takeoff_labeled_events.
import crypto from 'crypto';
import { pool } from '../../db/pool';
import type { Meaning } from './meaning';

// ── Captures (the queue) ────────────────────────────────────────────────────

export type CaptureKind = 'marker_create' | 'marker_move' | 'marker_confirm' | 'marker_reclass' | 'marker_delete' | 'review_unlisted' | 'review_statuscrop' | 'review_pole_type' | 'undo';

export async function enqueueCaptures(rows: Array<{ bidId: string; kind: CaptureKind; payload: Record<string, unknown> }>): Promise<void> {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => { values.push(r.bidId, r.kind, JSON.stringify(r.payload)); return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`; });
  await pool.query(`INSERT INTO symbol_example_captures (bid_id, kind, payload) VALUES ${tuples.join(', ')}`, values);
}

export interface CaptureRow { id: number; bidId: string; kind: CaptureKind; payload: Record<string, unknown>; createdAt: string }

export async function pendingCaptures(opts: { bidId?: string; limit?: number } = {}): Promise<CaptureRow[]> {
  const params: unknown[] = [Math.max(1, opts.limit ?? 200)];
  let where = `status = 'pending'`;
  if (opts.bidId) { params.push(opts.bidId); where += ` AND bid_id = $2`; }
  const { rows } = await pool.query(`SELECT id, bid_id, kind, payload, created_at FROM symbol_example_captures WHERE ${where} ORDER BY id LIMIT $1`, params);
  return rows.map(r => ({ id: Number(r.id), bidId: r.bid_id as string, kind: r.kind as CaptureKind, payload: (r.payload as Record<string, unknown>) ?? {}, createdAt: new Date(r.created_at as string).toISOString() }));
}

export async function markCapture(id: number, status: 'done' | 'failed' | 'skipped', error?: string): Promise<void> {
  await pool.query(`UPDATE symbol_example_captures SET status = $2, error = $3, done_at = now() WHERE id = $1`, [id, status, error ? error.slice(0, 500) : null]);
}

// ── Examples ────────────────────────────────────────────────────────────────

export type ExampleSourceKind = Exclude<CaptureKind, 'undo'>;

export interface NewExample {
  crop: Buffer;
  dhash: bigint;
  halfIn: number;
  polarity: 'positive' | 'negative';
  meaning: Meaning;
  confusedWith?: Meaning | null;
  notADevice?: boolean;
  sourceKind: ExampleSourceKind;
  sourceRef: { markupId?: string; itemId?: string; memberKey?: string; runId?: string | null };
  sourceBidId: string;
  sourceDocSha: string | null;
  pageIndex: number | null;
  sheetLabel: string | null;
  xPt: number | null;
  yPt: number | null;
  legendQuote: string | null;
  accountRuleId: string | null;
  projectType: string | null;
  quality: number;
  verifiedBy: string | null;
}

/** Inserts a candidate example (a duplicate of the same source + crop is
 *  ignored). The newest capture of one marker wins: its older examples are
 *  retired. Returns the new id, or null for a duplicate. */
export async function insertExample(e: NewExample): Promise<string | null> {
  const sha = crypto.createHash('sha256').update(e.crop).digest('hex');
  const { rows } = await pool.query(
    `INSERT INTO symbol_examples (crop, crop_sha256, dhash, half_in, polarity, meaning, confused_with, not_a_device, source_kind, source_ref,
       source_bid_id, source_doc_sha, page_index, sheet_label, x_pt, y_pt, legend_quote, account_rule_id, project_type, quality, verified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT DO NOTHING RETURNING id`,
    [e.crop, sha, e.dhash.toString(), e.halfIn, e.polarity, JSON.stringify(e.meaning), e.confusedWith ? JSON.stringify(e.confusedWith) : null, !!e.notADevice,
      e.sourceKind, JSON.stringify(e.sourceRef), e.sourceBidId, e.sourceDocSha, e.pageIndex, e.sheetLabel, e.xPt, e.yPt, e.legendQuote,
      e.accountRuleId, e.projectType, e.quality, e.verifiedBy],
  );
  const id = (rows[0]?.id as string | undefined) ?? null;
  if (id && e.sourceRef.markupId) {
    await pool.query(
      `UPDATE symbol_examples SET status = 'retired', retired_reason = 'a newer capture of the same marker', retired_at = now()
        WHERE source_ref->>'markupId' = $1 AND id <> $2 AND status <> 'retired' AND polarity = $3`,
      [e.sourceRef.markupId, id, e.polarity]);
  }
  return id;
}

/** Undo — the source of an example was undone (reopened, un-confirmed,
 *  re-deleted): its examples retire. */
export async function retireExamplesBySource(ref: { bidId: string; markupId?: string; itemId?: string; memberKey?: string }, reason = 'source undone'): Promise<number> {
  const conds: string[] = ['source_bid_id = $1', `status <> 'retired'`];
  const params: unknown[] = [ref.bidId, reason];
  if (ref.markupId) { params.push(ref.markupId); conds.push(`source_ref->>'markupId' = $${params.length}`); }
  if (ref.itemId) { params.push(ref.itemId); conds.push(`source_ref->>'itemId' = $${params.length}`); }
  if (ref.memberKey) { params.push(ref.memberKey); conds.push(`source_ref->>'memberKey' = $${params.length}`); }
  if (!ref.markupId && !ref.itemId) return 0;
  const r = await pool.query(`UPDATE symbol_examples SET status = 'retired', retired_reason = $2, retired_at = now() WHERE ${conds.join(' AND ')}`, params);
  return r.rowCount ?? 0;
}

export interface ExampleRow {
  id: string;
  dhash: bigint;
  polarity: 'positive' | 'negative';
  meaning: Meaning;
  confusedWith: Meaning | null;
  notADevice: boolean;
  sourceKind: ExampleSourceKind;
  sourceRef: Record<string, unknown>;
  sourceBidId: string | null;
  sourceBidName: string | null;
  sourceDocSha: string | null;
  sheetLabel: string | null;
  legendQuote: string | null;
  accountRuleId: string | null;
  projectType: string | null;
  quality: number;
  status: 'candidate' | 'active' | 'retired';
  retiredReason: string | null;
  createdAt: string;
  crop?: Buffer;
}

const exampleOf = (r: Record<string, unknown>): ExampleRow => ({
  id: r.id as string, dhash: BigInt(String(r.dhash)), polarity: r.polarity as ExampleRow['polarity'], meaning: r.meaning as Meaning,
  confusedWith: (r.confused_with as Meaning | null) ?? null, notADevice: !!r.not_a_device, sourceKind: r.source_kind as ExampleSourceKind,
  sourceRef: (r.source_ref as Record<string, unknown>) ?? {}, sourceBidId: (r.source_bid_id as string | null) ?? null, sourceBidName: (r.bid_name as string | null) ?? null,
  sourceDocSha: (r.source_doc_sha as string | null) ?? null, sheetLabel: (r.sheet_label as string | null) ?? null, legendQuote: (r.legend_quote as string | null) ?? null,
  accountRuleId: (r.account_rule_id as string | null) ?? null, projectType: (r.project_type as string | null) ?? null, quality: Number(r.quality ?? 1),
  status: r.status as ExampleRow['status'], retiredReason: (r.retired_reason as string | null) ?? null, createdAt: new Date(r.created_at as string).toISOString(),
  ...(r.crop ? { crop: r.crop as Buffer } : {}),
});

export async function listExamples(opts: { status?: string; ids?: string[]; withCrop?: boolean; limit?: number } = {}): Promise<ExampleRow[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.status) { params.push(opts.status); conds.push(`e.status = $${params.length}`); }
  if (opts.ids) { params.push(opts.ids); conds.push(`e.id = ANY($${params.length}::uuid[])`); }
  params.push(Math.max(1, opts.limit ?? 500));
  const { rows } = await pool.query(
    `SELECT e.id, e.dhash, e.polarity, e.meaning, e.confused_with, e.not_a_device, e.source_kind, e.source_ref, e.source_bid_id, b.name AS bid_name,
            e.source_doc_sha, e.sheet_label, e.legend_quote, e.account_rule_id, e.project_type, e.quality, e.status, e.retired_reason, e.created_at
            ${opts.withCrop ? ', e.crop' : ''}
       FROM symbol_examples e LEFT JOIN bids b ON b.id = e.source_bid_id
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY e.created_at DESC LIMIT $${params.length}`, params);
  return rows.map(exampleOf);
}

export async function exampleCrop(id: string): Promise<Buffer | null> {
  const { rows } = await pool.query('SELECT crop FROM symbol_examples WHERE id = $1', [id]);
  return (rows[0]?.crop as Buffer | undefined) ?? null;
}

export async function retireExample(id: string, reason: string): Promise<boolean> {
  const r = await pool.query(`UPDATE symbol_examples SET status = 'retired', retired_reason = $2, retired_at = now() WHERE id = $1 AND status <> 'retired'`, [id, reason]);
  return (r.rowCount ?? 0) > 0;
}

// ── Lessons ─────────────────────────────────────────────────────────────────

export type LessonStatus = 'proposed' | 'approved' | 'dismissed' | 'retired';
export type ScopeKind = 'all' | 'project_type' | 'account';
export interface LessonEvidence { bidId: string; bidName: string; itemId: string; answer: string; reason?: string | null; at: string }
export interface LessonMatch { deviceClass?: string; meaningFp?: string; unlistedSymbolFp?: string; itemPrefix?: string; typeKey?: string }
export interface LessonRow {
  id: string; lineageId: string; version: number; text: string; appliesTo: Array<'counter' | 'review'>;
  scopeKind: ScopeKind; scopeValue: string | null; match: LessonMatch; status: LessonStatus; evidence: LessonEvidence[]; pattern: string;
  suggestedScope: { kind: ScopeKind; value: string | null; label: string } | null;
  proposedAt: string; decidedBy: string | null; decidedAt: string | null;
}

const lessonOf = (r: Record<string, unknown>): LessonRow => ({
  id: r.id as string, lineageId: r.lineage_id as string, version: Number(r.version), text: r.text as string, appliesTo: (r.applies_to as LessonRow['appliesTo']) ?? [],
  scopeKind: r.scope_kind as ScopeKind, scopeValue: (r.scope_value as string | null) ?? null, match: (r.match as LessonMatch) ?? {}, status: r.status as LessonStatus,
  evidence: (r.evidence as LessonEvidence[]) ?? [], pattern: r.pattern as string, suggestedScope: (r.suggested_scope as LessonRow['suggestedScope']) ?? null,
  proposedAt: new Date(r.proposed_at as string).toISOString(), decidedBy: (r.decided_by as string | null) ?? null, decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
});

export async function listLessons(opts: { status?: LessonStatus; ids?: string[] } = {}): Promise<LessonRow[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
  if (opts.ids) { params.push(opts.ids); conds.push(`id = ANY($${params.length}::uuid[])`); }
  const { rows } = await pool.query(`SELECT * FROM counting_lessons ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY proposed_at DESC, version DESC`, params);
  return rows.map(lessonOf);
}

export async function getLesson(id: string): Promise<LessonRow | null> {
  const { rows } = await pool.query('SELECT * FROM counting_lessons WHERE id = $1', [id]);
  return rows[0] ? lessonOf(rows[0]) : null;
}

export async function insertLesson(l: { lineageId?: string; version?: number; text: string; appliesTo: LessonRow['appliesTo']; scopeKind?: ScopeKind; scopeValue?: string | null;
  match: LessonMatch; status?: LessonStatus; evidence: LessonEvidence[]; pattern: string; suggestedScope?: LessonRow['suggestedScope']; decidedBy?: string | null }): Promise<LessonRow> {
  const { rows } = await pool.query(
    `INSERT INTO counting_lessons (lineage_id, version, text, applies_to, scope_kind, scope_value, match, status, evidence, pattern, suggested_scope, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $12::text IS NULL THEN NULL ELSE now() END) RETURNING *`,
    [l.lineageId ?? crypto.randomUUID(), l.version ?? 1, l.text.slice(0, 300), l.appliesTo, l.scopeKind ?? 'all', l.scopeValue ?? null, JSON.stringify(l.match),
      l.status ?? 'proposed', JSON.stringify(l.evidence), l.pattern, l.suggestedScope ? JSON.stringify(l.suggestedScope) : null, l.decidedBy ?? null]);
  return lessonOf(rows[0]);
}

export async function updateLesson(id: string, patch: Partial<{ status: LessonStatus; evidence: LessonEvidence[]; decidedBy: string | null; scopeKind: ScopeKind; scopeValue: string | null; appliesTo: LessonRow['appliesTo'] }>): Promise<LessonRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (patch.status) add('status', patch.status);
  if (patch.evidence) add('evidence', JSON.stringify(patch.evidence));
  if (patch.scopeKind) add('scope_kind', patch.scopeKind);
  if (patch.scopeValue !== undefined) add('scope_value', patch.scopeValue);
  if (patch.appliesTo) add('applies_to', patch.appliesTo);
  if (patch.decidedBy !== undefined) { add('decided_by', patch.decidedBy); sets.push('decided_at = now()'); }
  if (!sets.length) return getLesson(id);
  const { rows } = await pool.query(`UPDATE counting_lessons SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0] ? lessonOf(rows[0]) : null;
}

export async function lessonLineage(lineageId: string): Promise<LessonRow[]> {
  const { rows } = await pool.query('SELECT * FROM counting_lessons WHERE lineage_id = $1 ORDER BY version', [lineageId]);
  return rows.map(lessonOf);
}

// ── Releases ────────────────────────────────────────────────────────────────

export interface ReleaseRow { id: number; exampleIds: string[]; lessonIds: string[]; eval: Record<string, unknown> | null; status: 'pending' | 'checking' | 'passed' | 'failed' | 'rolled_back'; createdBy: string | null; createdAt: string; activatedAt: string | null }
const releaseOf = (r: Record<string, unknown>): ReleaseRow => ({
  id: Number(r.id), exampleIds: (r.example_ids as string[]) ?? [], lessonIds: (r.lesson_ids as string[]) ?? [], eval: (r.eval as Record<string, unknown> | null) ?? null,
  status: r.status as ReleaseRow['status'], createdBy: (r.created_by as string | null) ?? null, createdAt: new Date(r.created_at as string).toISOString(),
  activatedAt: r.activated_at ? new Date(r.activated_at as string).toISOString() : null,
});

/** A pending release: every example that is not retired and every
 *  approved lesson. */
export async function createRelease(by: string | null): Promise<ReleaseRow> {
  const ex = await pool.query(`SELECT id FROM symbol_examples WHERE status <> 'retired' ORDER BY created_at`);
  const ls = await pool.query(`SELECT id FROM counting_lessons WHERE status = 'approved' ORDER BY proposed_at`);
  const { rows } = await pool.query(`INSERT INTO learning_releases (example_ids, lesson_ids, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [ex.rows.map(r => r.id), ls.rows.map(r => r.id), by]);
  return releaseOf(rows[0]);
}

export async function listReleases(limit = 20): Promise<ReleaseRow[]> {
  const { rows } = await pool.query('SELECT * FROM learning_releases ORDER BY id DESC LIMIT $1', [limit]);
  return rows.map(releaseOf);
}

export async function getRelease(id: number): Promise<ReleaseRow | null> {
  const { rows } = await pool.query('SELECT * FROM learning_releases WHERE id = $1', [id]);
  return rows[0] ? releaseOf(rows[0]) : null;
}

export async function setReleaseEval(id: number, evalResult: Record<string, unknown>, status: ReleaseRow['status']): Promise<void> {
  await pool.query('UPDATE learning_releases SET eval = $2, status = $3 WHERE id = $1', [id, JSON.stringify(evalResult), status]);
}

/** A check that has been 'checking' longer than this is dead (a restart or a crash). */
export const STALE_CHECK_SECS = 2 * 60 * 60;

/** S7 — atomic claim: only one caller wins a pending / failed release (or a
 *  stale 'checking' one). Returns false when somebody else holds it. */
export async function claimReleaseForCheck(id: number, staleSecs = STALE_CHECK_SECS): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE learning_releases SET status = 'checking', eval = jsonb_build_object('checking', true, 'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      WHERE id = $1 AND (status IN ('pending', 'failed')
        OR (status = 'checking' AND COALESCE((eval->>'at')::timestamptz, '-infinity'::timestamptz) < now() - make_interval(secs => $2)))
      RETURNING id`, [id, staleSecs]);
  return rows.length > 0;
}

/** Boot: the server that was running a check is gone, so no 'checking' release is live. */
export async function recoverInterruptedChecks(): Promise<number> {
  const r = await pool.query(
    `UPDATE learning_releases SET status = 'failed', eval = jsonb_build_object('passed', false, 'error', 'The check was interrupted (the server restarted) — run it again.') WHERE status = 'checking'`);
  return r.rowCount ?? 0;
}

/** Activation needs a passed eval; the counter then uses this release. */
export async function activateRelease(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await getRelease(id);
  if (!r) return { ok: false, error: 'No such release.' };
  if (!(r.eval && (r.eval as { passed?: boolean }).passed === true)) return { ok: false, error: 'This release has no passed check — run "Check and release" first.' };
  await pool.query(`UPDATE learning_releases SET status = 'passed', activated_at = now() WHERE id = $1`, [id]);
  if (r.exampleIds.length) await pool.query(`UPDATE symbol_examples SET status = 'active' WHERE id = ANY($1::uuid[]) AND status = 'candidate'`, [r.exampleIds]);
  return { ok: true };
}

/** Roll back to an earlier passed release: every later passed one is rolled back. */
export async function rollbackTo(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await getRelease(id);
  if (!r || r.status !== 'passed') return { ok: false, error: 'Only a passed release can be rolled back to.' };
  await pool.query(`UPDATE learning_releases SET status = 'rolled_back' WHERE id > $1 AND status = 'passed'`, [id]);
  return { ok: true };
}

/** The release the counter uses: the newest passed one (never a rolled-back one). */
export async function activeRelease(): Promise<ReleaseRow | null> {
  const { rows } = await pool.query(`SELECT * FROM learning_releases WHERE status = 'passed' ORDER BY id DESC LIMIT 1`);
  return rows[0] ? releaseOf(rows[0]) : null;
}

// ── Per-bid "turn off" ──────────────────────────────────────────────────────

export interface LearningOff { all: boolean; examples: Set<string>; lessons: Set<string> }

export async function learningOffFor(bidId: string): Promise<LearningOff> {
  const { rows } = await pool.query('SELECT ref_kind, ref_id FROM bid_learning_off WHERE bid_id = $1', [bidId]);
  return {
    all: rows.some(r => r.ref_kind === 'all'),
    examples: new Set(rows.filter(r => r.ref_kind === 'example' && r.ref_id).map(r => r.ref_id as string)),
    lessons: new Set(rows.filter(r => r.ref_kind === 'lesson' && r.ref_id).map(r => r.ref_id as string)),
  };
}

export async function setLearningOff(bidId: string, refKind: 'example' | 'lesson' | 'all', refId: string | null, by: string | null): Promise<void> {
  await pool.query(`INSERT INTO bid_learning_off (bid_id, ref_kind, ref_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [bidId, refKind, refId, by]);
}

export async function clearLearningOff(bidId: string, refKind: 'example' | 'lesson' | 'all', refId: string | null): Promise<void> {
  await pool.query(`DELETE FROM bid_learning_off WHERE bid_id = $1 AND ref_kind = $2 AND ref_id IS NOT DISTINCT FROM $3`, [bidId, refKind, refId]);
}
