import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { sweepQuietProposals } from '../services/proposalQuietSweep';

describe('sweepQuietProposals', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  async function createGen(opts: {
    customer: string;
    salespersonId: string | null;
    stage: string;
    sentAt: Date | null;
    viewedAt: Date | null;
    signedAt?: Date | null;
    deletedAt?: Date | null;
  }): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO generator_proposals
         (customer, salesperson_id, stage, sent_at, viewed_at, signed_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        opts.customer, opts.salespersonId, opts.stage,
        opts.sentAt, opts.viewedAt, opts.signedAt ?? null, opts.deletedAt ?? null,
      ]
    );
    return rows[0].id as string;
  }

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('(a) creates a Tier A task for a proposal sent 6 days ago, never viewed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const genId = await createGen({
      customer: 'Quiet Corp',
      salespersonId: u.id,
      stage: 'sent',
      sentAt: daysAgo(6),
      viewedAt: null,
    });

    const { created } = await sweepQuietProposals();
    expect(created).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id=$1`,
      [genId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Proposal quiet 5d — Quiet Corp');
    expect(rows[0].assigned_to).toBe(u.id);
    expect(rows[0].linked_name).toBe('Quiet Corp');
  });

  it('(b) re-running does not create a duplicate, even after the task is closed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const genId = await createGen({
      customer: 'Repeat Corp',
      salespersonId: u.id,
      stage: 'sent',
      sentAt: daysAgo(6),
      viewedAt: null,
    });

    const first = await sweepQuietProposals();
    expect(first.created).toBeGreaterThanOrEqual(1);

    const again = await sweepQuietProposals();
    const { rows: afterFirstRerun } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id=$1`,
      [genId]
    );
    expect(afterFirstRerun.length).toBe(1);
    void again;

    await pool.query(`UPDATE tasks SET status='done' WHERE linked_type='gen' AND linked_id=$1`, [genId]);

    await sweepQuietProposals();
    const { rows: afterClose } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id=$1`,
      [genId]
    );
    expect(afterClose.length).toBe(1);
    expect(afterClose[0].status).toBe('done');
  });

  it('(c) sent 6 days ago but viewed 1 day ago produces neither tier A nor tier B', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const genId = await createGen({
      customer: 'Freshly Viewed Corp',
      salespersonId: u.id,
      stage: 'sent',
      sentAt: daysAgo(6),
      viewedAt: daysAgo(1),
    });

    await sweepQuietProposals();

    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id=$1`,
      [genId]
    );
    expect(rows.length).toBe(0);
  });

  it('(d) viewed 4 days ago, unsigned, creates a Tier B task', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const genId = await createGen({
      customer: 'Stalled Corp',
      salespersonId: u.id,
      stage: 'sent',
      sentAt: daysAgo(10),
      viewedAt: daysAgo(4),
    });

    await sweepQuietProposals();

    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id=$1`,
      [genId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Proposal viewed but unsigned — Stalled Corp');
    expect(rows[0].assigned_to).toBe(u.id);
  });

  it('(e) proposals in awarded/superseded/declined stages are never touched', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const stages = ['awarded', 'superseded', 'declined'];
    const genIds: string[] = [];
    for (const stage of stages) {
      genIds.push(await createGen({
        customer: `${stage} Corp`,
        salespersonId: u.id,
        stage,
        sentAt: daysAgo(30),
        viewedAt: daysAgo(30),
      }));
    }

    await sweepQuietProposals();

    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE linked_type='gen' AND linked_id = ANY($1::uuid[])`,
      [genIds]
    );
    expect(rows.length).toBe(0);
  });
});
