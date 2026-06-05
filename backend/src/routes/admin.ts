import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

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

export default router;
