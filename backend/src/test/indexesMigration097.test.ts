// Audit batch 3, Task 4 (audit-data-perf.md #11, #12, #13, #19) — migration
// 097 adds the missing FK/filter indexes and drops the duplicate
// docs_linked_idx. Verifies the migration actually landed in the test DB
// (runMigrations() has already run by the time any test file executes).
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const EXPECTED_INDEXES = [
  'bids_signed_document_idx',
  'customers_owner_idx',
  'gens_countersigned_by_idx',
  'intake_items_created_by_idx',
  'leads_linked_gen_idx',
  'leads_active_created_idx',
  'intake_items_updated_idx',
  'tasks_linked_idx',
  'documents_div_linked_idx',
];

describe('migration 097 — indexes (audit data #11, #12, #13, #19)', () => {
  it('creates every index the plan named', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
      [EXPECTED_INDEXES]
    );
    const found = new Set(rows.map(r => r.indexname));
    for (const name of EXPECTED_INDEXES) expect(found.has(name)).toBe(true);
  });

  it('drops the duplicate docs_linked_idx and keeps doc_linked_idx', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='documents' AND indexname IN ('doc_linked_idx','docs_linked_idx')`
    );
    const names = rows.map(r => r.indexname);
    expect(names).toContain('doc_linked_idx');
    expect(names).not.toContain('docs_linked_idx');
  });
});
