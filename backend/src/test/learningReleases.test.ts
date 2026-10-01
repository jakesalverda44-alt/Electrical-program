// Level 2 learning, Tasks 13 + 14 — the bank a run may use comes only from
// the newest PASSED release: unapproved / dismissed / retired lessons and
// retired examples are never in it; activate refuses a release without a
// passed check; rollback picks the earlier passed release. Test DB only.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { createRelease, setReleaseEval, activateRelease, rollbackTo, activeRelease } from '../ai/learning/learningDb';
import { loadReleaseBank } from '../ai/learning/bank';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function lesson(status: string, text: string): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO counting_lessons (lineage_id, text, applies_to, match, pattern, evidence, status) VALUES (gen_random_uuid(), $1, '{counter}', '{}', 'manual', '[]', $2) RETURNING id`, [text, status]);
  return rows[0].id as string;
}

describe('releases', () => {
  it('only approved lessons of the newest passed release; activate needs a passed check; rollback', async (ctx) => {
    if (!ok) return ctx.skip();
    // isolate from other tests' releases
    await pool.query(`UPDATE learning_releases SET status = 'rolled_back' WHERE status = 'passed'`);
    const approved = await lesson('approved', `approved lesson ${Date.now()}`);
    const r1 = await createRelease('test');
    expect(r1.lessonIds).toContain(approved);
    expect((await activateRelease(r1.id)).ok).toBe(false);
    await setReleaseEval(r1.id, { passed: true, note: 'no-change mode: empty LOJO bank' }, 'pending');
    expect((await activateRelease(r1.id)).ok).toBe(true);
    expect((await activeRelease())!.id).toBe(r1.id);
    // a later status change never sneaks in: the bank keeps only approved lessons of the release
    await pool.query(`UPDATE counting_lessons SET status = 'retired' WHERE id = $1`, [approved]);
    expect((await loadReleaseBank())!.lessons.map(l => l.id)).not.toContain(approved);
    await pool.query(`UPDATE counting_lessons SET status = 'approved' WHERE id = $1`, [approved]);
    const proposed = await lesson('proposed', `proposed lesson ${Date.now()}`);
    const dismissed = await lesson('dismissed', `dismissed lesson ${Date.now()}`);
    const r2 = await createRelease('test');
    expect(r2.lessonIds).not.toContain(proposed);
    expect(r2.lessonIds).not.toContain(dismissed);
    await setReleaseEval(r2.id, { passed: true }, 'pending');
    await activateRelease(r2.id);
    expect((await activeRelease())!.id).toBe(r2.id);
    expect((await rollbackTo(r1.id)).ok).toBe(true);
    expect((await activeRelease())!.id).toBe(r1.id);
    const bank = await loadReleaseBank();
    expect(bank!.releaseId).toBe(r1.id);
    expect(bank!.lessons.map(l => l.id)).toContain(approved);
    expect(bank!.lessons.map(l => l.id)).not.toContain(proposed);
    expect(bank!.lessons.map(l => l.id)).not.toContain(dismissed);
  });
  it('routes: create / activate refused without a passed check (admin only)', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const rep = await makeUser('salesperson');
    await request(app).post('/api/learning/releases').set(auth(rep.token)).send({}).expect(403);
    const c = await request(app).post('/api/learning/releases').set(auth(admin.token)).send({}).expect(200);
    const a = await request(app).post(`/api/learning/releases/${c.body.release.id}/activate`).set(auth(admin.token)).send({}).expect(400);
    expect(a.body.error).toMatch(/no passed check/);
  });
});
