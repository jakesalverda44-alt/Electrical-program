// Level 2 learning, Task 10 — the harvester: pending captures → cropped,
// hashed CANDIDATE examples. Off the request path (debounced 30 s per bid,
// plus a boot sweep); a failure marks the capture 'failed' and never
// reaches the user. One pdftoppm raster per (document, page) per pass; at
// most 200 captures per pass. Crops come from the SAME 300-DPI grayscale
// raster the counter's tiles are cut from.
import { pool } from '../../db/pool';
import { logger } from '../../utils/logger';
import { loadDocumentBytes } from '../../utils/backfillContentHashes';
import { getBidLines } from '../../estimating/bidEstimate';
import { lineForType } from '../../estimating/aiMarkers';
import { rasterizeGray, renderSymbolCrops, COUNT_DPI } from '../countRender';
import { pdfToDisplayedIn, viewportAt, type Viewport } from '../evidence/viewports';
import { looksLikeFixture } from '../remodel/unlisted';
import type { CountResult } from '../countingStage';
import type { CountTarget } from '../countTargets';
import { meaningOf, type Meaning } from './meaning';
import { dhash64, CROP_HALF_IN } from './visualHash';
import { pendingCaptures, markCapture, insertExample, retireExamplesBySource, type CaptureRow, type NewExample } from './learningDb';

export const HARVEST_DEBOUNCE_MS = 30_000;
export const HARVEST_CAP = 200;

interface SheetDoc { sheetKey: string; label?: string; documentId: string; pageIndex: number }
interface BidCtx { cr: CountResult | null; ruleId: string | null; projectType: string | null; lines: Awaited<ReturnType<typeof getBidLines>>; runId: string | null }

async function bidContext(bidId: string): Promise<BidCtx> {
  const { rows } = await pool.query(`SELECT tr.count_result, tr.account_terms->>'ruleId' AS rule_id, tr.run_id, b.project_type FROM bids b LEFT JOIN takeoff_results tr ON tr.bid_id = b.id WHERE b.id = $1`, [bidId]);
  return { cr: (rows[0]?.count_result as CountResult | null) ?? null, ruleId: (rows[0]?.rule_id as string | null) ?? null, projectType: (rows[0]?.project_type as string | null) ?? null,
    lines: await getBidLines(bidId).catch(() => []), runId: (rows[0]?.run_id as string | null) ?? null };
}

/** A marker's type → the count target (by tag, else the one line it sits on). */
export function targetFor(cr: CountResult | null, t: { label?: string | null; lineKey?: string | null }, lines: BidCtx['lines']): CountTarget | null {
  const targets = cr?.targets ?? [];
  const label = String(t.label ?? '').trim().toUpperCase();
  if (label) {
    const hit = targets.filter(x => x.type.toUpperCase() === label || x.key.toUpperCase() === label);
    if (hit.length === 1) return hit[0];
  }
  if (t.lineKey) {
    const hit = targets.filter(x => lineForType(x, lines) === t.lineKey);
    if (hit.length === 1) return hit[0];
  }
  return null;
}

const NOT_A_DEVICE = (category: string): Meaning => ({ label: '', description: 'not a device', category, deviceClass: null, meaningFp: 'device not' });

