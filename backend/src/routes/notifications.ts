import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Current user's notifications (most recent 50) + unread count.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const [list, count] = await Promise.all([
    pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user!.id]),
    pool.query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = false', [req.user!.id]),
  ]);
  res.json({ notifications: list.rows, unread: count.rows[0].n });
}));

router.post('/:id/read', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING id',
    [req.params.id, req.user!.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

router.post('/read-all', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  await pool.query('UPDATE notifications SET read = true WHERE user_id = $1 AND read = false', [req.user!.id]);
  res.json({ ok: true });
}));

export default router;
