// Takeoff accuracy, Task 6 — the counting stage's located symbols become
// SUGGESTED markers (source 'ai_count') in the Phase B Plans view.
//
// Guarantees:
//   * suggested markers never roll up (rollupLines ignores status <>
//     'confirmed') — the estimator confirms them, per marker or per sheet;
//   * estimator work is never touched: a re-run soft-deletes only the
//     PREVIOUS run's still-suggested AI markers; anything confirmed stays,
//     and a new suggestion within 24 pt of a confirmed marker of the same type
//     (same label or same line) on the same page is not written again;
//   * a marker gets a line_key only when exactly ONE saved estimate line
//     matches its type — otherwise it is unassigned (label = the type tag);
//   * markers are written only for pages of plans-category PDF documents on
//     THIS bid (what the Plans view shows), and only when the page geometry
//     check passed (positions are trustworthy).
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { getPlanPdfDocuments } from './sheets';
import { getBidLines, type BidLineRow } from './bidEstimate';
import { rowMatchScore } from '../ai/countMerge';
import type { CountTarget } from '../ai/countTargets';
import type { CountResult } from '../ai/countingStage';

/** Same tolerance Phase B's S2 fix uses for "already marked" (suggestedMarkerFlow.ts). */
export const AI_MARKER_DEDUP_PT = 24;

export interface PipelineFileRef {
  /** The filename the pipeline saw (count_result.sheets[].file). */
  file: string;
  /** The documents row the bytes came from, when known (document_ids). */
  documentId?: string;
  size: number;
}

export interface AiMarkerWriteSummary {
  written: number;
  skippedAlreadyMarked: number;
  replacedSuggestions: number;
  assigned: number;
  unassigned: number;
  /** Per sheet: why no markers were written for it. */
  sheetsWithoutMarkers: Array<{ label: string; reason: string }>;
  /** Fix round 1 / S15 — where each counted sheet lives in the Plans view
   *  (document + page), so confirmed markers can be tied back to the sheets
   *  a type is counted from. */
  sheetDocuments?: Array<{ sheetKey: string; label: string; documentId: string; pageIndex: number }>;
}

/** Pure: the saved line a type maps to — exactly one line scoring an explicit
 *  tag or an exact description match, else null (ambiguous or none). */
export function lineForType(target: CountTarget, lines: Pick<BidLineRow, 'line_key' | 'description' | 'takeoff_key' | 'excluded'>[]): string | null {
  const hits = lines.filter(l => {
    if (l.excluded) return false;
    const item = (l.takeoff_key ?? '').split('||')[1]?.replace(/::\d+$/, '') ?? '';
    return rowMatchScore({ item: l.description, spec: item }, target) >= 2;
  });
  return hits.length === 1 ? hits[0].line_key : null;
}

/** Resolve each pipeline file to a plans-category document on this bid:
 *  its own documents row when it came from one, else the most recent plans
 *  PDF with the same name AND byte size. */
export async function resolveDocumentsForFiles(bidId: string, files: PipelineFileRef[]): Promise<Map<string, string>> {
  const docs = await getPlanPdfDocuments(bidId);
  const { rows } = docs.length
    ? await pool.query('SELECT id, name, file_size FROM documents WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC', [docs.map(d => d.id)])
    : { rows: [] as Array<{ id: string; name: string; file_size: number }> };
  const planIds = new Set(docs.map(d => d.id));
  const out = new Map<string, string>();
  for (const f of files) {
    if (f.documentId && planIds.has(f.documentId)) { out.set(f.file, f.documentId); continue; }
    const hit = rows.find(r => r.name === f.file && Number(r.file_size) === f.size && f.size > 0);
    if (hit) out.set(f.file, hit.id);
  }
  return out;
}

