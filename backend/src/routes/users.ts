import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, role FROM users ORDER BY name'
  );
  res.json(rows);
});

export default router;
