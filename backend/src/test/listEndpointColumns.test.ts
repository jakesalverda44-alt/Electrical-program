// Audit batch 3, Task 6 (audit data #7) — GET /bids and GET
// /preconstruction/workspaces trimmed only where provably safe: bids drops
// `notes` and `signature_data` (neither is in the frontend `Bid` type or read
// anywhere; signature_data has never been written by anything — 0/35 rows
// locally); bid_workspaces is left as SELECT * because App.tsx's workspace
// restore effect genuinely reads every JSONB/text field (notes, scope, rfis,
// files) to rebuild in-progress estimator state on app load.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const EXPECTED_BIDS_LIST_KEYS = new Set([
  'id', 'name', 'loc', 'gc', 'due', 'due_days', 'amount', 'sheets', 'contact', 'stage',
  'salesperson_id', 'salesperson_name', 'created_at', 'updated_at', 'elec_project_phase',
  'loss_reason', 'competitor', 'customer_id', 'submitted_at', 'awarded_at', 'deleted_at',
  'org_id', 'drive_gc_folder_id', 'drive_job_folder_id', 'drive_plans_folder_id',
  'drive_estimates_folder_id', 'drive_photos_folder_id', 'drive_contracts_folder_id',
  'drive_submittals_folder_id', 'drive_rfis_folder_id', 'drive_change_orders_folder_id',
  'closed_at', 'project_type', 'sq_ft', 'source_email_link', 'team_notified_at',
  'team_notified_to', 'brand', 'job_number', 'proposal_token', 'proposal_sent_at',
  'proposal_sent_to', 'proposal_viewed_at', 'proposal_signed_at', 'signer_name',
  'signed_document_id',
]);

describe('GET /api/bids — list response columns (Task 6)', () => {
  it('matches the documented column set, excluding notes and signature_data', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Cols ${Date.now()}`, gc: 'G', notes: 'Some internal scope notes' }).expect(200);

    const res = await request(app).get('/api/bids').set(auth(u.token)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const keys = new Set(Object.keys(res.body[0]));
    expect(keys.has('notes')).toBe(false);
    expect(keys.has('signature_data')).toBe(false);
    for (const k of keys) expect(EXPECTED_BIDS_LIST_KEYS.has(k)).toBe(true);
  });
});

describe('GET /api/preconstruction/workspaces — left unchanged (Task 6)', () => {
  it('still returns notes/scope/rfis/files — App.tsx genuinely restores every field from this list', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `WsCols ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app).put(`/api/preconstruction/${bid.body.id}/workspace`).set(auth(u.token))
      .send({ step: 'intake', active_tab: 'overview', notes: 'draft notes', scope: { a: 1 }, rfis: [], files: [] })
      .expect(200);

    const res = await request(app).get('/api/preconstruction/workspaces').set(auth(u.token)).expect(200);
    const row = res.body.find((w: { bid_id: string }) => w.bid_id === bid.body.id);
    expect(row).toBeTruthy();
    for (const k of ['notes', 'scope', 'rfis', 'files', 'step', 'active_tab', 'ai_done', 'proposal_generated']) {
      expect(Object.prototype.hasOwnProperty.call(row, k)).toBe(true);
    }
  });
});
