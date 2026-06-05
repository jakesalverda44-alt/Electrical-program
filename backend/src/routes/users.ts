import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, isPrivileged, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../utils/audit';

const router = Router();

const SAFE_COLS = 'id, name, email, phone, job_title, role, status, last_login, created_at';

// Read stays open to any authenticated user — the app loads the directory at
// startup to resolve rep names and populate assignment dropdowns. Only safe,
// non-secret columns are returned.
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLS} FROM users ORDER BY name`
  );
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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
    await writeAudit(req, {
      action: 'create', entityType: 'user', entityId: rows[0].id,
      summary: `Created user ${rows[0].email} (${role})`, after: { name: rows[0].name, email: rows[0].email, role },
    });
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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
    // Capture the prior role/status so privilege changes are visible in the audit trail.
    const { rows: prior } = await pool.query('SELECT role, status FROM users WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING ${SAFE_COLS}`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const roleChanged = role !== undefined && prior[0] && prior[0].role !== role;
    await writeAudit(req, {
      action: roleChanged ? 'role_change' : 'update', entityType: 'user', entityId: req.params.id,
      summary: roleChanged
        ? `Changed ${rows[0].email} role: ${prior[0].role} → ${role}`
        : `Updated user ${rows[0].email}`,
      before: prior[0], after: { role: rows[0].role, status: rows[0].status },
    });
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Admins may reset anyone's password; a regular user may change only their own.
router.put('/:id/password', requireAuth, async (req: AuthRequest, res) => {
  if (!isPrivileged(req.user) && req.user!.id !== req.params.id) {
    return res.status(403).json({ error: 'You can only change your own password.' });
  }
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
  await writeAudit(req, {
    action: 'password_reset', entityType: 'user', entityId: req.params.id,
    summary: req.user!.id === req.params.id ? 'Changed own password' : `Reset password for user ${req.params.id}`,
  });
  res.json({ ok: true });
});

// Soft delete — sets status to inactive
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE users SET status='inactive' WHERE id=$1 RETURNING id, email`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await writeAudit(req, { action: 'delete', entityType: 'user', entityId: req.params.id, summary: `Deactivated user ${rows[0].email}` });
  res.json({ ok: true });
});

// Set per-user AI permission override
router.put('/:id/ai-override', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const override = req.body; // e.g. { run_analysis: false } or { suspended: true } or null to clear
  const { rows } = await pool.query(
    `UPDATE users SET ai_override=$1 WHERE id=$2 RETURNING id, ai_override`,
    [override === null ? null : JSON.stringify(override), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await writeAudit(req, {
    action: 'ai_override', entityType: 'user', entityId: req.params.id,
    summary: `Updated AI access override`, after: rows[0].ai_override,
  });
  res.json({ ok: true, ai_override: rows[0].ai_override });
});

export default router;
