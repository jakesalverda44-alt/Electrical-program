import { pool } from '../db/pool';
import { logger } from './logger';
import { AuthRequest } from '../middleware/auth';

export interface AuditEntry {
  action: string;       // create | update | delete | restore | purge | award | merge | password_reset | ai_override
  entityType: string;   // user | settings | bid | gen | document | customer
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/** Who performed the action, for writeAuditAs — an authenticated user's id
 *  (when there is one) plus a display label. */
export interface AuditActor {
  id?: string | null;
  name: string | null;
}

/**
 * Record a money/identity/permission change in the audit log, attributed to
 * an explicit actor rather than an authenticated `req.user`.
 *
 * FIX-8 (post-review) — the public e-sign route (POST /bids/p/:token/sign)
 * awards a bid with no authenticated request to attribute it to; writeAudit
 * requires `req.user` and so silently skipped auditing that award entirely.
 * This sibling lets a public/system action still land an audit_log row,
 * with `user_id` left null and `user_name` carrying a label like
 * "Customer e-signature (<signerName>)" so the log reads clearly even
 * without a real user behind it.
 *
 * Call AFTER the underlying operation has succeeded (e.g. after COMMIT).
 * Auditing is best-effort: a failure here is logged but never propagated,
 * so it can't break or roll back the caller's request.
 */
export async function writeAuditAs(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, summary, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        actor.id ?? null,
        actor.name ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.summary ?? null,
        entry.before !== undefined ? JSON.stringify(entry.before) : null,
        entry.after !== undefined ? JSON.stringify(entry.after) : null,
      ]
    );
  } catch (err) {
    logger.error({ err, action: entry.action, entityType: entry.entityType }, 'Failed to write audit log');
  }
}

/**
 * Record a money/identity/permission change in the audit log.
 *
 * Call AFTER the underlying operation has succeeded (e.g. after COMMIT). Auditing
 * is best-effort: a failure here is logged but never propagated, so it can't break
 * or roll back the user's request.
 */
export async function writeAudit(req: AuthRequest, entry: AuditEntry): Promise<void> {
  return writeAuditAs({ id: req.user?.id ?? null, name: req.user?.name ?? null }, entry);
}

/**
 * Purge audit rows and trashed records older than the configured retention window.
 * Returns a small summary for logging. Intended to be called from the hourly
 * background job. Safe to run repeatedly.
 */
export async function purgeExpired(retentionMonths: number): Promise<Record<string, number>> {
  const months = Number.isFinite(retentionMonths) && retentionMonths > 0 ? Math.floor(retentionMonths) : 12;
  const cutoff = `${months} months`;
  const counts: Record<string, number> = {};
  const run = async (label: string, sql: string) => {
    const { rowCount } = await pool.query(sql, [cutoff]);
    if (rowCount) counts[label] = rowCount;
  };
  // Old audit rows.
  await run('audit_log', `DELETE FROM audit_log WHERE created_at < now() - $1::interval`);
  // Trashed records past the window are permanently removed.
  await run('bids', `DELETE FROM bids WHERE deleted_at IS NOT NULL AND deleted_at < now() - $1::interval`);
  await run('generator_proposals', `DELETE FROM generator_proposals WHERE deleted_at IS NOT NULL AND deleted_at < now() - $1::interval`);
  await run('documents', `DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < now() - $1::interval`);
  await run('won_jobs', `DELETE FROM won_jobs WHERE deleted_at IS NOT NULL AND deleted_at < now() - $1::interval`);
  return counts;
}
