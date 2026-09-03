import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { classifyBidQuietTier, sweepQuietBids, resolveOwner } from '../services/proposalQuietSweep';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const NOW = new Date('2026-09-03T12:00:00Z');
const ago = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// Post-merge rework (2026-09-03) — the bid quiet-sweep collapsed to ONE
// tier: proposal_sent_at set + stage still `submitted` + quiet long enough.
// The "viewed, not signed" tier is gone along with the public proposal page
// it depended on (proposal_viewed_at is no longer written by anything).
describe('classifyBidQuietTier (pure)', () => {
  const quietDays = 5;

  it('stage other than submitted is never eligible, regardless of everything else', () => {
    for (const stage of ['due', 'awarded', 'lost']) {
      expect(classifyBidQuietTier(
        { stage, sentAt: ago(30), signedAt: null }, NOW, quietDays,
      )).toBe(false);
    }
  });

  it('never sent (sentAt null) is never eligible', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: null, signedAt: null }, NOW, quietDays,
    )).toBe(false);
  });

  it('already signed is never eligible, even if quiet a long time', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(30), signedAt: ago(1) }, NOW, quietDays,
    )).toBe(false);
  });

  it('sent, quiet longer than quietDays, is eligible', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(6), signedAt: null }, NOW, quietDays,
    )).toBe(true);
  });

  it('sent but not yet quiet long enough is not eligible', () => {
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(4), signedAt: null }, NOW, quietDays,
    )).toBe(false);
    // Exactly at the boundary is strict-less-than, matching sweepQuietProposals' own cutoff.
    expect(classifyBidQuietTier(
      { stage: 'submitted', sentAt: ago(5), signedAt: null }, NOW, quietDays,
    )).toBe(false);
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
    signedAt?: Date | null;
  }): Promise<string> {
    const gc = `Quiet Sweep GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO bids (name, gc, salesperson_id, stage, proposal_sent_at, proposal_signed_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [opts.name, gc, opts.salespersonId, opts.stage, opts.sentAt, opts.signedAt ?? null]
    );
    return rows[0].id as string;
  }

  it('creates a quiet-follow-up task for a bid sent 6 days ago, still submitted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Quiet Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(6),
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
      name: 'Repeat Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(6),
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

  it('not yet quiet long enough is skipped', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const bidId = await createBid({
      name: 'Fresh Plaza', salespersonId: u.id, stage: 'submitted', sentAt: daysAgo(1),
    });

    await sweepQuietBids();
    const { rows } = await pool.query(`SELECT * FROM tasks WHERE linked_type='bid' AND linked_id=$1`, [bidId]);
    expect(rows.length).toBe(0);
  });

  it('a bid no longer in `submitted` (e.g. awarded, or reopened to due) is skipped entirely', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const awardedId = await createBid({
      name: 'Awarded Plaza', salespersonId: u.id, stage: 'awarded', sentAt: daysAgo(30),
    });
    const dueId = await createBid({
      name: 'Reopened Plaza', salespersonId: u.id, stage: 'due', sentAt: daysAgo(30),
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
      sentAt: daysAgo(30), signedAt: daysAgo(1),
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