async function writeWithClient(
  client: PoolClient,
  bidId: string,
  countResult: CountResult,
  docByFile: Map<string, string>,
  lines: BidLineRow[],
): Promise<AiMarkerWriteSummary> {
  const summary: AiMarkerWriteSummary = { written: 0, skippedAlreadyMarked: 0, replacedSuggestions: 0, assigned: 0, unassigned: 0, sheetsWithoutMarkers: [], sheetDocuments: [] };
  for (const sheet of countResult.sheets) {
    const documentId = docByFile.get(sheet.file);
    if (documentId) summary.sheetDocuments!.push({ sheetKey: sheet.key, label: sheet.label, documentId, pageIndex: sheet.page - 1 });
  }
  const replaced = await client.query(
    `UPDATE est_markups SET deleted_at = now(), updated_at = now()
      WHERE bid_id = $1 AND source = 'ai_count' AND status = 'suggested' AND deleted_at IS NULL`,
    [bidId]
  );
  summary.replacedSuggestions = replaced.rowCount ?? 0;

  const lineByType = new Map(countResult.targets.map(t => [t.key, lineForType(t, lines)]));
  const typeByKey = new Map(countResult.targets.map(t => [t.key, t]));
  const confirmed = await client.query(
    `SELECT document_id, page_index, line_key, label, points FROM est_markups
      WHERE bid_id = $1 AND status = 'confirmed' AND kind = 'count' AND deleted_at IS NULL`,
    [bidId]
  );

  for (const sheet of countResult.sheets) {
    if (sheet.status !== 'counted') { summary.sheetsWithoutMarkers.push({ label: sheet.label, reason: 'sheet was not counted' }); continue; }
    if (!sheet.geometryOk) { summary.sheetsWithoutMarkers.push({ label: sheet.label, reason: 'page geometry check failed — counts kept, positions not trusted' }); continue; }
    const documentId = docByFile.get(sheet.file);
    if (!documentId) { summary.sheetsWithoutMarkers.push({ label: sheet.label, reason: 'the PDF is not filed under this bid\'s Plans, so the Plans view cannot show it' }); continue; }
    const pageIndex = sheet.page - 1;
    const already = confirmed.rows.filter(r => r.document_id === documentId && Number(r.page_index) === pageIndex);
    for (const m of countResult.marks.filter(x => x.sheetKey === sheet.key)) {
      const lineKey = lineByType.get(m.typeKey) ?? null;
      const tag = typeByKey.get(m.typeKey)?.type ?? m.typeKey;
      const dup = already.some(r => {
        const p = (r.points as Array<{ x: number; y: number }>)[0];
        if (!p || Math.hypot(p.x - m.x, p.y - m.y) > AI_MARKER_DEDUP_PT) return false;
        return (r.label && String(r.label).toUpperCase() === tag.toUpperCase()) || (lineKey && r.line_key === lineKey);
      });
      if (dup) { summary.skippedAlreadyMarked++; continue; }
      await client.query(
        `INSERT INTO est_markups (bid_id, document_id, page_index, line_key, kind, points, status, label, created_by, source, updated_at)
         VALUES ($1, $2, $3, $4, 'count', $5::jsonb, 'suggested', $6, 'AI counter', 'ai_count', now())`,
        [bidId, documentId, pageIndex, lineKey, JSON.stringify([{ x: m.x, y: m.y }]), tag]
      );
      summary.written++;
      if (lineKey) summary.assigned++; else summary.unassigned++;
    }
  }
  return summary;
}

/** Writes the counting stage's marks as suggested markers, in one
 *  transaction. Returns what happened, for count_result.markers. */
export async function writeAiCountMarkers(
  bidId: string,
  countResult: CountResult,
  files: PipelineFileRef[],
  /** Re-run reset — the analysis run these marks belong to. When given, the
   *  write happens only while that run is still the bid's current one: a
   *  run superseded by a re-run never puts markers back after the reset. */
  runId?: string | null,
): Promise<AiMarkerWriteSummary> {
  const docByFile = await resolveDocumentsForFiles(bidId, files);
  const lines = await getBidLines(bidId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (runId !== undefined) {
      const { rows } = await client.query('SELECT run_id, status FROM takeoff_results WHERE bid_id = $1 FOR SHARE', [bidId]);
      if ((rows[0]?.run_id ?? null) !== runId || rows[0]?.status === 'cancelled') {
        await client.query('ROLLBACK');
        return {
          written: 0, skippedAlreadyMarked: 0, replacedSuggestions: 0, assigned: 0, unassigned: 0,
          sheetsWithoutMarkers: [{ label: 'all sheets', reason: 'a newer analysis run started' }], sheetDocuments: [],
        };
      }
    }
    const summary = await writeWithClient(client, bidId, countResult, docByFile, lines);
    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** POST markups/assign-ai: assigns every still-UNASSIGNED, still-suggested AI
 *  marker whose label maps to exactly one saved line. Never reassigns a
 *  marker the estimator (or an earlier assignment) already placed on a line,
 *  and never touches confirmed markers. */
export async function assignAiMarkersToLines(bidId: string): Promise<{ assigned: number; stillUnassigned: number; updates: Array<{ id: string; lineKey: string }> }> {
  const lines = await getBidLines(bidId);
  const { rows: tr } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const targets = ((tr[0]?.count_result as CountResult | null)?.targets ?? []);
  const lineByTag = new Map(targets.map(t => [t.type.toUpperCase(), lineForType(t, lines)]));
  const { rows } = await pool.query(
    `SELECT id, label FROM est_markups
      WHERE bid_id = $1 AND source = 'ai_count' AND status = 'suggested' AND line_key IS NULL AND deleted_at IS NULL`,
    [bidId]
  );
  let assigned = 0;
  const updates: Array<{ id: string; lineKey: string }> = [];
  for (const r of rows) {
    const lineKey = lineByTag.get(String(r.label ?? '').toUpperCase()) ?? null;
    if (!lineKey) continue;
    const res = await pool.query(
      `UPDATE est_markups SET line_key = $1, updated_at = now() WHERE id = $2 AND line_key IS NULL AND status = 'suggested' AND deleted_at IS NULL`,
      [lineKey, r.id]
    );
    if ((res.rowCount ?? 0) > 0) { assigned++; updates.push({ id: r.id as string, lineKey }); }
  }
  return { assigned, stillUnassigned: rows.length - assigned, updates };
}
