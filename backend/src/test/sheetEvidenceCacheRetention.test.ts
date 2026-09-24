// Fix round N7 — migration 133's sheet_evidence_cache (evidence round
// Parts 1-3's viewport/typical/schedule reader cache) had no retention at
// all. purgeExpired now removes rows older than a fixed 180 days,
// regardless of the caller's retentionMonths (a stale cache entry is safe
// to drop — a re-analysis just re-reads the sheet, same as it already does
// for a changed file or a new prompt version).
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { purgeExpired } from '../utils/audit';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('sheet_evidence_cache retention (N7)', () => {
  it('purge removes a 200-day-old cache row and keeps a 100-day-old one', async (ctx) => {
    if (!ok) return ctx.skip();
    const mk = async (sha: string, ageDays: number) => {
      await pool.query(
        `INSERT INTO sheet_evidence_cache (content_sha256, page, kind, cache_key, result, created_at)
         VALUES ($1, 1, 'viewports', 'v1', '{}'::jsonb, now() - ($2 || ' days')::interval)`,
        [sha, String(ageDays)]
      );
      return sha;
    };
    const old = await mk(`old-${Math.random()}`, 200);
    const recent = await mk(`recent-${Math.random()}`, 100);

    await purgeExpired(12); // months — irrelevant here, the window is a fixed 180 days

    const { rows } = await pool.query(
      `SELECT content_sha256 FROM sheet_evidence_cache WHERE content_sha256 = ANY($1::text[])`,
      [[old, recent]]
    );
    const remaining = new Set(rows.map(r => r.content_sha256));
    expect(remaining.has(old)).toBe(false);
    expect(remaining.has(recent)).toBe(true);
  });
});
