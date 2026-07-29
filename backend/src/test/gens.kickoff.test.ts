import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { missingKickoffLabels } from '../routes/gens';

describe('missingKickoffLabels', () => {
  it('lists labels for absent categories, excluding contract', () => {
    expect(missingKickoffLabels([])).toEqual(['Sizer Report', 'Survey', 'Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey'])).toEqual(['Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey', 'labeled_survey', 'site_checklist'])).toEqual([]);
  });
});

describe('kickoff email gating', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  // POST /api/gens returns the created gen row directly (res.json(gen)).
  async function createGen(token: string) {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Kickoff Test ${Date.now()}`, mfr: 'Kohler', model: '20RCA', kw: 20, amount: 15000 })
      .expect(200);
    return res.body as { id: string };
  }

  async function addContractDoc(genId: string) {
    await pool.query(
      `INSERT INTO documents (linked_id, div, name, display_name, category, uploaded_by)
       VALUES ($1, 'gen', 'signed-proposal.pdf', 'Signed Proposal', 'contract', 'test')`,
      [genId],
    );
  }

  it('400s without a contract doc, before any email-config check', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/Signed proposal required/);
  });

  it('passes the contract gate once a contract doc exists (503 = unconfigured mail, not 400)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await addContractDoc(gen.id);
    // Test env has no Microsoft Graph config, so the draft step itself fails
    // with 503 — proving the request got past the 400 contract gate.
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(503);
    expect(res.body.error).toMatch(/Email is not configured/);
    // Stamp must only be written on successful drafts.
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });

  it('award transition no longer auto-drafts (stamp stays null)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).patch(`/api/gens/${gen.id}/stage`).set(auth(u.token)).send({ stage: 'awarded' }).expect(200);
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at, stage FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].stage).toBe('awarded');
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });
});
