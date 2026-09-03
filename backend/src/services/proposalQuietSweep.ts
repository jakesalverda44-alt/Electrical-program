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
 * Resolve a proposal's salesperson to an id that actually exists in `users`.
 *
 * Historic rows can carry a salesperson_id with no matching user (data imported
 * around the Render database move landed orphans that the FK would have blocked).
 * Assigning such an id blows up on tasks_assigned_to_fkey / the notifications FK,
 * so treat it as unassigned instead — a triage-able task beats no task at all.
 */
export async function resolveOwner(salespersonId: string | null): Promise<string | null> {
  if (!salespersonId) return null;
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [salespersonId]);
  return rows.length ? salespersonId : null;
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
  const owner = await resolveOwner(g.salesperson_id);
  if (g.salesperson_id && !owner) {
    logger.warn(
      { genId: g.id, salespersonId: g.salesperson_id },
      '[proposal-quiet-sweep] proposal owner is not a known user — leaving follow-up unassigned'
    );
  }

  await pool.query(
    `INSERT INTO tasks (title, notes, due_date, linked_type, linked_id, linked_name, assigned_to)
     VALUES ($1,$2,$3,'gen',$4,$5,$6)`,
    [title, notes, dueDate, g.id, g.customer, owner]
  );

  if (owner) {
    await createNotification(owner, {
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
 * createFollowup for one candidate, isolated so a single bad row can't abort the whole
 * sweep. Before this, one failing insert skipped every remaining Tier A candidate *and*
 * the entire Tier B pass, so follow-ups stopped being created site-wide.
 * Returns whether the follow-up was created.
 */
async function tryCreateFollowup(
  g: QuietProposal,
  title: string,
  tier: 'a' | 'b',
): Promise<boolean> {
  try {
    await createFollowup(g, title, tier);
    return true;
  } catch (err) {
    logger.error({ err, genId: g.id, tier }, '[proposal-quiet-sweep] follow-up insert failed');
    return false;
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
      if (await tryCreateFollowup(g, title, 'a')) created++;
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
      if (await tryCreateFollowup(g, title, 'b')) created++;
    }
  } catch (err) {
    logger.error({ err }, '[proposal-quiet-sweep] failed');
  }
  return { created };
}

// ── Phase 4 Task 4, simplified post-merge (2026-09-03) — the electrical
// bids pass (rather than forking a copy of the file) — bids use `bids`/
// proposal_* columns and elec_followup_quiet_days instead of
// generator_proposals' sent_at/gen_followup_quiet_days, but the dedup
// convention and follow-up-task shape are identical.
//
// Originally this had two tiers (never-viewed vs. viewed-but-unsigned),
// mirroring the generator pipeline's sweep. The public proposal page + view
// tracking that Tier B depended on (proposal_viewed_at) is gone — Jake
// corrected the product design after Phase 4 shipped: GCs never open a web
// link to view/sign a proposal, they get a PDF/docx by email and respond
// via contract/PO. There's nothing left to distinguish "viewed" from "not
// viewed," so this collapses to ONE tier: sent + still `submitted` + quiet
// long enough, full stop. elec_followup_viewed_days is gone (removed from
// ALLOWED_KEYS and the Notifications UI); elec_followup_quiet_days stays.
const DEFAULT_ELEC_QUIET_DAYS = 5;

export interface BidQuietEligibilityInput {
  stage: string;
  sentAt: Date | string | null;
  signedAt: Date | string | null;
}

/**
 * Pure eligibility check — no DB, no I/O. A bid qualifies for a follow-up
 * only while it's still sitting in `submitted` (an awarded/lost/reopened
 * bid is no longer "waiting on the GC" in the sense this sweep cares
 * about), has never been signed/awarded, and has been quiet (since send)
 * for at least `quietDays`. Mirrors sweepQuietProposals' own strict-less-
 * than cutoff semantics (a bid becomes eligible once MORE than the
 * configured number of days has elapsed, not merely "at least" — same as
 * the gens SQL's `sent_at < cutoff`).
 */
export function classifyBidQuietTier(
  input: BidQuietEligibilityInput,
  now: Date,
  quietDays: number,
): boolean {
  if (input.stage !== 'submitted') return false;
  if (!input.sentAt) return false;
  if (input.signedAt) return false;

  const quietCutoff = new Date(now.getTime() - quietDays * 86_400_000);
  return new Date(input.sentAt) < quietCutoff;
}

interface QuietBidRow {
  id: string;
  name: string;
  gc: string;
  salesperson_id: string | null;
  stage: string;
  proposal_sent_at: Date;
}

async function createBidFollowup(b: QuietBidRow, title: string): Promise<void> {
  const notes = `Sent ${dateOnly(b.proposal_sent_at)}.`;
  const dueDate = new Date().toISOString().slice(0, 10);
  const owner = await resolveOwner(b.salesperson_id);
  if (b.salesperson_id && !owner) {
    logger.warn(
      { bidId: b.id, salespersonId: b.salesperson_id },
      '[proposal-quiet-sweep] bid owner is not a known user — leaving follow-up unassigned'
    );
  }

  await pool.query(
    `INSERT INTO tasks (title, notes, due_date, linked_type, linked_id, linked_name, assigned_to)
     VALUES ($1,$2,$3,'bid',$4,$5,$6)`,
    [title, notes, dueDate, b.id, b.name, owner]
  );

  if (owner) {
    await createNotification(owner, {
      type: 'proposal_quiet',
      title,
      body: notes,
      linkView: 'electrical/bids',
      linkId: b.id,
      dedupKey: `bid-proposal-quiet-${b.id}`,
    });
  }
}

async function tryCreateBidFollowup(b: QuietBidRow, title: string): Promise<boolean> {
  try {
    await createBidFollowup(b, title);
    return true;
  } catch (err) {
    logger.error({ err, bidId: b.id }, '[proposal-quiet-sweep] bid follow-up insert failed');
    return false;
  }
}

/**
 * Sweep sent-but-unawarded electrical bids and create a one-time auto
 * follow-up task per bid — same dedup convention as sweepQuietProposals
 * (title-prefix match against `tasks`, regardless of open/done status, so
 * a follow-up is created at most once per bid ever, even if the delay
 * setting changes later). Fetches a broad candidate pool (sent, not
 * deleted) and lets the pure classifyBidQuietTier decide eligibility per
 * row, so the cutoff logic lives in exactly one place and is
 * independently unit-testable.
 */
export async function sweepQuietBids(now: Date = new Date()): Promise<{ created: number }> {
  let created = 0;
  try {
    const quietDays = await numericSetting('elec_followup_quiet_days', DEFAULT_ELEC_QUIET_DAYS);

    const { rows: candidates } = await pool.query<QuietBidRow>(
      `SELECT id, name, gc, salesperson_id, stage, proposal_sent_at
         FROM bids
        WHERE deleted_at IS NULL AND proposal_sent_at IS NOT NULL AND proposal_signed_at IS NULL`
    );

    for (const b of candidates) {
      const eligible = classifyBidQuietTier(
        { stage: b.stage, sentAt: b.proposal_sent_at, signedAt: null },
        now, quietDays,
      );
      if (!eligible) continue;

      const titlePrefix = 'Proposal quiet';
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM tasks WHERE linked_type = 'bid' AND linked_id = $1 AND title LIKE $2`,
        [b.id, `${titlePrefix}%`]
      );
      if (existing.length) continue;

      const title = `Proposal quiet ${quietDays}d — ${b.name}`;
      if (await tryCreateBidFollowup(b, title)) created++;
    }
  } catch (err) {
    logger.error({ err }, '[proposal-quiet-sweep] bids pass failed');
  }
  return { created };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the periodic quiet-proposal sweep (immediate run, then every 6h;
 *  runs both the generator and electrical-bid passes). No-op in tests. */
export function startProposalQuietSweep(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { created: genCreated } = await sweepQuietProposals();
      const { created: bidCreated } = await sweepQuietBids();
      const created = genCreated + bidCreated;
      if (created) logger.info({ created, genCreated, bidCreated }, '[proposal-quiet-sweep] follow-up tasks created');
    } catch (err) {
      logger.error({ err }, '[proposal-quiet-sweep] tick failed');
    } finally {
      running = false;
    }
  };

  tick();
  timer = setInterval(tick, SIX_HOURS_MS);
}
