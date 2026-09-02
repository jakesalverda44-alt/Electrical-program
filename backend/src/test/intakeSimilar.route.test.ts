import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

describe('GET /api/intake — duplicate/REBID hints', () => {
  it('flags a pending REBID intake item against the original submitted bid', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const baseName = `7-Eleven #${uniq} - Tampa, FL`;
    const rebidName = `7-Eleven #${uniq} (REBID) - Tampa, FL`;
    const unrelatedName = `Firestone Prototype ${uniq}`;

    // The "original" invitation, already accepted into a submitted bid.
    const bidRes = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: baseName, gc: 'Bay to Bay Properties, LLC' }).expect(200);
    const bidId = bidRes.body.id as string;
    await pool.query(`UPDATE bids SET stage='submitted' WHERE id=$1`, [bidId]);

    // The REBID re-invitation, still pending in the inbox.
    const intakeRes = await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: rebidName, gc: 'Bay to Bay Properties, LLC' }).expect(200);
    const intakeId = intakeRes.body.id as string;

    // An unrelated pending item that must NOT show up as similar.
    await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: unrelatedName, gc: 'Some Other GC' }).expect(200);

    const list = await request(app).get('/api/intake').set(auth(u.token)).expect(200);
    const rebidItem = list.body.find((r: { id: string }) => r.id === intakeId);
    expect(rebidItem).toBeTruthy();
    expect(Array.isArray(rebidItem.similar)).toBe(true);
    expect(rebidItem.similar).toEqual([
      expect.objectContaining({ kind: 'bid', id: bidId, name: baseName, stage: 'submitted' }),
    ]);
  });

  it('does not flag a pending item with no similar counterpart', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const soloRes = await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: `Totally Unique Standalone Project ${uniq}`, gc: 'Nobody Construction' }).expect(200);

    const list = await request(app).get('/api/intake').set(auth(u.token)).expect(200);
    const solo = list.body.find((r: { id: string }) => r.id === soloRes.body.id);
    expect(solo).toBeTruthy();
    expect(solo.similar).toEqual([]);
  });
});
