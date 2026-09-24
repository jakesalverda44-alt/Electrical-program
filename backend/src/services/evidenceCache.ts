// Evidence round — the DB-backed cache for the evidence readers (migration
// 133). A read or write failure never fails a run: the reader just calls
// the model again.
import { pool } from '../db/pool';
import type { EvidenceCache } from '../ai/evidence/evidenceStage';

export const dbEvidenceCache: EvidenceCache = {
  async get(sha, page, kind, cacheKey) {
    const { rows } = await pool.query(
      'SELECT result FROM sheet_evidence_cache WHERE content_sha256=$1 AND page=$2 AND kind=$3 AND cache_key=$4',
      [sha, page, kind, cacheKey]);
    return rows[0]?.result ?? null;
  },
  async set(sha, page, kind, cacheKey, value) {
    await pool.query(
      `INSERT INTO sheet_evidence_cache (content_sha256, page, kind, cache_key, result) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (content_sha256, page, kind, cache_key) DO UPDATE SET result = EXCLUDED.result, created_at = now()`,
      [sha, page, kind, cacheKey, JSON.stringify(value)]);
  },
};
