import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { ensureProject } from '../utils/project';
import { commissionRate, commissionAmount } from '../utils/commission';
import {
  createSubfolders,
  moveJobToStage,
  AWARD_SUBFOLDER_NAMES,
  ESTIMATING_ACTIVE_BIDS_ROOT,
  ESTIMATING_SUBMITTED_BIDS_ROOT,
  ACTIVE_PROJECTS_ROOT,
} from './googleDrive';

// Phase 4 Task 1.3/3.1 — the shared bid stage-transition path. Extracted
// verbatim from PATCH /:id/stage (routes/bids.ts) so every entry point that
// moves a bid's stage — the manual pipeline drag, send-proposal's auto-
// advance due -> submitted, and the public e-sign route's auto-award ->
// awarded — produces IDENTICAL side effects (won_job, project registration,
// activity feed, Drive folder moves). Nothing here is new behavior; it is
// the existing PATCH /:id/stage body, unchanged, moved so it can be called
// from more than one route without copy-pasting it.

export type BidStage = 'due' | 'submitted' | 'awarded' | 'lost';
export const VALID_BID_STAGES: BidStage[] = ['due', 'submitted', 'awarded', 'lost'];

export interface BidStageTransitionOptions {
  lossReason?: string | null;
  competitor?: string | null;
}

export interface BidStageTransitionResult {
  bid: Record<string, any>;
  wonJob: Record<string, any> | null;
}

/**
 * Transition a bid to a new stage inside an ALREADY-OPEN transaction —
 * `client` must be between BEGIN and COMMIT, and `bid` must be the CURRENT
 * row (pre-transition), ideally fetched with `FOR UPDATE` in that same
 * transaction so a concurrent caller (e.g. a customer signing while the
 * estimator drags the pipeline card) can't race past this and double-award.
 * Caller commits and then calls applyBidStagePostCommit for the Drive side
 * effects — those must never run inside the DB transaction (Drive calls are
 * slow and must not hold a Postgres transaction open).
 */
export async function transitionBidStage(
  client: PoolClient,
  bid: Record<string, any>,
  stage: BidStage,
  opts: BidStageTransitionOptions = {},
): Promise<BidStageTransitionResult> {
  const { rows } = await client.query(
    `UPDATE bids SET stage=$1,
       loss_reason = CASE WHEN $1='lost' THEN $3 ELSE loss_reason END,
       competitor  = CASE WHEN $1='lost' THEN $4 ELSE competitor  END,
       updated_at=now(),
       submitted_at = CASE WHEN $1 IN ('submitted','awarded') THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
       awarded_at   = CASE WHEN $1 = 'awarded' THEN COALESCE(awarded_at, now()) ELSE awarded_at END
     WHERE id=$2 RETURNING *`,
    // FIX-9 (post-review) — `??` only falls back on null/undefined, so an
    // empty-string loss_reason/competitor (a form field cleared, then
    // submitted) stored '' instead of NULL — a behavior drift from main's
    // `||`, which treats '' the same as "not provided." Restored.
    [stage, bid.id, stage === 'lost' ? (opts.lossReason || null) : null, stage === 'lost' ? (opts.competitor || null) : null]
  );
  const updated = rows[0];

  let wonJob: Record<string, any> | null = null;
  if (stage === 'awarded' && bid.stage !== 'awarded') {
    const rate = await commissionRate();
    const { rows: wj } = await client.query(
      `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id,
                              commission_rate, commission_amount, commission_status, commission_earned_at)
       VALUES ($1,$2,$3,'Electrical',$4,$5,$6,$7,'earned',now())
       ON CONFLICT (proposal_id) DO NOTHING
       RETURNING *`,
      [bid.salesperson_name, bid.name, bid.id, bid.amount, bid.salesperson_id || null,
       rate, commissionAmount(bid.amount, rate)]
    );
    wonJob = wj[0] || null;

    // Awarded work becomes a first-class project (shares the bid id).
    await ensureProject(client, {
      id: bid.id, sourceType: 'elec', customerId: bid.customer_id,
      name: bid.name, contractValue: bid.amount,
    });

    await client.query(
      `INSERT INTO activity (kind, div, text)
       VALUES ('awarded','elec',$1)`,
      [`${bid.name} awarded — ${bid.salesperson_name}`]
    );
  } else if (stage !== bid.stage) {
    const labels: Record<string, string> = { due: 'Bids Due', submitted: 'Submitted', lost: 'Lost' };
    await client.query(
      `INSERT INTO activity (kind, div, text) VALUES ($1,'elec',$2)`,
      [stage === 'lost' ? 'lost' : 'new', `${bid.name} moved to ${labels[stage] || stage}`]
    );
  }

  return { bid: updated, wonJob };
}

/**
 * Fire-and-forget Drive side effects that must run AFTER the transaction
 * commits (moving the job folder to the new stage's root; on first award,
 * creating the award-only subfolders). Deliberately does not return a
 * promise the caller is expected to await — matches the pre-extraction
 * behavior in PATCH /:id/stage, where these always ran in the background so
 * a slow/misconfigured Drive integration never delayed the HTTP response.
 * `onError` lets each call site keep its own logger/console context.
 */
export function applyBidStagePostCommit(
  oldBid: Record<string, any>,
  stage: BidStage,
  onError: (err: unknown, phase: string) => void,
): void {
  if (oldBid.drive_job_folder_id && stage !== oldBid.stage) {
    const stageRoots: Record<string, string | undefined> = {
      due: ESTIMATING_ACTIVE_BIDS_ROOT,
      submitted: ESTIMATING_SUBMITTED_BIDS_ROOT,
      awarded: ACTIVE_PROJECTS_ROOT,
      // lost: no move — folder stays wherever it was.
    };
    const destRoot = stageRoots[stage];
    if (destRoot) {
      moveJobToStage(oldBid.drive_job_folder_id, oldBid.gc, destRoot)
        .catch(err => onError(err, 'moveJobToStage'));
    }
  }

  if (
    stage === 'awarded' && oldBid.stage !== 'awarded' &&
    oldBid.drive_job_folder_id && !oldBid.drive_submittals_folder_id
  ) {
    (async () => {
      try {
        const subfolders = await createSubfolders(oldBid.drive_job_folder_id, AWARD_SUBFOLDER_NAMES);
        await pool.query(
          `UPDATE bids SET
             drive_photos_folder_id=$1, drive_contracts_folder_id=$2,
             drive_submittals_folder_id=$3, drive_rfis_folder_id=$4,
             drive_change_orders_folder_id=$5
           WHERE id=$6`,
          [
            subfolders['Photos'] || null,
            subfolders['Contract & Invoices'] || null,
            subfolders['Submittals'] || null,
            subfolders['RFIs'] || null,
            subfolders['Change Orders'] || null,
            oldBid.id,
          ],
        );
      } catch (err) {
        onError(err, 'awardSubfolders');
      }
    })();
  }
}
