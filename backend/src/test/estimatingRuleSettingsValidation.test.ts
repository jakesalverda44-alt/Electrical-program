// Fix round SF-4 — PUT /api/settings refuses (400) a malformed or negative
// est_footage_ratios / est_cost_line_defaults instead of storing it and
// silently falling back to the defaults at pricing time.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { dbAvailable, makeUser, auth } from './harness';
import { validateFootageSettingsJson, DEFAULT_FOOTAGE_SETTINGS } from '../estimating/footageAllowance';
import { validateCostLineDefaultsJson, DEFAULT_COST_LINE_DEFAULTS } from '../estimating/costLineDefaults';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('SF-4 — validators', () => {
  it('accept the shipped defaults, refuse bad JSON / negatives / shares over 1 / non-strings', () => {
    expect(validateFootageSettingsJson(JSON.stringify(DEFAULT_FOOTAGE_SETTINGS))).toEqual([]);
    expect(validateCostLineDefaultsJson(JSON.stringify(DEFAULT_COST_LINE_DEFAULTS))).toEqual([]);
    expect(validateFootageSettingsJson('{bad')).toEqual(['is not valid JSON']);
    expect(validateFootageSettingsJson(JSON.stringify({ mcPerFixture: -1 }))).toEqual(['mcPerFixture must be at least 0']);
    expect(validateFootageSettingsJson(JSON.stringify({ wire10Share: 1.5 }))).toEqual(['wire10Share must be at most 1']);
    expect(validateFootageSettingsJson(JSON.stringify({ emtPerPoint: { device: '7' } }))).toEqual(['emtPerPoint.device must be a number']);
    expect(validateFootageSettingsJson(42)).toEqual(['must be a JSON string']);
    expect(validateCostLineDefaultsJson(JSON.stringify({ equipment: { perHour: -2 } }))).toEqual(['equipment.perHour must be at least 0']);
  });
});

describe('SF-4 — PUT /api/settings', () => {
  it('400 on a bad value (nothing stored), 200 on a valid one', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const before = Object.fromEntries(((await request(app).get('/api/settings').set(auth(admin.token)).expect(200)).body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    const bad = await request(app).put('/api/settings').set(auth(admin.token)).send({ est_footage_ratios: JSON.stringify({ mcPerFixture: -1 }) }).expect(400);
    expect(bad.body.error).toMatch(/est_footage_ratios: mcPerFixture must be at least 0/);
    await request(app).put('/api/settings').set(auth(admin.token)).send({ est_cost_line_defaults: '{nope' }).expect(400);
    await request(app).put('/api/settings').set(auth(admin.token)).send({ est_footage_ratios: 7 }).expect(400);
    const after = Object.fromEntries(((await request(app).get('/api/settings').set(auth(admin.token)).expect(200)).body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(after.est_footage_ratios).toBe(before.est_footage_ratios);
    expect(after.est_cost_line_defaults).toBe(before.est_cost_line_defaults);
    // A valid round-trip of the current values is accepted (and changes nothing other tests read).
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ est_footage_ratios: before.est_footage_ratios, est_cost_line_defaults: before.est_cost_line_defaults }).expect(200);
  });
});
