// Phase 4 Task 5.4/5.5 — team_notified_at/team_notified_to actually get
// written now: bids.team_notified_* by POST /bids/:id/notify-team (the
// "Email Bid to Team" button), and intake_items.team_notified_* by the
// Intake accept panel's opt-in team draft — both columns existed
// (073/074) but neither was ever written before this. Mocked at
// graphMailer level (isGraphMailConfigured -> true) so the still-muted
// noop draft is reachable under test, same technique as
// bidSendProposal.test.ts.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../email/graphMailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/graphMailer')>();
  return { ...actual, isGraphMailConfigured: () => true };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('POST /bids/:id/notify-team stamps team_notified_at/to', () => {
  it('stamps the bid once the draft succeeds', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Team Notify Test ${Date.now()}`, gc: `Team Notify Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
      .expect(200);

    const res = await request(app).post(`/api/bids/${bid.body.id}/notify-team`).set(auth(u.token))
      .send({ emails: ['ops@example.com'], attachFiles: false })
      .expect(200);
    expect(res.body.team_notified_at).not.toBeNull();
    expect(res.body.team_notified_to).toEqual(['ops@example.com']);

    const { rows } = await pool.query('SELECT team_notified_at, team_notified_to FROM bids WHERE id=$1', [bid.body.id]);
    expect(rows[0].team_notified_at).not.toBeNull();
    expect(rows[0].team_notified_to).toEqual(['ops@example.com']);
  });
});

describe('POST /intake/:id/accept with notifyTeam stamps intake_items.team_notified_at/to', () => {
  async function createIntakeItem() {
    const { rows } = await pool.query(
      `INSERT INTO intake_items (source, status, name, gc, loc)
       VALUES ('manual','pending',$1,$2,'123 Main St') RETURNING id`,
      [`Intake Notify Test ${Date.now()}`, `Intake Notify Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`]
    );
    return rows[0].id as string;
  }

  it('stamps the intake item when notifyTeam is opted in and the draft succeeds', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const itemId = await createIntakeItem();

    await request(app).post(`/api/intake/${itemId}/accept`).set(auth(u.token))
      .send({ notifyTeam: true, notifyEmails: ['team@example.com'] })
      .expect(200);

    const { rows } = await pool.query('SELECT team_notified_at, team_notified_to FROM intake_items WHERE id=$1', [itemId]);
    expect(rows[0].team_notified_at).not.toBeNull();
    expect(rows[0].team_notified_to).toEqual(['team@example.com']);
  });

  it('leaves team_notified_at null when the reviewer does not opt in', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const itemId = await createIntakeItem();

    await request(app).post(`/api/intake/${itemId}/accept`).set(auth(u.token))
      .send({})
      .expect(200);

    const { rows } = await pool.query('SELECT team_notified_at FROM intake_items WHERE id=$1', [itemId]);
    expect(rows[0].team_notified_at).toBeNull();
  });
});
