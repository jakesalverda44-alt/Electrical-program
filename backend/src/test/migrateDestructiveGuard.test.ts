// Audit: Data #1 (Critical) / Task 1 — a migration file containing TRUNCATE or
// DROP TABLE must never be allowed to run on boot unless a human opts in with
// ALLOW_DESTRUCTIVE_MIGRATIONS=1. This is what stood between the 2026-09-02
// incident and a wiped production database: `schema_migrations` living inside
// the very database a bad migration could TRUNCATE. Runs against
// electrical_crm_test only (see harness.ts's incident guard).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbAvailable } from './harness';
import { runMigrations } from '../migrate';
import { pool } from '../db/pool';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

// Post-review B3 — this used to write its temp *.sql fixtures into the real,
// shared migrations directory (`../../../database/migrations`), which every
// other test file's own dbAvailable() -> runMigrations(migrationsDir) call also scans.
// Under the full suite's parallel workers, a concurrent file could catch one
// of these fixtures mid-flight — either as a genuine destructive-migration
// rejection in a process that never opted into ALLOW_DESTRUCTIVE_MIGRATIONS,
// or as an ENOENT if this file's own cleanup deleted it first. runMigrations(migrationsDir)
// now takes an optional directory override; this suite uses its own isolated
// temp directory so nothing it writes is ever visible to another test file.
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-guard-test-'));
afterAll(() => { fs.rmSync(migrationsDir, { recursive: true, force: true }); });

// Track every temp file/table/schema_migrations row this suite creates so it
// can clean up even on failure.
const cleanupFiles: string[] = [];

afterEach(async () => {
  while (cleanupFiles.length) {
    const f = cleanupFiles.pop()!;
    try { fs.unlinkSync(path.join(migrationsDir, f)); } catch { /* already gone */ }
    if (ok) {
      await pool.query('DELETE FROM schema_migrations WHERE filename = $1', [f]);
    }
  }
  if (ok) {
    await pool.query('DROP TABLE IF EXISTS _migrate_guard_test_table');
  }
});

function uniqueName(): string {
  return `999998_guard_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sql`;
}

describe('runMigrations — destructive-statement guard (Task 1)', () => {
  it('throws on a TRUNCATE migration without the opt-in flag, and does not record it as applied', async (ctx) => {
    if (!ok) return ctx.skip();
    const file = uniqueName();
    cleanupFiles.push(file);
    fs.writeFileSync(
      path.join(migrationsDir, file),
      `CREATE TABLE IF NOT EXISTS _migrate_guard_test_table (id int);\nTRUNCATE TABLE _migrate_guard_test_table;\n`
    );

    delete process.env.ALLOW_DESTRUCTIVE_MIGRATIONS;
    await expect(runMigrations(migrationsDir)).rejects.toThrow(/Refusing to run/);

    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    expect(rows.length).toBe(0);
  });

  it('throws on a DROP TABLE migration without the opt-in flag', async (ctx) => {
    if (!ok) return ctx.skip();
    const file = uniqueName();
    cleanupFiles.push(file);
    fs.writeFileSync(
      path.join(migrationsDir, file),
      `DROP TABLE IF EXISTS _migrate_guard_test_table;\n`
    );

    delete process.env.ALLOW_DESTRUCTIVE_MIGRATIONS;
    await expect(runMigrations(migrationsDir)).rejects.toThrow(/Refusing to run/);
  });

  it('does not trip on a comment merely mentioning TRUNCATE (the neutralized 025/056 files)', async (ctx) => {
    if (!ok) return ctx.skip();
    const file = uniqueName();
    cleanupFiles.push(file);
    fs.writeFileSync(
      path.join(migrationsDir, file),
      `-- Historical note: this used to TRUNCATE TABLE something. No longer does.\nSELECT 1;\n`
    );

    delete process.env.ALLOW_DESTRUCTIVE_MIGRATIONS;
    await expect(runMigrations(migrationsDir)).resolves.not.toThrow();

    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    expect(rows.length).toBe(1);
  });

  it('proceeds when ALLOW_DESTRUCTIVE_MIGRATIONS=1 is set', async (ctx) => {
    if (!ok) return ctx.skip();
    const file = uniqueName();
    cleanupFiles.push(file);
    fs.writeFileSync(
      path.join(migrationsDir, file),
      `CREATE TABLE IF NOT EXISTS _migrate_guard_test_table (id int);\nTRUNCATE TABLE _migrate_guard_test_table;\n`
    );

    process.env.ALLOW_DESTRUCTIVE_MIGRATIONS = '1';
    try {
      await expect(runMigrations(migrationsDir)).resolves.not.toThrow();
    } finally {
      delete process.env.ALLOW_DESTRUCTIVE_MIGRATIONS;
    }

    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    expect(rows.length).toBe(1);
  });
});
