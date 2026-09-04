// Audit: Security #3 (High) / Task 3 — GET /api/gens/p/:token is unauthenticated
// and its `SELECT *` used to return the entire internal row (cost/margin data,
// salesperson_id, Drive folder ids, org_id, internal checklist/survey JSONB) to
// whoever a customer forwarded the link to. ProposalPublicPage.tsx is the ONLY
// consumer of this route; this test locks the response down to exactly what it
// reads and asserts every internal column stays absent, in both the preview
// (SELECT) and view-stamping (UPDATE ... RETURNING) branches.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const ALLOWED_KEYS = [
  'customer', 'product_type', 'proposal_no', 'form_data', 'totals_data',
  'signature_data', 'initials_data', 'signed_at', 'countersigned_at', 'countersignature_data',
].sort();

async function createFullGen(token: string) {
  const res = await request(app).post('/api/gens').set(auth(token))
    .send({
      customer: `Public Proposal Test ${Date.now()}`,
      mfr: 'Kohler', model: '20RCA', kw: 20, amount: 15000, tax: 900, addons: 2,
      proposal_no: 'GEN-0001',
      form_data: { scope: 'install a generator' },
      totals_data: { subtotal: 15000, total: 15900 },
    })
    .expect(200);
  const gen = res.body as { id: string; proposal_token: string; salesperson_id: string };
  // Populate the internal-only columns a real job would accumulate, so the test
  // can assert they never leak, not just that they were absent by coincidence.
  await pool.query(
    `UPDATE generator_proposals SET
       drive_job_folder_id = 'drive-folder-secret',
       checklist_data = $2::jsonb,
       survey_markup = $3::jsonb,
       loc = 'Internal-only address note'
     WHERE id = $1`,
    [gen.id, JSON.stringify({ internal: 'award kit checklist' }), JSON.stringify({ internal: 'survey' })]
  );
  return gen;
}

describe('GET /api/gens/p/:token — customer-safe column list (Task 3)', () => {
  it('preview branch (?preview=1) returns exactly the allowed keys', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createFullGen(u.token);

    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(ALLOWED_KEYS);
  });

  it('view-stamping branch (no preview) returns exactly the allowed keys', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createFullGen(u.token);

    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(ALLOWED_KEYS);
  });

  it('never includes internal columns: salesperson_id, org_id, drive folder ids, id, checklist/survey data', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createFullGen(u.token);

    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    for (const key of [
      'id', 'salesperson_id', 'salesperson_name', 'org_id', 'customer_id',
      'drive_job_folder_id', 'drive_engineering_folder_id', 'drive_permit_folder_id',
      'drive_contract_folder_id', 'drive_invoices_folder_id', 'drive_photos_folder_id',
      'checklist_data', 'survey_markup', 'countersigned_by', 'loc',
      'amount', 'tax', 'addons', 'mfr', 'model', 'kw', 'stage',
    ]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });
});
