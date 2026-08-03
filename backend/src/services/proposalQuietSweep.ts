import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getSetting } from '../routes/settings';
import { createNotification } from '../notifications/engine';

const DEFAULT_QUIET_DAYS = 5;
const DEFAULT_VIEWED_DAYS = 3;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface QuietProposal {
  id: string;
  customer: string;
  salesperson_id: string | null;
  sent_at: Date;
  viewed_at: Date | null;
}

const dateOnly = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

async function numericSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  const n = parseInt(raw || String(fallback), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Insert a follow-up task (and, when there's an owner, a notification) for one quiet
 * proposal. Dedup is enforced by the caller's NOT EXISTS query — this just performs
 * the insert for a candidate that has already been confirmed to have no prior task
 * of this tier.
 */
async function createFollowup(
  g: QuietProposal,
  title: string,
  tier: 'a' | 'b',
): Promise<void> {
  const notes = `Sent ${dateOnly(g.sent_at)}. ${g.viewed_at ? `Viewed ${dateOnly(g.viewed_at)}` : 'Never viewed'}.`;
  const dueDate = new Date().toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO tasks (title, notes, due_date, linked_type, linked_id, linked_name, assigned_to)
     VALUES ($1,$2,$3,'gen',$4,$5,$6)`,
    [title, notes, dueDate, g.id, g.customer, g.salesperson_id]
  );

  if (g.salesperson_id) {
    await createNotification(g.salesperson_id, {
      type: 'proposal_quiet',
      title,
      body: notes,
      linkView: 'generators/pipeline',
      linkId: g.id,
      dedupKey: `proposal-quiet-${tier}-${g.id}`,
    });
  }
}

/**
 * Sweep sent-but-unsigned generator proposals and create a one-time auto follow-up
 * task per proposal per tier:
 *   Tier A — never viewed, quiet for gen_followup_quiet_days (default 5).
 *   Tier B — viewed but unsigned, quiet for gen_followup_viewed_days (default 3).
 *
 * Dedup is by title-prefix match against `tasks` (linked_type='gen', linked_id=g.id),
 * regardless of the task's open/done status — each proposal gets at most one Tier A
 * and one Tier B follow-up, ever, even if the delay setting changes after the fact
 * (which changes the trailing "{N}d" in the title but not the "Proposal quiet" prefix).
 *
 * Testable core: takes an optional `now` for deterministic tests. Never throws —
 * mirrors the log-never-throw pattern used by the other auto-followup schedulers.
 */
export async function sweepQuietProposals(now: Date = new Date()): Promise<{ created: number }> {
  let created = 0;
  try {
    const quietDays = await numericSetting('gen_followup_quiet_days', DEFAULT_QUIET_DAYS);
    const viewedDays = await numericSetting('gen_followup_viewed_days', DEFAULT_VIEWED_DAYS);

    const quietCutoff = new Date(now.getTime() - quietDays * 86_400_000);
    const viewedCutoff = new Date(now.getTime() - viewedDays * 86_400_000);

    // Tier A — sent, never viewed, quiet long enough.
    const { rows: quiet } = await pool.query(
      `SELECT g.* FROM generator_proposals g
        WHERE g.stage = 'sent' AND g.deleted_at IS NULL AND g.signed_at IS NULL
          AND g.viewed_at IS NULL AND g.sent_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
             WHERE t.linked_type = 'gen' AND t.linked_id = g.id
               AND t.title LIKE 'Proposal quiet%')`,
      [quietCutoff]
    );
    for (const g of quiet as QuietProposal[]) {
      const title = `Proposal quiet ${quietDays}d — ${g.customer}`;
      await createFollowup(g, title, 'a');
      created++;
    }

    // Tier B — sent, viewed, still unsigned, quiet long enough since the view.
    const { rows: viewedUnsigned } = await pool.query(
      `SELECT g.* FROM generator_proposals g
        WHERE g.stage = 'sent' AND g.deleted_at IS NULL AND g.signed_at IS NULL
          AND g.viewed_at IS NOT NULL AND g.viewed_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
             WHERE t.linked_type = 'gen' AND t.linked_id = g.id
               AND t.title LIKE 'Proposal viewed but unsigned%')`,
      [viewedCutoff]
    );
    for (const g of viewedUnsigned as QuietProposal[]) {
      const title = `Proposal viewed but unsigned — ${g.customer}`;
      await createFollowup(g, title, 'b');
      created++;
    }
  } catch (err) {
    logger.error({ err }, '[proposal-quiet-sweep] failed');
  }
  return { created };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the periodic quiet-proposal sweep (immediate run, then every 6h). No-op in tests. */
export function startProposalQuietSweep(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { created } = await sweepQuietProposals();
      if (created) logger.info({ created }, '[proposal-quiet-sweep] follow-up tasks created');
    } catch (err) {
      logger.error({ err }, '[proposal-quiet-sweep] tick failed');
    } finally {
      running = false;
    }
  };

  tick();
  timer = setInterval(tick, SIX_HOURS_MS);
}
