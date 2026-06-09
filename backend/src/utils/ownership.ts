// Object-level authorization helpers. The app's visibility model is "managers
// see all, reps see own" (see utils/scope.ts): only restricted roles
// (salesperson) are limited to records they own. These helpers enforce that on
// routes that key off a bid id or a document's linked record, closing the IDOR
// gaps where any authenticated user could reach another rep's data by id.
import type { Response } from 'express';
import { pool } from '../db/pool';
import { ownScopeId } from './scope';

type ScopedUser = { id: string; role: string; name: string };

/**
 * Load a bid the user is allowed to act on. Mirrors loadOwnedBid() in routes/bids.ts:
 * sends 404 if the bid doesn't exist, 403 if a restricted user doesn't own it, and
 * returns null in both cases. Returns the bid row when access is allowed.
 */
export async function loadAccessibleBid(res: Response, user: ScopedUser, bidId: string) {
  const { rows } = await pool.query('SELECT * FROM bids WHERE id=$1 AND deleted_at IS NULL', [bidId]);
  if (!rows.length) { res.status(404).json({ error: 'Bid not found' }); return null; }
  const scope = ownScopeId(user);
  if (scope && rows[0].salesperson_id !== scope) {
    res.status(403).json({ error: 'You do not have access to this bid' });
    return null;
  }
  return rows[0];
}

/**
 * True if the given restricted scope (a salesperson_id) owns the bid or generator
 * proposal identified by linkedId. Documents and communications reference their
 * parent record by a free-text linked_id, so ownership is resolved through that
 * parent. Pass the result of ownScopeId(user); a null scope means "sees all".
 */
export async function ownsLinkedRecord(scope: string, linkedId: string | null | undefined): Promise<boolean> {
  if (!linkedId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM bids WHERE id::text=$1 AND salesperson_id=$2 AND deleted_at IS NULL
     UNION
     SELECT 1 FROM generator_proposals WHERE id::text=$1 AND salesperson_id=$2 AND deleted_at IS NULL
     LIMIT 1`,
    [linkedId, scope]
  );
  return rows.length > 0;
}
