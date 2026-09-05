import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool, STATEMENT_TIMEOUT_MS } from './db/pool';

// Strips SQL line (--) and block (/* */) comments before scanning for
// destructive statements, so a comment mentioning TRUNCATE (like the
// neutralized 025/056 migrations) does not itself trip the guard.
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const DESTRUCTIVE_PATTERN = /\b(TRUNCATE|DROP\s+TABLE)\b/i;

// Post-review B3: migrateDestructiveGuard.test.ts (Batch 1) used to write its
// temp *.sql fixtures directly into the real, shared migrations directory
// every other test file's dbAvailable() -> runMigrations() call also scans.
// With dbAvailable() now rethrowing instead of silently skipping on any
// non-connection error (the whole point of B3), that made an unrelated test
// file's own migration check intermittently throw the destructive-guard
// error (or ENOENT, if it raced the other way) for a file it never wrote and
// has nothing to do with. The optional override lets a caller point
// runMigrations() at an isolated directory instead — used only by that test
// file; every real caller (server boot, every other test's dbAvailable())
// omits it and gets the real, shared directory exactly as before.
export async function runMigrations(migrationsDirOverride?: string): Promise<void> {
  // Tracking table — safe to create on every startup
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const migrationsDir = migrationsDirOverride ?? path.join(__dirname, '../../database/migrations');
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

    // Post-review B3: a file present in the readdir() snapshot above can still
    // vanish before this read — in production that can't happen (nothing
    // deletes migration files while the app is running), but under the
    // backend test suite's parallel workers, migrateDestructiveGuard.test.ts
    // writes and cleans up its own temp *.sql files directly in this real,
    // shared directory, and a concurrent file's runMigrations() call can
    // catch one mid-flight. Skip it rather than crashing every other test
    // file's dbAvailable() check with an unrelated ENOENT.
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`[migrate] ${file} listed but vanished before it could be read — skipping (expected only under concurrent test workers)`);
        continue;
      }
      throw err;
    }
    if (DESTRUCTIVE_PATTERN.test(stripSqlComments(sql)) && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== '1') {
      throw new Error(
        `[migrate] Refusing to run "${file}": it contains TRUNCATE or DROP TABLE. ` +
        `Set ALLOW_DESTRUCTIVE_MIGRATIONS=1 to allow this on purpose.`
      );
    }
    const client = await pool.connect();
    try {
      // Post-review hardening (5a) — db/pool.ts sets statement_timeout: 15_000
      // as a connection-startup parameter (Task 10), so every checked-out
      // client — this one included — already has it active. A legitimate
      // migration over real data (096's notification dedup collapse, at
      // production's current scale a few thousand rows, comfortably under
      // 15s — but there is no guarantee a future migration over a larger
      // table stays under it) must never be killed mid-migration by a limit
      // that exists to catch a runaway *application* query, not a one-time
      // schema/data migration running inside its own transaction. Disabled
      // only for the duration of this migration's BEGIN/COMMIT, and always
      // reset before the connection is released back to the pool — otherwise
      // a later, unrelated query reusing this same pooled connection would
      // silently run with no timeout at all.
      await client.query('SET statement_timeout = 0');
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
      await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`).catch(() => {});
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
