// Takeoff accuracy Task 8 — account_rules: the migration 114 seed, admin-only
// edits with validation, the Default rule can't be deleted, and the pipeline
// snapshot for an AutoZone bid (power poles 'ask' -> a scope question when the
// drawings are silent; an explicit statement answers it instead).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { buildAccountTermsSnapshot } from '../bidstd/accountRulesDb';
import { kissimmeeAgent1 } from './fixtures/takeoff/agent1Fixtures';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('account_rules seed (migration 114)', () => {
  it('Default, AutoZone and 7-Eleven exist with the terms Jake set', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const res = await request(app).get('/api/account-rules').set(auth(u.token)).expect(200);
    const byName = Object.fromEntries((res.body.rules as Array<{ name: string }>).map(r => [r.name, r]));
    expect(byName.Default).toMatchObject({ isDefault: true, terms: { lighting: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT', vendor: 'Southern Lighting Source national account', contact: '770-242-4000' } } });
    expect(byName.AutoZone).toMatchObject({
      matchAliases: ['AutoZone', 'Auto Zone', 'AutoZone Stores'],
      noMdpUnlessOnDrawings: true,
      terms: {
        lighting: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT', vendor: 'Graybar national account' },
        panels: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT' },
        disconnects: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT' },
        power_poles: { mode: 'ask' },
      },
    });
    expect(byName['7-Eleven']).toMatchObject({ terms: { lighting: { furnishBy: 'GC', installBy: 'APT', vendor: 'Graybar national account', contact: 'Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com' } } });
  });
});

describe('account rule edits', () => {
  it('admin creates / edits; validation errors are 400; a salesperson is refused; Default cannot be deleted', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const rep = await makeUser('salesperson');
    const name = `Car wash ${Date.now()}`;
    await request(app).post('/api/account-rules').set(auth(rep.token)).send({ name, projectTypes: ['car_wash'] }).expect(403);
    expect((await request(app).post('/api/account-rules').set(auth(admin.token)).send({ name })).body.error).toMatch(/at least one alias/);
    expect((await request(app).post('/api/account-rules').set(auth(admin.token)).send({ name, projectTypes: ['car_wash'], terms: { lighting: { mode: 'fixed', furnishBy: 'Somebody', installBy: 'APT' } } })).body.error)
      .toMatch(/furnish-by and install-by must each be one of APT, GC, Owner, Vendor, Others/);
    const created = await request(app).post('/api/account-rules').set(auth(admin.token))
      .send({ name, projectTypes: ['car_wash'], terms: { other_equipment: { mode: 'fixed', furnishBy: 'Vendor', installBy: 'Vendor' } } }).expect(200);
    expect(created.body.terms.other_equipment).toEqual({ mode: 'fixed', furnishBy: 'Vendor', installBy: 'Vendor' });
    await request(app).put(`/api/account-rules/${created.body.id}`).set(auth(admin.token))
      .send({ name, projectTypes: ['car_wash'], terms: { other_equipment: { mode: 'ask' } } }).expect(200);
    const list = await request(app).get('/api/account-rules').set(auth(admin.token)).expect(200);
    const def = (list.body.rules as Array<{ id: string; isDefault: boolean }>).find(r => r.isDefault)!;
    expect((await request(app).delete(`/api/account-rules/${def.id}`).set(auth(admin.token))).body.error).toMatch(/cannot be deleted/);
    expect((await request(app).put(`/api/account-rules/${def.id}`).set(auth(admin.token)).send({ name: 'Default', matchAliases: ['x'] })).body.error).toMatch(/cannot have aliases/);
    await request(app).delete(`/api/account-rules/${created.body.id}`).set(auth(admin.token)).expect(200);
  });
});

describe('buildAccountTermsSnapshot on the seeded rules', () => {
  it('Kissimmee (E-2 "BY GC" power pole statement): AutoZone matched by the owner on the drawings; Decision 4 — still asked, APT pre-filled', async (ctx) => {
    if (!ok) return ctx.skip();
    const snap = await buildAccountTermsSnapshot({ name: 'Kissimmee FL 10077', brand: null, project_type: 'retail' }, kissimmeeAgent1());
    expect(snap.ruleName).toBe('AutoZone');
    expect(snap.matchedBy).toBe('"AutoZone" in the drawings');
    expect(snap.resolved.find(t => t.term === 'power_poles')).toBeUndefined();
    expect(snap.questions.map(q => `${q.term}:${q.half}:${q.suggested}`)).toEqual(['power_poles:furnish:APT', 'power_poles:install:APT']);
    expect(snap.mdpOnDrawings).toBe(false);
  });
  it('no statement on the drawings -> a power poles scope question', async (ctx) => {
    if (!ok) return ctx.skip();
    const a1 = { ...kissimmeeAgent1(), furnishStatements: [] };
    const snap = await buildAccountTermsSnapshot({ name: 'x', brand: 'AutoZone', project_type: null }, a1);
    // Fix round 1 / B7 — asked in two halves.
    expect(snap.questions.map(q => `${q.term}:${q.half}`)).toEqual(['power_poles:furnish', 'power_poles:install']);
  });
  it('S8 — the seeded 7-Eleven rule carries the 7-11 / 711 aliases (migration 119); a brand with no rule warns', async (ctx) => {
    if (!ok) return ctx.skip();
    const snap = await buildAccountTermsSnapshot({ name: '7-11 #41234', brand: null, project_type: null }, { project: {} });
    expect(snap.ruleName).toBe('7-Eleven');
    // Fix round 2 / R2-B3 — migration 120 removed the bare "711": store
    // numbers, street numbers and suites never make a job 7-Eleven.
    expect((await buildAccountTermsSnapshot({ name: 'AutoZone Store #711 Orlando', brand: 'AutoZone', project_type: null }, { project: {} })).ruleName).toBe('AutoZone');
    expect((await buildAccountTermsSnapshot({ name: "Dunkin' - 711 Main St", brand: null, project_type: null }, { project: {} })).ruleName).toBe('Default');
    expect((await buildAccountTermsSnapshot({ name: 'Retail shell', brand: null, project_type: null }, { project: { name: 'SUITE 711' } })).ruleName).toBe('Default');
    const other = await buildAccountTermsSnapshot({ name: 'Store', brand: 'Wawa', project_type: null }, { project: {} });
    expect(other.ruleName).toBe('Default');
    expect(other.warning).toMatch(/brand "Wawa" matched no account rule/);
  });
});
