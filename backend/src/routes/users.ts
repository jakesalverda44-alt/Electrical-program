import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const SAFE_COLS = 'id, name, email, phone, job_title, role, status, last_login, created_at';

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLS} FROM users ORDER BY name`
  );
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, email, phone = '', job_title = '', role = 'salesperson', password } = req.body;
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, job_title, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SAFE_COLS}`,
      [name.trim(), email.toLowerCase().trim(), phone.trim(), job_title.trim(), role, hash]
    );
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { name, email, phone, job_title, role, status } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name      !== undefined) { fields.push(`name=$${i++}`);      vals.push(name.trim()); }
  if (email     !== undefined) { fields.push(`email=$${i++}`);     vals.push(email.toLowerCase().trim()); }
  if (phone     !== undefined) { fields.push(`phone=$${i++}`);     vals.push(phone.trim()); }
  if (job_title !== undefined) { fields.push(`job_title=$${i++}`); vals.push(job_title.trim()); }
  if (role      !== undefined) { fields.push(`role=$${i++}`);      vals.push(role); }
  if (status    !== undefined) { fields.push(`status=$${i++}`);    vals.push(status); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING ${SAFE_COLS}`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/password', requireAuth, async (req: AuthRequest, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id`,
    [hash, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Soft delete — sets status to inactive
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE users SET status='inactive' WHERE id=$1 RETURNING id`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Set per-user AI permission override
router.put('/:id/ai-override', requireAuth, async (req: AuthRequest, res) => {
  const override = req.body; // e.g. { run_analysis: false } or { suspended: true } or null to clear
  const { rows } = await pool.query(
    `UPDATE users SET ai_override=$1 WHERE id=$2 RETURNING id, ai_override`,
    [override === null ? null : JSON.stringify(override), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, ai_override: rows[0].ai_override });
});

export default router;
