// Audit: Data #3 (High) / Task 8 — the lead -> proposal handoff used to be six
// separate pool.query calls with no BEGIN. A crash or failure partway through
// (e.g. the document-relink step) could leave a lead marked converted with no
// proposal, or a proposal that a converted lead never actually points to. This
// forces a genuine failure in the document-relink write and asserts the whole
// handoff rolled back: no generator_proposals row, and the lead is not converted.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Client } from 'pg';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Forces any query (pooled or plain) whose SQL contains `fragment` to fail with
 * a REAL Postgres error, by rewriting it to reference a table that doesn't
 * exist, rather than short-circuiting with a JS-level Promise.reject. node-postgres
 * tracks per-connection protocol state internally; rejecting out-of-band (bypassing
 * an actual wire round trip) leaves that state inconsistent and hangs every query
 * after it on the same connection — this was verified directly while writing this
 * test. Routing the failure through a genuine round trip keeps that state intact,
 * so everything else on the connection (including ROLLBACK) behaves normally.
 */
function failQueryContaining(fragment: string, brokenTable: string) {
  const original = Client.prototype.query;
  return vi.spyOn(Client.prototype, 'query').mockImplementation(function (
    this: InstanceType<typeof Client>, ...args: unknown[]
  ) {
    const first = args[0] as string | { text?: string } | undefined;
    const sql = typeof first === 'string' ? first : first?.text;
    if (typeof sql === 'string' && sql.includes(fragment)) {
      const broken = sql.replace(brokenTable, `${brokenTable}_simulated_failure_xyz`);
      const newArgs = [...args];
      if (typeof newArgs[0] === 'string') newArgs[0] = broken;
      else newArgs[0] = { ...(newArgs[0] as { text: string }), text: broken };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any).apply(this, newArgs);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (original as any).apply(this, args);
  });
}

describe('Lead -> proposal handoff is atomic (Task 8)', () => {
  it('rolls back the entire handoff when the document-relink write fails mid-transaction', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');

    const { rows: leadRows } = await pool.query(
      `INSERT INTO leads (name, phone, source, contact_method, stage, salesperson_id)
       VALUES ($1,'352-555-0100','referral','phone','new',$2) RETURNING id`,
      [`Atomic Handoff Test ${Date.now()}`, rep.id]
    );
    const leadId = leadRows[0].id as string;

    failQueryContaining('UPDATE documents SET linked_id', 'documents');

    const res = await request(app).patch(`/api/leads/${leadId}`).set(auth(rep.token))
      .send({ stage: 'site-scheduled', site_visit_at: new Date().toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(500);

    vi.restoreAllMocks(); // stop faulting queries before the follow-up assertions below

    const { rows: after } = await pool.query('SELECT stage, linked_gen_id FROM leads WHERE id=$1', [leadId]);
    expect(after[0].stage).not.toBe('converted');
    expect(after[0].linked_gen_id).toBeNull();

    const { rows: gens } = await pool.query('SELECT id FROM generator_proposals WHERE lead_id=$1', [leadId]);
    expect(gens.length).toBe(0);
  });

  it('succeeds end-to-end when nothing fails: lead converted, proposal exists, both linked', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');

    const { rows: leadRows } = await pool.query(
      `INSERT INTO leads (name, phone, source, contact_method, stage, salesperson_id)
       VALUES ($1,'352-555-0101','referral','phone','new',$2) RETURNING id`,
      [`Atomic Handoff Success Test ${Date.now()}`, rep.id]
    );
    const leadId = leadRows[0].id as string;

    const res = await request(app).patch(`/api/leads/${leadId}`).set(auth(rep.token))
      .send({ stage: 'site-scheduled', site_visit_at: new Date().toISOString() })
      .expect(200);

    expect(res.body.stage).toBe('converted');
    expect(res.body.linked_gen_id).toBeTruthy();
    expect(res.body.proposal).toBeTruthy();
    expect(res.body.proposal.lead_id).toBe(leadId);
  });
});
