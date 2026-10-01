// Level 2 learning, Task 12 — the lessons routes on the test DB: from-item
// proposes; approve (scope all by default) / approve-with-edit makes a new
// version and retires the old; restore; dismiss. Admin-only mutations.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('lessons routes', () => {
  it('from-item → proposed; approve with edit → v2 approved, v1 retired; restore v1 → v3', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id, project_type) VALUES ($1,'GC','Here',$2,'self_storage') RETURNING id`, [`Lessons ${Date.now()}`, admin.id]);
    const bidId = rows[0].id as string;
    const items: ReviewItem[] = [{ id: 'unlisted:H', kind: 'count', title: 'Type H', detail: 'd', type: 'H', description: 'surface strip fixture (warehouse)', resolution: { action: 'count', qty: 13, reason: 'H surface strip light, 4ft', by: 'Jake', at: '2026-09-30T00:00:00Z' } }];
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items) VALUES ($1,'complete',$2)`, [bidId, JSON.stringify(items)]);
    const a = auth(admin.token);
    const made = await request(app).post('/api/learning/lessons/from-item').set(a).send({ bidId, itemId: 'unlisted:H' }).expect(200);
    const v1 = made.body.lesson;
    expect(v1).toMatchObject({ status: 'proposed', version: 1, appliesTo: ['review'], pattern: 'manual' });
    const appr = await request(app).post(`/api/learning/lessons/${v1.id}/approve`).set(a).send({ text: 'An unscheduled tag drawn as a warehouse strip fixture is a 4 ft surface strip light.' }).expect(200);
    expect(appr.body.lesson).toMatchObject({ status: 'approved', version: 2, scopeKind: 'all', lineageId: v1.lineageId });
    const vers = (await request(app).get(`/api/learning/lessons/${v1.id}/versions`).set(a).expect(200)).body.versions;
    expect(vers.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['1:retired', '2:approved']);
    const restored = await request(app).post(`/api/learning/lessons/${v1.id}/restore`).set(a).expect(200);
    expect(restored.body.lesson).toMatchObject({ version: 3, status: 'approved', text: v1.text });
    const vers2 = (await request(app).get(`/api/learning/lessons/${v1.id}/versions`).set(a).expect(200)).body.versions;
    expect(vers2.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['1:retired', '2:retired', '3:approved']);
    // an automatic answer cannot become a lesson
    await pool.query(`UPDATE takeoff_results SET review_items = $2 WHERE bid_id = $1`, [bidId, JSON.stringify([{ ...items[0], resolution: { ...items[0].resolution, auto: { source: 'account_memory', reason: 'r', evidence: [] } } }])]);
    await request(app).post('/api/learning/lessons/from-item').set(a).send({ bidId, itemId: 'unlisted:H' }).expect(400);
  });
  it('approve defaults to all jobs; a non-admin cannot approve', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const est = await makeUser('salesperson');
    const { rows } = await pool.query(`INSERT INTO counting_lessons (lineage_id, text, applies_to, match, pattern, evidence) VALUES (gen_random_uuid(), 'x lesson text here', '{review}', '{}', 'manual', '[]') RETURNING id`);
    await request(app).post(`/api/learning/lessons/${rows[0].id}/approve`).set(auth(est.token)).send({}).expect(403);
    const r = await request(app).post(`/api/learning/lessons/${rows[0].id}/approve`).set(auth(admin.token)).send({ applies_to: ['review', 'counter'] }).expect(200);
    expect(r.body.lesson).toMatchObject({ status: 'approved', scopeKind: 'all', scopeValue: null, appliesTo: ['review', 'counter'] });
    const d = await request(app).post(`/api/learning/lessons/${rows[0].id}/dismiss`).set(auth(admin.token)).expect(200);
    expect(d.body.lesson.status).toBe('dismissed');
  });
});
