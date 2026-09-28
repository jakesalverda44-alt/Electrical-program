// B4 (2026-09-28) — documents filed before migration 146 have a NULL
// content_sha256, so the plans dedupe (which matches on the hash) never saw
// them. This computes the hash from the stored bytes.
//
// Two callers, chosen for different jobs:
//  * storeDocument's dedupe path runs it ON DEMAND for the one bid being
//    uploaded to (a handful of plan rows, done once per bid, then it is a
//    no-op) — dedupe is correct the moment it matters, not after a boot.
//  * index.ts runs it after boot, fire-and-forget, capped per boot, so
//    legacy rows for bids nobody has re-uploaded to still get filled without
//    ever blocking startup. Rows whose bytes cannot be read are left NULL
//    (counted as unreadable) and retried on the next boot.
import crypto from 'crypto';
import { pool } from '../db/pool';
import { logger } from './logger';
import { getFileMedia } from '../services/googleDrive';

export interface DocBytesSource { file_data?: string | null; storage_url?: string | null }

/** The stored bytes of a document row: the base64 column, else Drive, else its URL. */
export async function loadDocumentBytes(doc: DocBytesSource): Promise<Buffer | null> {
  if (doc.file_data) return Buffer.from(doc.file_data, 'base64');
  if (!doc.storage_url) return null;
  const driveMatch = doc.storage_url.match(/\/file\/d\/([^/?#]+)/);
  if (driveMatch) {
    const media = await getFileMedia(driveMatch[1]);
    if (!media) return null;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      media.stream.on('data', (c: Buffer) => chunks.push(c));
      media.stream.on('end', () => resolve(Buffer.concat(chunks)));
      media.stream.on('error', reject);
    });
  }
  const resp = await fetch(doc.storage_url);
  return resp.ok ? Buffer.from(await resp.arrayBuffer()) : null;
}

export interface BackfillResult { scanned: number; hashed: number; unreadable: number }

export async function backfillContentHashes(opts: { limit?: number; bidId?: string; category?: string; localOnly?: boolean } = {}): Promise<BackfillResult> {
  const limit = Math.max(1, opts.limit ?? 200);
  const params: unknown[] = [limit];
  let where = `deleted_at IS NULL AND generated = false AND content_sha256 IS NULL AND (file_data IS NOT NULL OR storage_url IS NOT NULL)`;
  // Boot pass: DB-stored bytes only — no Drive/URL downloads on every restart.
  if (opts.localOnly) where += ' AND file_data IS NOT NULL';
  if (opts.bidId) { params.push(opts.bidId); where += ` AND linked_id=$${params.length}::text`; }
  if (opts.category) { params.push(opts.category); where += ` AND category=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT id, file_data, storage_url FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT $1`, params);
  const result: BackfillResult = { scanned: rows.length, hashed: 0, unreadable: 0 };
  for (const r of rows) {
    try {
      const buf = await loadDocumentBytes(r);
      if (!buf || !buf.length) { result.unreadable++; continue; }
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      await pool.query('UPDATE documents SET content_sha256=$2 WHERE id=$1 AND content_sha256 IS NULL', [r.id, h]);
      result.hashed++;
    } catch (err) {
      result.unreadable++;
      logger.warn({ err, docId: r.id }, '[backfillContentHashes] could not read document bytes');
    }
  }
  return result;
}

/** Boot-time pass: capped, never throws, logs the counts. */
export async function backfillContentHashesOnBoot(limit = 200): Promise<void> {
  try {
    const r = await backfillContentHashes({ limit, localOnly: true });
    if (r.scanned) logger.info(r, '[backfillContentHashes] boot pass');
  } catch (err) {
    logger.warn({ err }, '[backfillContentHashes] boot pass failed');
  }
}
