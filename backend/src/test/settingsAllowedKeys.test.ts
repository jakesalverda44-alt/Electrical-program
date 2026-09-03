// Post-review FIX-4 — Task 4.2's quiet-proposal follow-up setting
// (elec_followup_quiet_days, Settings > Notifications) was missing from
// routes/settings.ts's ALLOWED_KEYS, so a save silently discarded it (PUT
// only writes keys present in that list) while the UI still reported
// success. This locks the round-trip: PUT then GET must actually reflect
// the new value.
//
// Post-merge rework (2026-09-03) — elec_followup_viewed_days is gone (the
// "viewed" tier it drove was removed along with the public proposal page)
// and was dropped from ALLOWED_KEYS too, so this test now only covers the
// one remaining key.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PUT/GET /api/settings — elec_followup_quiet_days round-trip (FIX-4)', () => {
  it('persists elec_followup_quiet_days', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');

    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ elec_followup_quiet_days: '9' })
      .expect(200);

    const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.elec_followup_quiet_days).toBe('9');

    // Reset — app_settings is a single shared row per key, and
    // services/proposalQuietSweep.ts's bid sweep (bidQuietSweep.test.ts)
    // reads this same key with a default ('' falls back to the default,
    // per numericSetting's `raw || String(fallback)`). Leaving a custom
    // value here would silently change that other suite's cutoffs.
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ elec_followup_quiet_days: '' })
      .expect(200);
  });

  it('no longer persists elec_followup_viewed_days — removed from ALLOWED_KEYS', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');

    // A distinctive sentinel value — if the PUT below reached the row
    // (i.e. the key were still in ALLOWED_KEYS), the GET would see it. Any
    // pre-existing row from before this key was removed from ALLOWED_KEYS
    // (a harmless orphan — see routes/settings.ts's comment) must NOT
    // change to this value.
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ elec_followup_viewed_days: 'still-orphaned-9182' })
      .expect(200);

    const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.elec_followup_viewed_days).not.toBe('still-orphaned-9182');
  });
});

// FIX-11 (post-review) — prebid_chris_email moved out of the frontend's
// hardcoded recipient into this setting; POST /bids/:id/email-prebid-chris
// reads it (see bidSendProposal.test.ts for that behavior).
describe('PUT/GET /api/settings — prebid_chris_email round-trip (FIX-11)', () => {
  it('persists prebid_chris_email', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');

    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ prebid_chris_email: 'chris.roundtrip@example.com' })
      .expect(200);

    const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.prebid_chris_email).toBe('chris.roundtrip@example.com');

    // Reset so this doesn't leak a custom value into other tests.
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ prebid_chris_email: '' })
      .expect(200);
  });
});
