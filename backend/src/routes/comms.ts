import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';

const router = Router();

// Restricted reps only see communications they authored or that are linked to a
// bid/proposal they own; managers/admins see everything. Previously this returned
// every communication in the system to any authenticated user (data leak).
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  // Task 5 (audit data #6) — ElecProjectsPage used to fetch every comm in the
  // system and filter to one project client-side. Optional linked_id filter,
  // same convention as /documents.
  const { linked_id } = req.query as { linked_id?: string };
  const { rows } = scope
    ? await pool.query(
        `SELECT * FROM communications c
         WHERE (c.author = $2
            OR c.linked_id IN (
                 SELECT id::text FROM bids WHERE salesperson_id = $1 AND deleted_at IS NULL
                 UNION
                 SELECT id::text FROM generator_proposals WHERE salesperson_id = $1 AND deleted_at IS NULL
               ))
           ${linked_id ? 'AND c.linked_id = $3' : ''}
         ORDER BY c.created_at DESC LIMIT 200`,
        linked_id ? [scope, req.user!.name, linked_id] : [scope, req.user!.name]
      )
    : linked_id
      ? await pool.query('SELECT * FROM communications WHERE linked_id = $1 ORDER BY created_at DESC LIMIT 200', [linked_id])
      : await pool.query('SELECT * FROM communications ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { kind, div, subject, body, linked_id, linked_name } = req.body;
  if (!kind?.trim() || !subject?.trim()) return res.status(400).json({ error: 'kind and subject required' });
  const author = req.user!.name;
  const { rows } = await pool.query(
    `INSERT INTO communications (kind, div, subject, body, linked_id, linked_name, author)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [kind, div || 'general', subject.trim(), (body||'').trim(), linked_id||null, linked_name||null, author]
  );
  res.json(rows[0]);
});

export default router;
