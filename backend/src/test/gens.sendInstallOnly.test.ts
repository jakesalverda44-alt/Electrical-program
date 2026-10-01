// POST /gens/:id/send and the public link refuse an install-only proposal that fails validation.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';
import { IO_ISSUE_INCOMPLETE, IO_ISSUE_RUNFT } from '../utils/genTotals';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const goodForm = {
  jobType: 'install-only', brand: 'Kohler', coolingType: 'air-cooled', size: '14KW', atsSize: '200A', atsQty: 1,
  labor: 0, permit: 475, startup: 695, pad: true, battery: true, genStand: 'none', liftType: 'none',
  installOnly: { setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 40, gas: false, permit: true, unitDesc: '' },
};

async function create(token: string, form: Record<string, unknown>) {
  const res = await request(app).post('/api/gens').set(auth(token))
    .send({ customer: `Send IO ${Date.now()}`, form_data: form }).expect(200);
  return res.body as { id: string; proposal_token: string };
}

describe('install-only send gate', () => {
  it('422s a 0 ft run (drafts can still be saved)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await create(u.token, { ...goodForm, installOnly: { ...goodForm.installOnly, runFt: 0 } });
    const res = await request(app).post(`/api/gens/${gen.id}/send`).set(auth(u.token)).send({ to: 'a@b.com' }).expect(422);
    expect(res.body.issues).toContain(IO_ISSUE_RUNFT);
    await request(app).get(`/api/gens/p/${gen.proposal_token}`).expect(422);
    await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
  });

  it('422s a lead-converted install-only form that was never opened in the builder', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await create(u.token, { jobType: 'install-only', brand: 'Kohler', size: '14KW', customer: 'Lead' });
    const res = await request(app).post(`/api/gens/${gen.id}/send`).set(auth(u.token)).send({ to: 'a@b.com' }).expect(422);
    expect(res.body.issues).toEqual([IO_ISSUE_INCOMPLETE]);
  });

  it('does not block a valid install-only public link or a legacy proposal', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const good = await create(u.token, goodForm);
    await request(app).get(`/api/gens/p/${good.proposal_token}`).expect(200);
    const legacy = await create(u.token, { jobType: 'new-install', brand: 'Kohler', size: '14KW' });
    await request(app).get(`/api/gens/p/${legacy.proposal_token}`).expect(200);
  });
});
