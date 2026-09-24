// Next round A1/A3 — the sheet check routes (Documents step).
//
//   POST /api/preconstruction/:bidId/sheet-check/run   (multipart: files +
//        document_ids — the same inputs /analyze takes) -> starts a check in
//        the background; a newer check supersedes one still running.
//   GET  /api/preconstruction/:bidId/sheet-check       -> the inventory, the
//        references, what is missing, the estimator's decisions.
//   PUT  /api/preconstruction/:bidId/sheet-check       -> force a page in /
//        out (reason required), skip / un-skip a missing reference (reason
//        required), or skip every missing reference at once ("Run without
//        N sheets"). Re-applies the selection; no AI.
import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requireAIPermission, AuthRequest } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { asyncHandler } from '../utils/asyncHandler';
import { getSetting } from '../db/getSetting';
import { pool } from '../db/pool';
import { drawingUpload } from '../utils/upload';
import { gatherAnalysisInputs, loadAIConfig } from './preconstruction';
import {
  claimSheetCheck, runSheetCheck, loadSheetCheck, reselect, missingRefs, inputKeyOf,
  type SheetCheckRow, type PageOverride, type RefSkip,
} from '../services/sheetCheck';
import { isRealReason } from '../ai/reviewItems';

const router = Router();

/** What the Documents step renders. */
export function sheetCheckPayload(row: SheetCheckRow | null) {
  if (!row) return { status: 'idle' as const, pages: [], refs: [], missing: [], unclassifiedFiles: [], otherFiles: [], overrides: {}, skips: {}, error: null, checkedAt: null, inputKey: null };
  const missing = missingRefs(row.result, row.skips ?? {});
  return {
    status: row.status,
    pages: row.result?.pages ?? [],
    refs: row.result?.refs ?? [],
    missing,
    /** Missing references nobody skipped yet — the run button says
     *  "Run without N sheets" while this is > 0. */
    unskippedMissing: missing.filter(m => !m.skip).length,
    unclassifiedFiles: row.result?.unclassifiedFiles ?? [],
    otherFiles: row.result?.otherFiles ?? [],
    overrides: row.overrides ?? {},
    skips: row.skips ?? {},
    error: row.error,
    checkedAt: row.result?.checkedAt ?? null,
    inputKey: row.input_key,
  };
}

router.get('/:bidId/sheet-check', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;
  res.json(sheetCheckPayload(await loadSheetCheck(req.params.bidId)));
}));

router.post('/:bidId/sheet-check/run', requireAuth, requireAIPermission('run_analysis'), drawingUpload.array('files', 50),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const bidId = req.params.bidId;
    const bid = await loadAccessibleBid(res, req.user!, bidId);
    if (!bid) return;
    const rawDocIds = req.body.document_ids;
    const docIds: string[] = Array.isArray(rawDocIds)
      ? (rawDocIds as string[]).filter(Boolean)
      : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];
    const { files } = await gatherAnalysisInputs(bidId, (req.files as Express.Multer.File[]) ?? [], docIds);
    if (!files.length) {
      // Nothing to check: an empty, complete check (the panel shows nothing).
      await pool.query(
        `INSERT INTO bid_sheet_check (bid_id, status, result, input_key, finished_at, updated_at)
         VALUES ($1, 'complete', NULL, '', now(), now())
         ON CONFLICT (bid_id) DO UPDATE SET status='complete', result=NULL, input_key='', run_token=NULL, finished_at=now(), updated_at=now()`,
        [bidId]);
      return res.json(sheetCheckPayload(await loadSheetCheck(bidId)));
    }
    const inputKey = inputKeyOf(files);
    const token = await claimSheetCheck(bidId, inputKey);
    // No key: the check still runs from the cache and the text layer; files
    // it has never seen are listed as unclassified (the analysis will
    // classify them itself).
    const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
    const config = await loadAIConfig();
    const client = apiKey ? new Anthropic({ apiKey }) : null;
    res.json({ ...sheetCheckPayload(await loadSheetCheck(bidId)), status: 'running' });
    void runSheetCheck(bidId, token, files.map(f => ({ originalname: f.originalname, buffer: f.buffer, documentId: (f as { documentId?: string }).documentId })), {
      client, classifierModel: config.modelClassifier, visionModel: config.modelRefVision, aiRefs: true,
    });
  }));

router.put('/:bidId/sheet-check', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  const row = await loadSheetCheck(bidId);
  if (!row?.result) return res.status(409).json({ error: 'The sheet check has not run for this bid yet.' });
  const action = String(req.body?.action ?? '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const by = req.user?.name || req.user?.email || 'estimator';
  const at = new Date().toISOString();
  const overrides: Record<string, PageOverride> = { ...(row.overrides ?? {}) };
  const skips: Record<string, RefSkip> = { ...(row.skips ?? {}) };

  if (action === 'include' || action === 'exclude' || action === 'clear') {
    const pageKey = String(req.body?.pageKey ?? '');
    if (!row.result.pages.some(p => p.key === pageKey)) return res.status(404).json({ error: 'That page is not in this sheet check.' });
    if (action === 'clear') delete overrides[pageKey];
    else {
      if (!isRealReason(reason)) return res.status(400).json({ error: 'Give a reason (at least 10 characters).' });
      overrides[pageKey] = { decision: action, reason, by, at };
    }
  } else if (action === 'skip' || action === 'unskip') {
    const refId = String(req.body?.refId ?? '');
    if (!row.result.refs.some(r => r.id === refId && r.status === 'missing')) return res.status(404).json({ error: 'That reference is not missing in this sheet check.' });
    if (action === 'unskip') delete skips[refId];
    else {
      if (!isRealReason(reason)) return res.status(400).json({ error: 'Give a reason (at least 10 characters).' });
      skips[refId] = { reason, by, at };
    }
  } else if (action === 'skip_all_missing') {
    // "Run without N sheets" — every missing reference nobody skipped yet is
    // recorded as not provided (it becomes a proposal clarification).
    const why = isRealReason(reason) ? reason : 'Not provided at time of bid — analysis run without it';
    for (const m of missingRefs(row.result, skips)) if (!m.skip) skips[m.id] = { reason: why, by, at, auto: true };
  } else {
    return res.status(400).json({ error: 'Unknown action.' });
  }
  await pool.query('UPDATE bid_sheet_check SET overrides=$2, skips=$3, updated_at=now() WHERE bid_id=$1',
    [bidId, JSON.stringify(overrides), JSON.stringify(skips)]);
  res.json(sheetCheckPayload(await reselect(bidId)));
}));

export default router;
