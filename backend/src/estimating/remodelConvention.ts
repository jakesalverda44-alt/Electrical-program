// Remodel reading round, fix B3 — the estimator's "how are new vs existing
// shown?" answer, persisted per bid (migration 148) so the re-run it asks
// for can apply it: beginAnalysisRun wipes review_items, never this.
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { CONVENTION_OPTIONS } from '../ai/remodel/status';

export const REMODEL_CONVENTION_ITEM = 'remodel:conventions';

/** Inside the resolve transaction: an answer is stored (upsert); a reopen
 *  (no resolution) removes it. Only valid options are ever stored. */
export async function saveRemodelConvention(c: PoolClient, bidId: string, answer: string | null, by: string): Promise<void> {
  if (answer && (CONVENTION_OPTIONS as readonly string[]).includes(answer)) {
    await c.query(
      `INSERT INTO bid_remodel_convention (bid_id, answer, answered_by, answered_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (bid_id) DO UPDATE SET answer = EXCLUDED.answer, answered_by = EXCLUDED.answered_by, answered_at = now()`,
      [bidId, answer, by]);
  } else {
    await c.query('DELETE FROM bid_remodel_convention WHERE bid_id = $1', [bidId]);
  }
}

/** The counting stage's remodel input: the bid's build type and the
 *  persisted answer. */
export async function loadRemodelInput(bidId: string): Promise<{ buildType: string | null; answer: string | null }> {
  const { rows } = await pool.query(
    'SELECT b.build_type, c.answer FROM bids b LEFT JOIN bid_remodel_convention c ON c.bid_id = b.id WHERE b.id = $1', [bidId]);
  return { buildType: (rows[0]?.build_type as string | null) ?? null, answer: (rows[0]?.answer as string | null) ?? null };
}
