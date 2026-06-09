import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import {
  loadAIConfig, resumeFromAgent2, resumeFromAgent3, runAgent4,
} from './pipeline';

/**
 * Recovery for AI pipeline runs orphaned by a crash or redeploy.
 *
 * A live run stamps worker_heartbeat_at every 15s, so anything still marked
 * in-progress with a stale heartbeat has no worker. Two cases:
 *
 *  - Agent 1 in flight (status 'running'): the uploaded file buffers died with
 *    the old process, so the run is marked as a terminal error telling the user
 *    to re-run.
 *  - Agents 2-4 in flight or queued: their inputs are persisted in
 *    takeoff_results, so the run is resumed from the last completed agent.
 *
 * Rows are claimed atomically (heartbeat re-stamp guarded by the staleness
 * check) so concurrent instances never resume the same job twice.
 */

const STALE = "interval '2 minutes'";
const stale = `(worker_heartbeat_at IS NULL OR worker_heartbeat_at < now() - ${STALE})`;

const AGENT1_INTERRUPTED_MSG =
  'Analysis interrupted: the server restarted during drawing analysis. Re-run the analysis.';

type RecoverableRow = {
  bid_id: string;
  status: string;
  agent1_output: string | null;
  agent2_output: string | null;
  agent4_status: string | null;
  agent4_price: string | null;
  agent4_notes: string | null;
};

/** Atomically claim a row for this instance; returns false if another instance got it. */
async function claim(bidId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE takeoff_results SET worker_heartbeat_at=now() WHERE bid_id=$1 AND ${stale}`,
    [bidId]
  );
  return (rowCount ?? 0) > 0;
}

export async function recoverInterruptedAnalyses(): Promise<void> {
  // Agent 1 was in flight — the uploaded files are gone, so this is terminal.
  const { rowCount: erroredA1 } = await pool.query(
    `UPDATE takeoff_results
        SET status='error', agent1_output=COALESCE(agent1_output, $1)
      WHERE status='running' AND ${stale}`,
    [AGENT1_INTERRUPTED_MSG]
  );
  if (erroredA1) {
    logger.warn({ count: erroredA1 }, '[ai-recovery] marked interrupted Agent 1 runs as error (not resumable)');
  }

  const { rows } = await pool.query<RecoverableRow>(
    `SELECT bid_id, status, agent1_output, agent2_output, agent4_status, agent4_price, agent4_notes
       FROM takeoff_results
      WHERE (status IN ('agent1_complete','agent2_running','agent2_complete','agent3_running')
             OR agent4_status='running')
        AND ${stale}`
  );
  if (!rows.length) return;

  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    logger.error({ count: rows.length }, '[ai-recovery] orphaned runs found but no Anthropic API key configured');
    return; // leave them — they'll recover once a key is configured
  }
  const config = await loadAIConfig();
  const client = new Anthropic({ apiKey });

  for (const row of rows) {
    if (!(await claim(row.bid_id))) continue; // another instance is recovering it

    // Resume the 3-agent pipeline from the last completed agent.
    if (['agent1_complete', 'agent2_running'].includes(row.status) && row.agent1_output) {
      logger.info({ bidId: row.bid_id, from: 'agent2' }, '[ai-recovery] resuming interrupted pipeline');
      resumeFromAgent2(row.bid_id, client, config, row.agent1_output)
        .catch(err => logger.error({ err, bidId: row.bid_id }, '[ai-recovery] resume from Agent 2 failed'));
    } else if (['agent2_complete', 'agent3_running'].includes(row.status) && row.agent1_output && row.agent2_output) {
      logger.info({ bidId: row.bid_id, from: 'agent3' }, '[ai-recovery] resuming interrupted pipeline');
      resumeFromAgent3(row.bid_id, client, config, row.agent1_output, row.agent2_output)
        .catch(err => logger.error({ err, bidId: row.bid_id }, '[ai-recovery] resume from Agent 3 failed'));
    } else if (['agent1_complete', 'agent2_running', 'agent2_complete', 'agent3_running'].includes(row.status)) {
      // In-progress status but the inputs it needs are missing — terminal.
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=COALESCE(agent1_output, $1) WHERE bid_id=$2`,
        [AGENT1_INTERRUPTED_MSG, row.bid_id]
      ).catch(() => {});
    }

    // Re-run an interrupted Agent 4 (price/notes are persisted when it is kicked off).
    if (row.agent4_status === 'running') {
      if (row.agent4_price && row.agent2_output) {
        logger.info({ bidId: row.bid_id }, '[ai-recovery] re-running interrupted Agent 4');
        runAgent4(row.bid_id, client, config, {
          price: row.agent4_price,
          internalNotes: row.agent4_notes,
          agent1Output: row.agent1_output || '',
          agent2Output: row.agent2_output,
        }).catch(err => logger.error({ err, bidId: row.bid_id }, '[ai-recovery] Agent 4 re-run failed'));
      } else {
        await pool.query(
          `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
          ['Proposal generation was interrupted by a server restart. Re-run Agent 4.', row.bid_id]
        ).catch(() => {});
      }
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start recovery: an initial pass shortly after boot, then a periodic sweep
 * (also catches jobs orphaned by hard crashes, not just redeploys). No-op in
 * tests or when disabled.
 */
export function startPipelineRecovery(): void {
  if (process.env.NODE_ENV === 'test' || process.env.AI_RECOVERY_DISABLED === 'true') return;
  if (timer) return;
  const run = () =>
    recoverInterruptedAnalyses().catch(err => logger.error({ err }, '[ai-recovery] sweep failed'));
  setTimeout(run, 30_000);
  timer = setInterval(run, 5 * 60_000);
  timer.unref?.();
}

export function stopPipelineRecovery(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
