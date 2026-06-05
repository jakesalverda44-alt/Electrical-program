import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getOrCreateGcFolder,
  createJobFolder,
  createSubfolders,
  moveFolder,
  ACTIVE_PROJECTS_ROOT,
  COMPLETED_PROJECTS_ROOT,
} from '../services/googleDrive';

const router = Router();

// All admin endpoints require owner/administrator.
router.use(requireAuth, requireAdmin);

// Trash — soft-deleted records across the supported entity types. The frontend
// restores/purges via the resource routes (e.g. POST /bids/:id/restore).
router.get('/trash', asyncHandler(async (_req, res) => {
  const [bids, gens, docs] = await Promise.all([
    pool.query(
      `SELECT id, name, gc, amount, stage, deleted_at FROM bids
       WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    ),
    pool.query(
      `SELECT id, customer, amount, stage, deleted_at FROM generator_proposals
       WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    ),
    pool.query(
      `SELECT id, name, display_name, linked_name, category, file_size, deleted_at FROM documents
       WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    ),
  ]);
  res.json({ bids: bids.rows, gens: gens.rows, documents: docs.rows });
}));

// Audit log — most recent money/identity/permission changes. Optional filters:
// ?entity_type=bid&action=award&limit=100
router.get('/audit', asyncHandler(async (req, res) => {
  const { entity_type, action } = req.query as { entity_type?: string; action?: string };
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  if (entity_type) { params.push(entity_type); where.push(`entity_type = $${params.length}`); }
  if (action)      { params.push(action);      where.push(`action = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, user_id, user_name, action, entity_type, entity_id, summary, created_at
     FROM audit_log ${clause} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows);
}));

// Backfill Google Drive folders for all existing bids that don't have one yet.
// POST /api/admin/backfill-drive
// Returns { processed, skipped, errors } — runs synchronously so the response
// carries the full result (may take a minute for large pipelines).
router.post('/backfill-drive', asyncHandler(async (_req, res) => {
  const { rows: bids } = await pool.query(
    `SELECT id, name, gc, stage FROM bids
     WHERE deleted_at IS NULL AND drive_job_folder_id IS NULL
     ORDER BY created_at ASC`,
  );

  const results = { processed: 0, skipped: 0, errors: [] as string[] };

  for (const bid of bids) {
    try {
      const [gcFolderId, jobFolderId] = await Promise.all([
        getOrCreateGcFolder(bid.gc),
        createJobFolder(bid.name, bid.gc),
      ]);
      if (!jobFolderId) {
        results.skipped++;
        results.errors.push(`${bid.name}: Drive not configured or createJobFolder returned null`);
        continue;
      }
      const subfolders = await createSubfolders(jobFolderId);
      await pool.query(
        `UPDATE bids SET
           drive_gc_folder_id=$1, drive_job_folder_id=$2,
           drive_plans_folder_id=$3, drive_estimates_folder_id=$4,
           drive_photos_folder_id=$5, drive_contracts_folder_id=$6,
           drive_submittals_folder_id=$7, drive_rfis_folder_id=$8,
           drive_change_orders_folder_id=$9
         WHERE id=$10`,
        [
          gcFolderId,
          jobFolderId,
          subfolders['Plans & Specs'] || null,
          subfolders['Estimates & Scope Extractions'] || null,
          subfolders['Photos'] || null,
          subfolders['Contract & Invoices'] || null,
          subfolders['Submittals'] || null,
          subfolders['RFIs'] || null,
          subfolders['Change Orders'] || null,
          bid.id,
        ],
      );
      // Awarded = active job in progress — folder stays in Active Projects.
      results.processed++;
    } catch (err) {
      results.errors.push(`${bid.name}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

// Move awarded (in-progress) job folders back to Active Projects.
// Fixes the one-time backfill that incorrectly placed them in Completed Projects.
// POST /api/admin/fix-drive-awarded
router.post('/fix-drive-awarded', asyncHandler(async (_req, res) => {
  const { rows: bids } = await pool.query(
    `SELECT id, name, drive_job_folder_id FROM bids
     WHERE stage = 'awarded' AND closed_at IS NULL
       AND deleted_at IS NULL AND drive_job_folder_id IS NOT NULL
     ORDER BY created_at ASC`,
  );

  const results = { moved: 0, skipped: 0, errors: [] as string[] };

  for (const bid of bids) {
    try {
      await moveFolder(bid.drive_job_folder_id, COMPLETED_PROJECTS_ROOT, ACTIVE_PROJECTS_ROOT);
      results.moved++;
    } catch (err) {
      results.errors.push(`${bid.name}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

export default router;
