// Audit: Security #1 (Critical) / Task 2 — a deactivated user (status='inactive')
// must not be able to authenticate through any of the four auth paths: password
// login, forgot-password, reset-password, or Microsoft OAuth. `DELETE
// /api/users/:id` only ever sets status='inactive' (routes/users.ts) — it never
// removes the row or invalidates the password — so the login queries themselves
// are the only gate.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { getJwtSecret } from '../middleware/auth';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const PASSWORD = 'correct-horse-battery-9182';

async function makeCredentialedUser(status: 'active' | 'inactive') {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const email = `it_inactive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.local`;
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, role, password_hash, status) VALUES ($1,$2,'salesperson',$3,$4) RETURNING id`,
    ['Inactive Test User', email, hash, status]
  );
  return { id: rows[0].id as string, email };
}

describe('Deactivated users cannot authenticate (Task 2)', () => {
  it('logs in an active user with the correct password (sanity)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { email } = await makeCredentialedUser('active');
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects password login for an inactive user with 401 Invalid credentials', async (ctx) => {
    if (!ok) return ctx.skip();
    const { email } = await makeCredentialedUser('inactive');
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('forgot-password for an inactive user returns the same generic response as an unknown email', async (ctx) => {
    if (!ok) return ctx.skip();
    const { email } = await makeCredentialedUser('inactive');
    const inactiveRes = await request(app).post('/api/auth/forgot-password').send({ email });
    const unknownRes = await request(app).post('/api/auth/forgot-password')
      .send({ email: `nobody_${Date.now()}@test.local` });
    expect(inactiveRes.status).toBe(200);
    expect(inactiveRes.body).toEqual(unknownRes.body);
    expect(inactiveRes.body).toEqual({ ok: true });
  });

  it('does not set a reset token for an inactive user (forgot-password is a no-op)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { id, email } = await makeCredentialedUser('inactive');
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    const { rows } = await pool.query('SELECT reset_token FROM users WHERE id=$1', [id]);
    expect(rows[0].reset_token).toBeNull();
  });

  it('rejects reset-password for an inactive user even with a valid unexpired token', async (ctx) => {
    if (!ok) return ctx.skip();
    const { id } = await makeCredentialedUser('inactive');
    const token = jwt.sign({ id, purpose: 'reset' }, getJwtSecret(), { expiresIn: '1h' });
    await pool.query(
      "UPDATE users SET reset_token=$1, reset_token_expires=now()+interval'1 hour' WHERE id=$2",
      [token, id]
    );
    const res = await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword123' });
    expect(res.status).toBe(400);
  });
});
