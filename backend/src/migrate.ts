import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from './db/pool';

// Strips SQL line (--) and block (/* */) comments before scanning for
// destructive statements, so a comment mentioning TRUNCATE (like the
// neutralized 025/056 migrations) does not itself trip the guard.
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const DESTRUCTIVE_PATTERN = /\b(TRUNCATE|DROP\s+TABLE)\b/i;

export async function runMigrations(): Promise<void> {
  // Tracking table — safe to create on every startup
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const migrationsDir = path.join(__dirname, '../../database/migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrate] No migrations directory found, skipping');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1', [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    if (DESTRUCTIVE_PATTERN.test(stripSqlComments(sql)) && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== '1') {
      throw new Error(
        `[migrate] Refusing to run "${file}": it contains TRUNCATE or DROP TABLE. ` +
        `Set ALLOW_DESTRUCTIVE_MIGRATIONS=1 to allow this on purpose.`
      );
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] Failed on ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  // Bootstrap the first account if the users table is empty. Credentials are NOT
  // committed to the repo — they come from the environment so production never ships
  // with a known default password. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD on
  // first boot; leave them unset to skip seeding (e.g. when restoring a real DB).
  const { rows: userRows } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (userRows.length === 0) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrator';
    if (email && password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT (email) DO NOTHING`,
        [name, email, hash]
      );
      console.log(`[migrate] Seeded initial owner account: ${email}`);
    } else {
      console.warn('[migrate] users table is empty and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are not set — no account created. Set them once to bootstrap the first login.');
    }
  }
}
