// Level 2 learning — Settings → "Counting lessons & examples", and the
// per-bid "Learning used on this run" strip. Anyone signed in can read;
// approving / dismissing / retiring and the releases are admin-only (like
// account rules). Nothing here changes a count.
import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { loadAccessibleBid } from '../utils/ownership';
import { listLessons, listExamples, exampleCrop, retireExample, lessonLineage, getLesson, learningOffFor, setLearningOff, clearLearningOff, listReleases, activeRelease, createRelease, activateRelease, rollbackTo, getRelease, type LessonStatus } from '../ai/learning/learningDb';
import { checkAndRelease, EST_COST_USD } from '../services/learningCheck';
import { getSetting } from '../db/getSetting';
import { loadAIConfig } from './preconstruction';
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

// ── Releases (Task 14) ──────────────────────────────────────────────────────
router.get('/releases', requireAuth, asyncHandler(async (_req, res) => {
  const [releases, active, candidates, approved] = await Promise.all([
    listReleases(20), activeRelease(),
    pool.query(`SELECT count(*)::int AS n FROM symbol_examples WHERE status = 'candidate'`),
    pool.query(`SELECT count(*)::int AS n FROM counting_lessons WHERE status = 'approved'`),
  ]);
  res.json({ releases, activeId: active?.id ?? null, waiting: { examples: candidates.rows[0].n, lessons: approved.rows[0].n }, estimatedCost: EST_COST_USD });
}));

router.post('/releases', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  res.json({ release: await createRelease(req.user!.name) });
}));

router.post('/releases/:id/activate', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const out = await activateRelease(id);
  if (!out.ok) return res.status(400).json({ error: out.error });
  res.json({ ok: true });
}));

router.post('/releases/:id/rollback', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const out = await rollbackTo(id);
  if (!out.ok) return res.status(400).json({ error: out.error });
  res.json({ ok: true });
}));

// "Check and release" — Jake's button (L-D2): live model calls, so the
// dialog's explicit cost confirmation is required. Runs in the background.
router.post('/releases/:id/check', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  if (req.body?.confirmCost !== true) return res.status(400).json({ error: `Confirm the cost first (about ${EST_COST_USD} of AI calls).` });
  const rel = await getRelease(id);
  if (!rel) return res.status(404).json({ error: 'No such release.' });
  if (rel.status === 'checking') return res.status(409).json({ error: 'This release is already being checked.' });
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI.' });
  const config = await loadAIConfig();
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  void checkAndRelease(id, { client: new Anthropic({ apiKey }), model: config.modelCounter, maxTokens: config.maxTokensCounter, evidence: { model: config.modelEvidence, maxTokens: config.maxTokensEvidence } });
  res.status(202).json({ status: 'checking' });
}));

export default router;
