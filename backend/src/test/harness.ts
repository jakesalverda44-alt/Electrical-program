import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { runMigrations } from '../migrate';
import { getJwtSecret } from '../middleware/auth';

let ready: boolean | null = null;

/**
 * True when a Postgres is reachable and migrations have been applied. Cached.
 * Integration tests use this to skip gracefully when no database is available
 * (e.g. a local `npm test` without a DB) — in CI the postgres service is up so
 * they run for real.
 */
export async function dbAvailable(): Promise<boolean> {
  if (ready !== null) return ready;
  try {
    await pool.query('SELECT 1');
    await runMigrations();
    ready = true;
  } catch {
    ready = false;
  }
  return ready;
}

let seq = 0;

export interface TestUser { id: string; name: string; email: string; role: string; token: string }

/** Create a user with the given role and return a signed token for it. */
export async function makeUser(role: string): Promise<TestUser> {
  seq++;
  const email = `it_${role}_${Date.now()}_${seq}@test.local`;
  const name = `IT ${role} ${seq}`;
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, role, password_hash, status) VALUES ($1,$2,$3,'x','active') RETURNING id`,
    [name, email, role]
  );
  const id = rows[0].id as string;
  const token = jwt.sign({ id, name, email, role }, getJwtSecret(), { expiresIn: '1h' });
  return { id, name, email, role, token };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
