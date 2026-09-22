// Shared comp-count/confidence helper, extracted from routes/estimates.ts's
// PUT handler (Task 5 of the estimating labor engine plan) so the new
// estimating/bidEstimate.ts doesn't duplicate the query. Behavior is
// byte-for-byte what estimates.ts computed inline before this extraction.
import { pool } from '../db/pool';

export interface BidCompResult {
  compCount: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Count awarded bids of the same project_type with a known amount (either a
 * saved estimate or an imported past bid), excluding the bid itself, and
 * derive a HIGH/MEDIUM/LOW confidence from that count.
 */
export async function computeBidComps(bidId: string): Promise<BidCompResult> {
  const { rows: bidRows } = await pool.query(
    'SELECT project_type FROM bids WHERE id = $1 AND deleted_at IS NULL',
    [bidId]
  );
  let compCount = 0;
  if (bidRows.length && bidRows[0].project_type) {
    const { rows: comps } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM bids b
       WHERE b.stage = 'awarded' AND b.project_type = $1 AND b.amount IS NOT NULL
         AND b.id != $2 AND b.deleted_at IS NULL`,
      [bidRows[0].project_type, bidId]
    );
    compCount = comps[0]?.cnt ?? 0;
  }
  const confidence = compCount >= 3 ? 'HIGH' : compCount >= 1 ? 'MEDIUM' : 'LOW';
  return { compCount, confidence };
}
