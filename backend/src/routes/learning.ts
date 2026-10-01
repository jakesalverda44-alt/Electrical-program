// Level 2 learning — Settings → "Counting lessons & examples", and the
// per-bid "Learning used on this run" strip. Anyone signed in can read;
// approving / dismissing / retiring and the releases are admin-only (like
// account rules). Nothing here changes a count.
import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { loadAccessibleBid } from '../utils/ownership';
import { listLessons, listExamples, exampleCrop, retireExample, lessonLineage, getLesson, learningOffFor, setLearningOff, clearLearningOff, type LessonStatus } from '../ai/learning/learningDb';
import { refreshLessonProposals, lessonFromReviewItem, approveLesson, setLessonStatus, restoreLesson } from '../ai/learning/lessonsService';
import type { CountResult } from '../ai/countingStage';
import type { ReviewItem } from '../ai/reviewItems';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['proposed', 'approved', 'dismissed', 'retired']);

// ── Lessons ─────────────────────────────────────────────────────────────────
router.get('/lessons', requireAuth, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' && STATUSES.has(req.query.status) ? req.query.status as LessonStatus : undefined;
  res.json({ lessons: await listLessons(status ? { status } : {}) });
}));

router.post('/lessons/check', requireAuth, asyncHandler(async (_req, res) => {
  res.json(await refreshLessonProposals());
}));

router.post('/lessons/from-item', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const bidId = String(req.body?.bidId ?? '');
  const itemId = String(req.body?.itemId ?? '');
  if (!UUID_RE.test(bidId) || !itemId) return res.status(400).json({ error: 'bidId and itemId required' });
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const out = await lessonFromReviewItem(bidId, itemId);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ lesson: out.lesson });
}));

router.get('/lessons/:id/versions', requireAuth, asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const l = await getLesson(req.params.id);
  if (!l) return res.status(404).json({ error: 'No such lesson.' });
  res.json({ versions: await lessonLineage(l.lineageId) });
}));

router.post('/lessons/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const b = req.body ?? {};
  const out = await approveLesson(req.params.id, {
    ...(typeof b.text === 'string' ? { text: b.text } : {}),
    scopeKind: b.scope_kind ?? 'all',
    scopeValue: typeof b.scope_value === 'string' ? b.scope_value : null,
    ...(Array.isArray(b.applies_to) ? { appliesTo: b.applies_to } : {}),
  }, req.user!.name);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ lesson: out.lesson });
}));

for (const [path, status] of [['dismiss', 'dismissed'], ['retire', 'retired']] as const) {
  router.post(`/lessons/:id/${path}`, requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const l = await setLessonStatus(req.params.id, status, req.user!.name);
    if (!l) return res.status(404).json({ error: 'No such lesson.' });
    res.json({ lesson: l });
  }));
}

router.post('/lessons/:id/restore', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const out = await restoreLesson(req.params.id, req.user!.name);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ lesson: out.lesson });
}));

// ── Examples ────────────────────────────────────────────────────────────────
router.get('/examples', requireAuth, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' && ['candidate', 'active', 'retired'].includes(req.query.status) ? req.query.status : undefined;
  const ex = await listExamples({ ...(status ? { status } : {}), limit: 300 });
  // Conflict badge: one visual cluster, two meanings.
  const { clusterOf } = await import('../ai/learning/visualHash');
  const clusters = clusterOf(ex.map(e => ({ id: e.id, dhash: e.dhash, deviceClass: e.meaning.deviceClass, meaningFp: e.meaning.meaningFp })));
  res.json({ examples: ex.map(e => ({ ...e, dhash: e.dhash.toString(), conflicted: clusters.get(e.id)?.conflicted ?? false })) });
}));

router.get('/examples/:id/crop.png', requireAuth, asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const crop = await exampleCrop(req.params.id);
  if (!crop) return res.status(404).json({ error: 'No such example.' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(crop);
}));

router.post('/examples/:id/retire', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const ok = await retireExample(req.params.id, `retired by ${req.user!.name}`);
  if (!ok) return res.status(404).json({ error: 'No such example, or already retired.' });
  res.json({ ok: true });
}));

// ── Per bid: what this run used, and "turn off for this bid" ───────────────
router.get('/bids/:bidId', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const { rows } = await pool.query('SELECT count_result, review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const cr = (rows[0]?.count_result as CountResult | null) ?? null;
  const items = (rows[0]?.review_items as ReviewItem[] | null) ?? [];
  const off = await learningOffFor(bidId);
  res.json({
    learning: cr?.learning ?? null,
    reviewHints: items.filter(i => i.lessonHints?.length).map(i => ({ itemId: i.id, title: i.title, hints: i.lessonHints })),
    off: { all: off.all, examples: [...off.examples], lessons: [...off.lessons] },
  });
}));

router.post('/bids/:bidId/off', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const refKind = req.body?.refKind;
  const refId = typeof req.body?.refId === 'string' ? req.body.refId : null;
  if (!['example', 'lesson', 'all'].includes(refKind) || (refKind !== 'all' && (!refId || !UUID_RE.test(refId)))) return res.status(400).json({ error: 'refKind example|lesson (with refId) or all' });
  if (req.body?.on === true) await clearLearningOff(bidId, refKind, refKind === 'all' ? null : refId);
  else await setLearningOff(bidId, refKind, refKind === 'all' ? null : refId, req.user!.name);
  const off = await learningOffFor(bidId);
  res.json({ off: { all: off.all, examples: [...off.examples], lessons: [...off.lessons] }, note: 'Takes effect on the next analysis run.' });
}));

export default router;
