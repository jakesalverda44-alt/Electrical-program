import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { classifyBidQuietTier, sweepQuietBids, resolveOwner } from '../services/proposalQuietSweep';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const NOW = new Date('2026-09-03T12:00:00Z');
const ago = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// Phase 4 Task 4.3 — the pure eligibility function, unit-tested with a full
// sent/viewed/signed/stage matrix (no DB).
describe('classifyBidQuietTier (pure)', () => {
  const quietDays = 5;
  const viewedDays = 3;

  it('stage other than submitted is never eligible, regardless of everything else', () => {
    for (const stage of ['due', 'awarded', 'lost']) {
      expect(classifyBidQuietTier(
        { stage, sentAt: ago(30), viewedAt: null, signedAt: null }, NOW, quietDays, viewedDays,
      )).toBeNull();
    }
  });

  it('never sent (sentAt null) is never eligible', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: null, viewedAt: null, signedAt: null }, NOW, quietDays, viewedDays,
    )).toBeNull();
  });

  it('already signed is never eligible, even if quiet a long time', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(30), viewedAt: null, signedAt: ago(1) }, NOW, quietDays, viewedDays,
    )).toBeNull();
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(30), viewedAt: ago(20), signedAt: ago(1) }, NOW, quietDays, viewedDays,
    )).toBeNull();
  });

  it('Tier A: sent, never viewed, quiet longer than quietDays', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(6), viewedAt: null, signedAt: null }, NOW, quietDays, viewedDays,
    )).toBe('A');
  });

  it('sent, never viewed, but not yet quiet long enough is not eligible', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(4), viewedAt: null, signedAt: null }, NOW, quietDays, viewedDays,
    )).toBeNull();
    // Exactly at the boundary is strict-less-than, matching sweepQuietProposals' own cutoff.
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(5), viewedAt: null, signedAt: null }, NOW, quietDays, viewedDays,
    )).toBeNull();
  });

  it('Tier B: viewed but unsigned, quiet (since the view) longer than viewedDays', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(10), viewedAt: ago(4), signedAt: null }, NOW, quietDays, viewedDays,
    )).toBe('B');
  });

  it('viewed recently is not eligible for either tier', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(10), viewedAt: ago(1), signedAt: null }, NOW, quietDays, viewedDays,
    )).toBeNull();
  });
});

// Integration — the sweep wired to the DB: dedup, notifications-linked-type,
// and the same "skip anything not in submitted" rule.
describe('sweepQuietBids (integration)', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  async function createBid(opts: {
    name: string;
    salespersonId: string | null;
    stage: string;
    sentAt: Date | null;
    viewedAt: Date | null;
    signedAt?: Date | null;
  }): Promise<string> {
    const gc = `Quiet Sweep GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO bids (name, gc, salesperson_id, stage, proposal_sent_at, proposal_viewed_at, proposal_signed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [opts.name, gc, opts.salespersonId, opts.stage, opts.sentAt, opts.viewedAt, opts.signedAt ?? null]
    );
    return rows[0].id as string;
  }

  it('creates a Tier A task for a bid sent 6 days ago, never viewed, still submitted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Quiet Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(6), viewedAt: null,
    });

    const { created } = await sweepQuietBids();
    expect(created).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Proposal quiet 5d — Quiet Plaza');
    expect(rows[0].assigned_to).toBe(u.id);
    expect(rows[0].linked_name).toBe('Quiet Plaza');
  });

  it('re-running does not create a duplicate, even after the task is closed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Repeat Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(6), viewedAt: null,
    });

    await sweepQuietBids();
    const { rows: first } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(first.length).toBe(1);

    await pool.query(`UPDATE tasks SET status='done' WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    await sweepQuietBids();
    const { rows: afterClose } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(afterClose.length).toBe(1);
    expect(afterClose[0].status).toBe('done');
  });

  it('viewed 4 days ago, unsigned, creates a Tier B task', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Stalled Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(10), viewedAt: daysAgo(4),
    });

    await sweepQuietBids();
    const { rows } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Proposal viewed but unsigned — Stalled Plaza');
  });

  it('a bid no longer in `submitted` (e.g. awarded, or reopened to due) is skipped entirely', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const awardedId = await createBid({
      name: 'Awarded Plaza', salespersonId: u.id, stage: 'awarded', sentAt: daysAgo(30), viewedAt: daysAgo(30),
    });
    const dueId = await createBid({
      name: 'Reopened Plaza', salespersonId: u.id, stage: 'due', sentAt: daysAgo(30), viewedAt: null,
    });

    await sweepQuietBids();
    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='bid' AND linked_id = ANY($1::uuid[])`, [[awardedId, dueId]]
    );
    expect(rows.length).toBe(0);
  });

  it('a signed bid is skipped even if it is (unusually) still marked submitted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Signed Plaza', salespersonId: u.id, stage: 'submitted',
      sentAt: daysAgo(30), viewedAt: daysAgo(20), signedAt: daysAgo(1),
    });
    await sweepQuietBids();
    const { rows } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(rows.length).toBe(0);
  });

  it('an owner id with no matching user resolves to unassigned instead of throwing', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    expect(await resolveOwner(u.id)).toBe(u.id);
    expect(await resolveOwner('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});
