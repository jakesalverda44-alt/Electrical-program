import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

// Regression coverage for the contact-edit-save bug: PATCHing a customer with
// empty/unset fields sent as `null` (as the frontend does — it PATCHes the
// full row, and untouched optional fields render as null) must succeed, not
// 400 with a Zod "Expected string, received null" error. Skips without a
// reachable Postgres, same pattern as integration.test.ts.
describe('PATCH /customers/:id (integration)', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  it('accepts null for optional fields and updates the row', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const created = await request(app).post('/api/customers').set(auth(user.token))
      .send({ name: `Null Fields ${Date.now()}`, type: 'customer' })
      .expect(200);
    const id = created.body.id as string;

    const patched = await request(app).patch(`/api/customers/${id}`).set(auth(user.token))
      .send({ phone: '5551234', company: null })
      .expect(200);

    expect(patched.body.phone).toBe('5551234');
    expect(patched.body.company).toBeNull();
  });

  it('still rejects an invalid email', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const created = await request(app).post('/api/customers').set(auth(user.token))
      .send({ name: `Bad Email ${Date.now()}`, type: 'customer' })
      .expect(200);
    const id = created.body.id as string;

    await request(app).patch(`/api/customers/${id}`).set(auth(user.token))
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
