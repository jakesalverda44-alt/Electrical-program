import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  notes: z.string().trim().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD').optional().nullable(),
  linked_type: z.enum(['bid', 'gen', 'customer']).optional().nullable(),
  linked_id: z.string().uuid().optional().nullable(),
  linked_name: z.string().trim().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

// List tasks. Reps see tasks assigned to or created by them; managers see all.
// ?status=open|done and ?mine=1 supported.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope || req.query.mine === '1') {
    params.push(req.user!.id);
    where.push(`(assigned_to = $${params.length} OR created_by = $${params.length})`);
  }
  if (req.query.status) { params.push(req.query.status); where.push(`status = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT t.*, u.name AS assigned_to_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
     ${clause}
     ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.created_at DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', requireAuth, validateBody(taskSchema), asyncHandler(async (req: AuthRequest, res) => {
  const b = req.body as z.infer<typeof taskSchema>;
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, due_date, linked_type, linked_id, linked_name, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.title, b.notes ?? null, b.due_date ?? null, b.linked_type ?? null, b.linked_id ?? null,
     b.linked_name ?? null, b.assigned_to ?? req.user!.id, req.user!.id]
  );
  res.json(rows[0]);
}));

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['open', 'done']).optional(),
});

router.patch('/:id', requireAuth, validateBody(updateSchema), asyncHandler(async (req: AuthRequest, res) => {
  // Reps can only modify their own tasks.
  const { rows: cur } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!cur.length) return res.status(404).json({ error: 'Not found' });
  if (ownScopeId(req.user!) && cur[0].assigned_to !== req.user!.id && cur[0].created_by !== req.user!.id) {
    return res.status(403).json({ error: 'You do not have access to this task' });
  }
  const b = req.body as z.infer<typeof updateSchema>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of ['title', 'notes', 'due_date', 'status'] as const) {
    if (b[k] !== undefined) { fields.push(`${k} = $${i++}`); vals.push(b[k]); }
  }
  if (b.status === 'done') fields.push('completed_at = now()');
  if (b.status === 'open') fields.push('completed_at = NULL');
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  const { rows } = await pool.query(`UPDATE tasks SET ${fields.join(',')} WHERE id = $${i} RETURNING *`, vals);
  res.json(rows[0]);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { rows: cur } = await pool.query('SELECT assigned_to, created_by FROM tasks WHERE id = $1', [req.params.id]);
  if (!cur.length) return res.status(404).json({ error: 'Not found' });
  if (ownScopeId(req.user!) && cur[0].assigned_to !== req.user!.id && cur[0].created_by !== req.user!.id) {
    return res.status(403).json({ error: 'You do not have access to this task' });
  }
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
