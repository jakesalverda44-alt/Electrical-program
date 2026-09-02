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
    // Belt-and-suspenders guard (added after the 2026-09-02 incident: the test
    // suite ran against the live dev DB and created hundreds of fake rows). The
    // package.json `test` script sets DB_NAME=electrical_crm_test, but that alone
    // is one env var away from disaster — a DATABASE_URL left set, a script edited
    // back, a test run from an IDE with its own env. Refuse outright, don't skip,
    // if the connected database is the live one, regardless of how it got connected.
    const { rows } = await pool.query('SELECT current_database() AS db');
    const currentDb = rows[0]?.db;
    if (currentDb === 'electrical_crm') {
      throw new Error(
        `Refusing to run tests against the live database "electrical_crm". ` +
        `Tests must run against "electrical_crm_test" (set DB_NAME=electrical_crm_test). ` +
        `See the 2026-09-02 incident note in the phase 1 plan.`
      );
    }
    await runMigrations();
    ready = true;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Refusing to run tests against the live database')) {
      throw err;
    }
    ready = false;
  }
  return ready;
}

let seq = 0;

export interface TestUser { id: string; name: string; email: string; role: string; token: string }

/** Create a user with the given role and return a signed token for it. */
export async function makeUser(role: string): Promise<TestUser> {
  seq++;
  // pid + random suffix: `seq` is per-worker module state and Date.now() has
  // millisecond resolution, so two parallel vitest workers minting the same role
  // in the same millisecond used to collide on users_email_key (flaky failures
  // in whichever test files ran together that time).
  const uniq = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `it_${role}_${Date.now()}_${seq}_${uniq}@test.local`;
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
