// Post-review FIX-4 — Task 4.2's quiet-proposal follow-up settings
// (elec_followup_quiet_days/elec_followup_viewed_days, Settings >
// Notifications) were missing from routes/settings.ts's ALLOWED_KEYS, so a
// save silently discarded them (PUT only writes keys present in that list)
// while the UI still reported success. This locks the round-trip: PUT then
// GET must actually reflect the new value.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PUT/GET /api/settings — elec_followup_* round-trip (FIX-4)', () => {
  it('persists elec_followup_quiet_days and elec_followup_viewed_days', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');

    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ elec_followup_quiet_days: '9', elec_followup_viewed_days: '4' })
      .expect(200);

    const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.elec_followup_quiet_days).toBe('9');
    expect(byKey.elec_followup_viewed_days).toBe('4');
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
