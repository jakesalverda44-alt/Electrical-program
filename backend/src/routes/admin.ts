import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createJobFolder,
  createCustomerFolder,
  createSubfolders,
  moveJobToStage,
  ESTIMATING_ACTIVE_BIDS_ROOT,
  ESTIMATING_SUBMITTED_BIDS_ROOT,
  ACTIVE_PROJECTS_ROOT,
  COMPLETED_PROJECTS_ROOT,
  ACTIVE_GENERATOR_JOBS_ROOT,
  COMPLETED_GENERATOR_JOBS_ROOT,
  GEN_SUBFOLDER_NAMES,
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
// Places each bid in the correct stage folder with GC hierarchy.
// POST /api/admin/backfill-drive
router.post('/backfill-drive', asyncHandler(async (_req, res) => {
  const { rows: bids } = await pool.query(
    `SELECT id, name, gc, stage, closed_at FROM bids
     WHERE deleted_at IS NULL AND drive_job_folder_id IS NULL
     ORDER BY created_at ASC`,
  );

  const stageRoot = (stage: string, closed: boolean) => {
    if (closed) return COMPLETED_PROJECTS_ROOT;
    if (stage === 'awarded') return ACTIVE_PROJECTS_ROOT;
    if (stage === 'submitted' || stage === 'lost') return ESTIMATING_SUBMITTED_BIDS_ROOT;
    return ESTIMATING_ACTIVE_BIDS_ROOT;
  };

  const results = { processed: 0, skipped: 0, errors: [] as string[] };

  for (const bid of bids) {
    try {
      const rootId = stageRoot(bid.stage, !!bid.closed_at);
      const jobFolderId = await createJobFolder(bid.name, bid.gc, rootId);
      if (!jobFolderId) {
        results.skipped++;
        results.errors.push(`${bid.name}: Drive not configured or createJobFolder returned null`);
        continue;
      }
      // Project subfolders only for awarded/closed jobs; bids stay folder-only.
      const isProject = bid.stage === 'awarded' || !!bid.closed_at;
      const subfolders = isProject ? await createSubfolders(jobFolderId) : {};
      await pool.query(
        `UPDATE bids SET
           drive_job_folder_id=$1,
           drive_plans_folder_id=$2, drive_estimates_folder_id=$3,
           drive_photos_folder_id=$4, drive_contracts_folder_id=$5,
           drive_submittals_folder_id=$6, drive_rfis_folder_id=$7,
           drive_change_orders_folder_id=$8
         WHERE id=$9`,
        [
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
      results.processed++;
    } catch (err) {
      results.errors.push(`${bid.name}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

// Move all existing job folders to the correct stage root with GC hierarchy.
// Fixes folders created by old backfill (flat Active Projects, wrong stage).
// POST /api/admin/reorganize-drive
router.post('/reorganize-drive', asyncHandler(async (_req, res) => {
  const { rows: bids } = await pool.query(
    `SELECT id, name, gc, stage, closed_at, drive_job_folder_id FROM bids
     WHERE deleted_at IS NULL AND drive_job_folder_id IS NOT NULL
     ORDER BY created_at ASC`,
  );

  const stageRoot = (stage: string, closed: boolean) => {
    if (closed) return COMPLETED_PROJECTS_ROOT;
    if (stage === 'awarded') return ACTIVE_PROJECTS_ROOT;
    if (stage === 'submitted' || stage === 'lost') return ESTIMATING_SUBMITTED_BIDS_ROOT;
    return ESTIMATING_ACTIVE_BIDS_ROOT;
  };

  const results = { moved: 0, skipped: 0, errors: [] as string[] };

  for (const bid of bids) {
    try {
      const destRoot = stageRoot(bid.stage, !!bid.closed_at);
      await moveJobToStage(bid.drive_job_folder_id, bid.gc, destRoot);
      results.moved++;
    } catch (err) {
      results.errors.push(`${bid.name}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

// Backfill Google Drive folders for awarded generator jobs without folders.
// POST /api/admin/backfill-gen-drive
router.post('/backfill-gen-drive', asyncHandler(async (_req, res) => {
  const { rows: gens } = await pool.query(
    `SELECT id, customer, stage, closed_at FROM generator_proposals
     WHERE deleted_at IS NULL AND drive_job_folder_id IS NULL AND stage = 'awarded'
     ORDER BY created_at ASC`,
  );

  const results = { processed: 0, skipped: 0, errors: [] as string[] };

  for (const gen of gens) {
    try {
      const rootId = gen.closed_at ? COMPLETED_GENERATOR_JOBS_ROOT : ACTIVE_GENERATOR_JOBS_ROOT;
      const customerFolderId = await createCustomerFolder(gen.customer, rootId);
      if (!customerFolderId) {
        results.skipped++;
        results.errors.push(`${gen.customer}: Drive not configured or createCustomerFolder returned null`);
        continue;
      }
      const subs = await createSubfolders(customerFolderId, GEN_SUBFOLDER_NAMES);
      await pool.query(
        `UPDATE generator_proposals SET
           drive_job_folder_id=$1,
           drive_engineering_folder_id=$2,
           drive_permit_folder_id=$3,
           drive_contract_folder_id=$4,
           drive_invoices_folder_id=$5
         WHERE id=$6`,
        [
          customerFolderId,
          subs['Engineering'] || null,
          subs['Permit'] || null,
          subs['Contract'] || null,
          subs['Invoices'] || null,
          gen.id,
        ],
      );
      results.processed++;
    } catch (err) {
      results.errors.push(`${gen.customer}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

// Move all existing gen job folders to the correct root (active vs completed).
// POST /api/admin/reorganize-gen-drive
router.post('/reorganize-gen-drive', asyncHandler(async (_req, res) => {
  const { rows: gens } = await pool.query(
    `SELECT id, customer, stage, closed_at, drive_job_folder_id FROM generator_proposals
     WHERE deleted_at IS NULL AND drive_job_folder_id IS NOT NULL
     ORDER BY created_at ASC`,
  );

  const results = { moved: 0, skipped: 0, errors: [] as string[] };

  for (const gen of gens) {
    try {
      const destRoot = gen.closed_at ? COMPLETED_GENERATOR_JOBS_ROOT : ACTIVE_GENERATOR_JOBS_ROOT;
      await moveJobToStage(gen.drive_job_folder_id, gen.customer, destRoot);
      results.moved++;
    } catch (err) {
      results.errors.push(`${gen.customer}: ${(err as Error).message}`);
      results.skipped++;
    }
  }

  res.json(results);
}));

export default router;
