// Bid Overview: Plans Upload + Job Profile — routes/jobProfile.ts. Covers
// the whole plumbing (document -> text -> profile -> card-update rules ->
// DB writes -> audit log -> response), not the extraction regexes
// themselves (ai/jobProfile.test.ts, against real Kissimmee plan text,
// already covers those in isolation). No real Anthropic/Drive calls — every
// document here is DB-stored (base64), and the extraction path used is
// text-only (no vision fallback).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `JobProfile ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Original GC', ...extra })
    .expect(200);
  return res.body.id as string;
}

async function attachPlanDoc(bidId: string): Promise<string> {
  // Each page is a single short fact well under the fixture builder's
  // 250-char wrap width, so it lands on the page as one clean pdftotext
  // line (see jobProfile.ts's regexes, which are line-based) — real
  // multi-line title-block adjacency (owner/architect heading blocks) is
  // exercised against real Kissimmee text in ai/jobProfile.test.ts instead.
  const buf = buildTestPdf([
    'AutoZone Store No. 10077',
    '2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747',
    'BLDG. AREA = 7,381 SQ. FT.',
    'Owner / Developer: AUTOZONE STORES LLC',
    'ENGINEER: DANNY E. DOSS P.E.',
    '09/22/2025',
    '7N2',
  ]);
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
     VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', $2, 'test') RETURNING id`,
    [bidId, buf.toString('base64')],
  );
  return rows[0].id as string;
}

describe('POST /api/preconstruction/:bidId/job-profile/run', () => {
  it('extracts the profile, auto-fills every empty field, and never touches gc', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u);
    const docId = await attachPlanDoc(bidId);

    const res = await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    expect(res.body.bid.gc).toBe('Original GC'); // never touched
    expect(res.body.bid.brand).toBe('AutoZone');
    expect(res.body.bid.project_type).toBe('retail');
    expect(res.body.bid.store_number).toBe('10077');
    expect(res.body.bid.prototype).toBe('7N2');
    expect(res.body.bid.loc).toBe('2860 N Old Lake Wilson Rd, Kissimmee, FL 34747');
    expect(Number(res.body.bid.sq_ft)).toBe(7381);
    expect(String(res.body.bid.plan_date).slice(0, 10)).toBe('2025-09-22');
    expect(res.body.bid.owner_name).toBe('AUTOZONE STORES LLC');
    expect(res.body.bid.engineer).toBe('DANNY E. DOSS P.E.');
    expect(res.body.bid.build_type).toBe('new');
    // name is never auto-filled — a suggestion instead (asserted below).
    expect(res.body.bid.name).toMatch(/^JobProfile /);
    // No architect (no heading-block text in this single-line-per-page
    // synthetic fixture — that shape is covered against real Kissimmee text
    // in ai/jobProfile.test.ts instead) and no prototype fill check here
    // since prototype's base "7N2" IS filled too.
    expect(res.body.fillsApplied.sort()).toEqual(
      ['brand', 'build_type', 'engineer', 'loc', 'owner_name', 'plan_date', 'project_type', 'prototype', 'sq_ft', 'store_number'].sort(),
    );
    expect(res.body.suggestions.name).toBeTruthy();
    expect(res.body.suggestions.name.status).toBe('pending');
    expect(res.body.suggestions.name.value).toBe('AutoZone #10077 – Kissimmee, FL');
    expect(res.body.costCents).toBe(0); // text-only — no vision fallback

    // Persisted for GET.
    const get = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(get.body.profile.brand.value).toBe('AutoZone');
    expect(get.body.suggestions.name.status).toBe('pending');
  });

  it('a conflicting field becomes a suggestion, never a silent overwrite', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u, { sq_ft: 7000 });
    const docId = await attachPlanDoc(bidId);

    const res = await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    expect(Number(res.body.bid.sq_ft)).toBe(7000); // untouched
    expect(res.body.fillsApplied).not.toContain('sq_ft');
    expect(res.body.suggestions.sq_ft.value).toBe(7381);
    expect(res.body.suggestions.sq_ft.status).toBe('pending');
  });

  it('every applied field is logged in the audit log', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u);
    const docId = await attachPlanDoc(bidId);

    await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    const { rows } = await pool.query(
      `SELECT summary FROM audit_log WHERE entity_type='bid' AND entity_id=$1 AND action='update' ORDER BY created_at`, [bidId],
    );
    const summaries = rows.map(r => r.summary as string);
    expect(summaries.some(s => s.includes('brand') && s.includes('from plans'))).toBe(true);
    expect(summaries.some(s => s.includes('sq_ft') && s.includes('from plans'))).toBe(true);
  });
});

describe('PUT /api/preconstruction/:bidId/job-profile/suggestions/:field', () => {
  it('accept applies the plans\' value (never the client\'s own) and logs it', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u, { sq_ft: 7000 });
    const docId = await attachPlanDoc(bidId);
    await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    // A tampered client-supplied value must be ignored — the server applies
    // its OWN stored suggestion value, not anything from the request body.
    const res = await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/sq_ft`).set(auth(u.token))
      .send({ action: 'accept', value: 999999 }).expect(200);

    expect(Number(res.body.bid.sq_ft)).toBe(7381);

    const { rows } = await pool.query(
      `SELECT summary FROM audit_log WHERE entity_type='bid' AND entity_id=$1 AND action='update' AND summary LIKE '%accepted suggestion%'`, [bidId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('ignore dismisses the chip without changing the bid', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u, { sq_ft: 7000 });
    const docId = await attachPlanDoc(bidId);
    await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    const res = await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/sq_ft`).set(auth(u.token))
      .send({ action: 'ignore' }).expect(200);
    expect(Number(res.body.bid.sq_ft)).toBe(7000);

    const get = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(get.body.suggestions.sq_ft.status).toBe('ignored');
  });

  it('re-running after ignoring the SAME plans value does not resurrect the chip', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u, { sq_ft: 7000 });
    const docId = await attachPlanDoc(bidId);
    await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);
    await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/sq_ft`).set(auth(u.token))
      .send({ action: 'ignore' }).expect(200);

    await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token))
      .send({ document_ids: [docId] }).expect(200);

    const get = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(get.body.suggestions.sq_ft.status).toBe('ignored');
  });

  it('gc is never a suggestible field — the route 400s before touching anything', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/gc`).set(auth(u.token))
      .send({ action: 'accept' }).expect(400);
  });

  it('404s a field with no pending suggestion', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/engineer`).set(auth(u.token))
      .send({ action: 'accept' }).expect(404);
  });
});
