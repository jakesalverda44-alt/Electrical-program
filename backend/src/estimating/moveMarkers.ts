// Move markers off a deleted copy of the plans onto the bid's CURRENT copy.
// Explicit, never automatic (Jake approved 2026-09-30): the Plans banner offers
// the action per deleted copy. Nothing is ever deleted — a marker only changes
// its document_id, and only when the current copy has that same page with the
// same size and rotation; every other marker stays where it is and is counted
// as skipped.
import { pool } from '../db/pool';
import { getPlanPdfDocuments } from './sheets';

export class MoveMarkersError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

export interface MoveMarkersResult { moved: number; skipped: number; targetDocumentId: string; }

async function pageCounts(docIds: string[]): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT document_id, count(*)::int AS n FROM est_sheets WHERE document_id = ANY($1::uuid[]) GROUP BY 1`,
    [docIds]
  );
  return new Map(rows.map(r => [r.document_id as string, Number(r.n)]));
}

export async function moveMarkersFromDeletedCopy(bidId: string, fromDocumentId: string): Promise<MoveMarkersResult> {
  const { rows: fromRows } = await pool.query(
    `SELECT id, name, content_sha256 FROM documents WHERE id = $1 AND linked_id = $2 AND category = 'plans'`,
    [fromDocumentId, bidId]
  );
  const from = fromRows[0] as { id: string; name: string; content_sha256: string | null } | undefined;
  if (!from) throw new MoveMarkersError(404, 'That plan copy was not found on this bid');

  const current = await getPlanPdfDocuments(bidId);
  if (current.some(d => d.id === from.id)) throw new MoveMarkersError(400, 'That copy is still part of the current plans');

  let target: { id: string } | undefined;
  const sha = from.content_sha256 ?? null;
  const bySha = sha ? current.filter(d => d.content_sha256 === sha) : [];
  if (bySha.length > 0) {
    target = bySha[0]; // identical content — any copy is the same pages
  } else {
    const byName = current.filter(d => d.name.trim().toLowerCase() === from.name.trim().toLowerCase());
    if (byName.length === 1) target = byName[0];
    else if (byName.length === 0) {
      const counts = await pageCounts([from.id, ...current.map(d => d.id)]);
      const fromPages = counts.get(from.id) ?? 0;
      const byPages = fromPages > 0 ? current.filter(d => counts.get(d.id) === fromPages) : [];
      if (byPages.length === 1) target = byPages[0];
    }
  }
  if (!target) {
    throw new MoveMarkersError(409,
      'Could not find exactly one current copy of these plans to move the markers onto. Nothing was changed.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: total } = await client.query(
      `SELECT count(*)::int AS n FROM est_markups WHERE bid_id = $1 AND document_id = $2 AND deleted_at IS NULL`,
      [bidId, from.id]
    );
    const { rows: movedRows } = await client.query(
      `UPDATE est_markups m SET document_id = $3, updated_at = now()
         FROM est_sheets fs, est_sheets ts
        WHERE m.bid_id = $1 AND m.document_id = $2 AND m.deleted_at IS NULL
          AND fs.document_id = m.document_id AND fs.page_index = m.page_index
          AND ts.document_id = $3 AND ts.page_index = m.page_index
          AND abs(fs.width_pt - ts.width_pt) <= 1 AND abs(fs.height_pt - ts.height_pt) <= 1
          AND coalesce(fs.rotation, 0) = coalesce(ts.rotation, 0)
        RETURNING m.id`,
      [bidId, from.id, target.id]
    );
    await client.query('COMMIT');
    const moved = movedRows.length;
    const skipped = Number(total[0].n) - moved;
    if (moved > 0) {
      await pool.query(
        `INSERT INTO activity (kind, div, text) VALUES ('markers_moved','elec',$1)`,
        [`${moved} plan marker${moved === 1 ? '' : 's'} moved from a deleted copy of ${from.name} to the current plans`]
      ).catch(() => { /* best-effort audit line */ });
    }
    return { moved, skipped, targetDocumentId: target.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
