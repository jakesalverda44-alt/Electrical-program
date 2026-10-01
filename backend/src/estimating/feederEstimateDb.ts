// Accuracy round C6/C7 — what the feeder estimate reads from the DB for one
// bid: every confirmed count pin (an estimator's "Panel B" / "Transformer"
// marker), the est_feeder_estimate setting, and the text runs of the bid's
// vector site / utility / photometric sheets (pdf.js, cached per file + page
// in sheet_evidence_cache as kind 'feeder-textruns'). Reads only, except the
// text-run cache. A failure never breaks a sync: the estimate just has less.
import { pool } from '../db/pool';
import { dbEvidenceCache } from '../services/evidenceCache';
import { readPagesText } from '../ai/evidence/evidenceStage';
import type { FeederEstimateInput } from './feederEstimate';

export const FEEDER_TEXT_CACHE_KIND = 'feeder-textruns';
export const FEEDER_TEXT_CACHE_KEY = 'v1';
const ANCHOR_RE = /SCALE|TRANSFORMER|XFMR|METER|SERVICE|BLDG|PANEL/i;
const SITE_TITLE_RE = /utility|\bsite\b|photometric|electrical site|civil/i;

type Run = { str: string; x: number; y: number; w: number; h: number };

/** The runs within 400 pt of an anchor word (the scale bar, equipment labels). */
export function anchorRuns(runs: Run[]): Run[] {
  const anchors = runs.filter(r => ANCHOR_RE.test(r.str));
  const c = (r: Run) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  return runs.filter(r => anchors.some(a => { const A = c(a), B = c(r); return Math.hypot(A.x - B.x, A.y - B.y) <= 400; }))
    .map(r => ({ str: r.str, x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) }));
}

interface InventoryLike { file: string; page: number; title?: string; sheetNo?: string; discipline?: string; cls?: string; textChars?: number }

/** Inventory pages worth a text read: vector site / utility / photometric plans. */
export function feederTextPages(inventory: InventoryLike[]): InventoryLike[] {
  return (inventory ?? []).filter(p => (p.textChars ?? 0) >= 2000 && p.cls === 'plan' && SITE_TITLE_RE.test(`${p.title ?? ''}`));
}

export async function loadFeederContext(bidId: string): Promise<NonNullable<import('./footageAllowanceDb').GeneratedRowsInputs['feeders']>> {
  const [{ rows: pins }, { rows: settingRows }, { rows: tr }] = await Promise.all([
    pool.query(`SELECT document_id, page_index, label, points FROM est_markups
                 WHERE bid_id = $1 AND kind = 'count' AND deleted_at IS NULL AND status = 'confirmed' AND label IS NOT NULL`, [bidId]),
    pool.query(`SELECT value FROM app_settings WHERE key = 'est_feeder_estimate'`),
    pool.query('SELECT prep_inventory FROM takeoff_results WHERE bid_id = $1', [bidId]),
  ]);
  const textSheets: FeederEstimateInput['textSheets'] = [];
  try {
    const pages = feederTextPages((tr[0]?.prep_inventory as InventoryLike[] | null) ?? []);
    const byFile = new Map<string, InventoryLike[]>();
    for (const p of pages) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
    for (const [file, ps] of byFile) {
      const { rows: docs } = await pool.query(
        `SELECT id, content_sha256 FROM documents WHERE linked_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [bidId, file]);
      const doc = docs[0];
      if (!doc?.content_sha256) continue;
      const need: InventoryLike[] = [];
      for (const p of ps) {
        const hit = await dbEvidenceCache.get(doc.content_sha256, p.page, FEEDER_TEXT_CACHE_KIND, FEEDER_TEXT_CACHE_KEY) as { geometry: TextSheetGeom; runs: Run[] } | null;
        if (hit) textSheets.push(toSheet(file, p, doc.id, hit));
        else need.push(p);
      }
      if (!need.length) continue;
      const { rows: data } = await pool.query('SELECT file_data FROM documents WHERE id = $1', [doc.id]);
      if (!data[0]?.file_data) continue;
      const read = await readPagesText(Buffer.from(data[0].file_data as string, 'base64'), need.map(p => p.page));
      for (const p of need) {
        const got = read.get(p.page);
        if (!got) continue;
        const value = { geometry: got.geometry, runs: anchorRuns(got.runs) };
        await dbEvidenceCache.set(doc.content_sha256, p.page, FEEDER_TEXT_CACHE_KIND, FEEDER_TEXT_CACHE_KEY, value).catch(() => undefined);
        textSheets.push(toSheet(file, p, doc.id, value));
      }
    }
  } catch (err) {
    console.error('[feeders] text runs could not be read', err);
  }
  return {
    pins: pins as FeederEstimateInput['pins'],
    textSheets,
    settingsRaw: settingRows[0]?.value as string | undefined,
    deckFt: null,
  };
}

type TextSheetGeom = { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number };
function toSheet(file: string, p: InventoryLike, documentId: string, v: { geometry: TextSheetGeom; runs: Run[] }): FeederEstimateInput['textSheets'][number] {
  return { sheetKey: `${file}#${p.page}`, label: `${p.sheetNo || `p${p.page}`} "${p.title ?? ''}"`, geometry: v.geometry, runs: v.runs, documentId, pageIndex: p.page - 1, site: true };
}