/** Turns one capture into example rows (meaning + where to crop), or a skip reason. */
export function planCapture(c: CaptureRow, ctx: BidCtx): { examples: Array<Omit<NewExample, 'crop' | 'dhash' | 'sourceDocSha'> & { sheetKey: string }> } | { skip: string } {
  const cr = ctx.cr;
  const docs = ((cr as unknown as { markers?: { sheetDocuments?: SheetDoc[] } })?.markers?.sheetDocuments) ?? [];
  const p = c.payload as Record<string, unknown> & { point?: { x: number; y: number }; to?: { label: string | null; lineKey: string | null }; from?: { label: string | null; lineKey: string | null } };
  const sheetKey = (p.sheetKey as string | undefined) ?? docs.find(d => d.documentId === p.documentId && d.pageIndex === p.pageIndex)?.sheetKey;
  if (!sheetKey || !p.point) return { skip: 'the marker is not on a counted sheet of the latest run' };
  const base = {
    halfIn: CROP_HALF_IN, sourceKind: c.kind as NewExample['sourceKind'],
    sourceRef: { ...(p.markupId ? { markupId: String(p.markupId) } : {}), ...(p.itemId ? { itemId: String(p.itemId) } : {}), ...(p.memberKey ? { memberKey: String(p.memberKey) } : {}), runId: ctx.runId },
    sourceBidId: c.bidId, pageIndex: null as number | null, sheetLabel: null as string | null, xPt: p.point.x, yPt: p.point.y,
    accountRuleId: ctx.ruleId, projectType: ctx.projectType, quality: Number(p.quality ?? 1), verifiedBy: (p.by as string | undefined) ?? null, sheetKey,
  };
  const quote = (t: CountTarget) => `${t.symbolHint ? `${t.symbolHint} — ` : ''}${t.description}${t.sourceSheet ? ` (${t.sourceSheet})` : ''}`;
  switch (c.kind) {
    case 'marker_create': case 'marker_move': case 'marker_confirm': {
      const t = targetFor(cr, p.to ?? {}, ctx.lines);
      if (!t) return { skip: 'the marker type maps to no single count target' };
      return { examples: [{ ...base, polarity: 'positive', meaning: meaningOf(t), legendQuote: quote(t) }] };
    }
    case 'marker_reclass': {
      const to = targetFor(cr, p.to ?? {}, ctx.lines);
      const from = targetFor(cr, p.from ?? {}, ctx.lines);
      if (!to) return { skip: 'the new type maps to no single count target' };
      return { examples: [
        { ...base, polarity: 'positive', meaning: meaningOf(to), legendQuote: quote(to) },
        ...(from ? [{ ...base, polarity: 'negative' as const, meaning: meaningOf(to), confusedWith: meaningOf(from), legendQuote: quote(to) }] : []),
      ] };
    }
    case 'marker_delete': {
      const from = targetFor(cr, p.from ?? {}, ctx.lines);
      if (!from) return { skip: 'the deleted marker maps to no single count target' };
      return { examples: [{ ...base, polarity: 'negative', meaning: NOT_A_DEVICE(from.category), confusedWith: meaningOf(from), notADevice: true, legendQuote: quote(from) }] };
    }
    case 'review_unlisted': {
      const tag = String(p.tag ?? '');
      const reason = String(p.reason ?? '').replace(new RegExp(`^\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'i'), '').replace(/["”]?\s*[×x]\s*\d+\s*$/, '').trim();
      const m = meaningOf({ type: tag, description: reason, category: looksLikeFixture(String(p.symbol ?? '')) ? 'interior_lighting' : 'device' });
      return { examples: [{ ...base, polarity: 'positive', meaning: m, legendQuote: `unlisted tag ${tag} drawn as ${String(p.symbol ?? '')}; answered "${reason}"` }] };
    }
    case 'review_pole_type': {
      const m = meaningOf({ description: `${String(p.poleType ?? '')} (${String(p.hostNoun ?? 'power pole')})`, category: 'equipment' });
      return { examples: [{ ...base, polarity: 'positive', meaning: m, legendQuote: String(p.poleType ?? '') }] };
    }
    default:
      return { skip: `nothing to crop for ${c.kind}` };
  }
}

export interface HarvestDeps { rasterize: typeof rasterizeGray; loadPdf: (documentId: string) => Promise<{ bytes: Buffer; sha: string | null } | null> }
const defaultDeps: HarvestDeps = {
  rasterize: rasterizeGray,
  loadPdf: async (documentId: string) => {
    const { rows } = await pool.query('SELECT file_data, storage_url, content_sha256, deleted_at FROM documents WHERE id = $1', [documentId]);
    if (!rows[0] || rows[0].deleted_at) return null;
    const bytes = await loadDocumentBytes(rows[0]);
    return bytes ? { bytes, sha: (rows[0].content_sha256 as string | null) ?? null } : null;
  },
};

export interface HarvestResult { done: number; skipped: number; failed: number; examples: number; rasters: number; /** the pass hit its cap: more captures may be waiting */ capped?: boolean }

type UndoRef = { markupId?: string; itemId?: string; memberKey?: string };
/** B2: does a LATER undo row of the same batch cancel this capture (confirm→unconfirm, answer→reopen inside the debounce)? */
function undoneLater(cap: CaptureRow, all: CaptureRow[]): boolean {
  return all.some(u => {
    if (u.kind !== 'undo' || u.id <= cap.id || u.bidId !== cap.bidId) return false;
    const r = u.payload as UndoRef;
    const p = cap.payload as UndoRef;
    if (r.markupId) return p.markupId === r.markupId;
    if (r.itemId) return p.itemId === r.itemId && (!r.memberKey || p.memberKey === r.memberKey);
    return false;
  });
}

/** One pass over the pending captures (all bids, or one). Never throws. */
export async function runHarvest(opts: { bidId?: string; limit?: number; deps?: Partial<HarvestDeps> } = {}): Promise<HarvestResult> {
  const deps = { ...defaultDeps, ...(opts.deps ?? {}) };
  const res: HarvestResult = { done: 0, skipped: 0, failed: 0, examples: 0, rasters: 0 };
  let caps: CaptureRow[];
  try { caps = await pendingCaptures({ bidId: opts.bidId, limit: opts.limit ?? HARVEST_CAP }); } catch (err) { logger.warn({ err }, '[learning] harvest: could not read captures'); return res; }
  const ctxCache = new Map<string, BidCtx>();
  const ctxOf = async (bidId: string) => ctxCache.get(bidId) ?? ctxCache.set(bidId, await bidContext(bidId)).get(bidId)!;
  // 1. plan every capture; 2. group by (document, page); 3. one raster each.
  type Job = { cap: CaptureRow; ex: Array<Omit<NewExample, 'crop' | 'dhash' | 'sourceDocSha'> & { sheetKey: string }>; documentId: string; page: number; centreIn: { x: number; y: number } };
  const jobs: Job[] = [];
  for (const cap of caps) {
    try {
      if (cap.kind === 'undo') {
        const p = cap.payload as { markupId?: string; itemId?: string; memberKey?: string };
        await retireExamplesBySource({ bidId: cap.bidId, ...p });
        await markCapture(cap.id, 'done'); res.done++;
        continue;
      }
      if (undoneLater(cap, caps)) { await markCapture(cap.id, 'skipped', 'undone before it was harvested'); res.skipped++; continue; }
      const ctx = await ctxOf(cap.bidId);
      const plan = planCapture(cap, ctx);
      if ('skip' in plan) { await markCapture(cap.id, 'skipped', plan.skip); res.skipped++; continue; }
      const sheetKey = plan.examples[0].sheetKey;
      const sheet = (ctx.cr?.sheets ?? []).find(s => s.key === sheetKey);
      const docs = ((ctx.cr as unknown as { markers?: { sheetDocuments?: SheetDoc[] } })?.markers?.sheetDocuments) ?? [];
      const doc = docs.find(d => d.sheetKey === sheetKey);
      if (!sheet || !doc) { await markCapture(cap.id, 'skipped', 'the sheet is not in the latest run'); res.skipped++; continue; }
      if (!sheet.geometryOk || !sheet.geometry) { await markCapture(cap.id, 'skipped', 'the sheet geometry is not trustworthy (geometryOk=false)'); res.skipped++; continue; }
      const pt = cap.payload.point as { x: number; y: number };
      const at = pdfToDisplayedIn(pt.x, pt.y, sheet.geometry);
      const vp = viewportAt((sheet.viewports ?? []) as Viewport[], at.x, at.y);
      if (vp && vp.kind !== 'main_plan' && vp.kind !== 'enlarged_plan') { await markCapture(cap.id, 'skipped', `the point is in a ${vp.kind.replace(/_/g, ' ')}, not a plan`); res.skipped++; continue; }
      jobs.push({ cap, ex: plan.examples.map(e => ({ ...e, pageIndex: doc.pageIndex, sheetLabel: sheet.label })), documentId: doc.documentId, page: sheet.page, centreIn: at });
    } catch (err) {
      await markCapture(cap.id, 'failed', err instanceof Error ? err.message : String(err)).catch(() => {});
      res.failed++;
    }
  }
  const byPage = new Map<string, Job[]>();
  for (const j of jobs) { const k = `${j.documentId}#${j.page}`; byPage.set(k, [...(byPage.get(k) ?? []), j]); }
  for (const [, js] of byPage) {
    try {
      const pdf = await deps.loadPdf(js[0].documentId);
      if (!pdf) { for (const j of js) { await markCapture(j.cap.id, 'skipped', 'the plan document is gone'); res.skipped++; } continue; }
      const raster = await deps.rasterize(pdf.bytes, js[0].page, COUNT_DPI);
      res.rasters++;
      const crops = await renderSymbolCrops(raster, js.map(j => j.centreIn), CROP_HALF_IN, COUNT_DPI);
      for (const [i, j] of js.entries()) {
        try {
          const dh = await dhash64(crops[i]);
          for (const e of j.ex) {
            const { sheetKey: _s, ...rest } = e;
            if (await insertExample({ ...rest, crop: crops[i], dhash: dh, sourceDocSha: pdf.sha })) res.examples++;
          }
          await markCapture(j.cap.id, 'done'); res.done++;
        } catch (err) {
          await markCapture(j.cap.id, 'failed', err instanceof Error ? err.message : String(err)).catch(() => {});
          res.failed++;
        }
      }
    } catch (err) {
      for (const j of js) { await markCapture(j.cap.id, 'failed', err instanceof Error ? err.message : String(err)).catch(() => {}); res.failed++; }
    }
  }
  res.capped = caps.length >= (opts.limit ?? HARVEST_CAP);
  return res;
}

const timers = new Map<string, NodeJS.Timeout>();
/** Debounced harvest for one bid (fire-and-forget; never in a request's path). */
export function scheduleHarvest(bidId: string): void {
  if (process.env.NODE_ENV === 'test') return;
  const t = timers.get(bidId);
  if (t) clearTimeout(t);
  timers.set(bidId, setTimeout(() => { timers.delete(bidId); void runHarvest({ bidId }).then(r => { if (r.capped) scheduleHarvest(bidId); }).catch(err => logger.warn({ err, bidId }, '[learning] harvest failed')); }, HARVEST_DEBOUNCE_MS));
}

/** Boot sweep: whatever is still pending from before a restart. */
export async function harvestOnBoot(): Promise<void> {
  try { for (let i = 0; i < 20; i++) { const r = await runHarvest({}); if (r.done || r.failed) logger.info(r, '[learning] boot harvest'); if (!r.capped) break; } } catch (err) { logger.warn({ err }, '[learning] boot harvest failed'); }
}

/** Enqueue + schedule, fire-and-forget (the caller never awaits a failure). */
export async function captureAndSchedule(bidId: string, caps: Array<{ kind: CaptureRow['kind']; payload: Record<string, unknown> }>): Promise<void> {
  if (!caps.length) return;
  try {
    const { enqueueCaptures } = await import('./learningDb');
    await enqueueCaptures(caps.map(c => ({ bidId, ...c })));
    scheduleHarvest(bidId);
  } catch (err) {
    logger.warn({ err, bidId }, '[learning] could not enqueue captures (non-fatal)');
  }
}
