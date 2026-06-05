import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { writeAudit } from '../utils/audit';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const { rows } = scope
    ? await pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL AND salesperson_id = $1 ORDER BY date_won DESC', [scope])
    : await pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL ORDER BY date_won DESC');
  res.json(rows);
});

// Mark a commission paid / unpaid (owner/admin only).
router.patch('/:id/commission', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { status } = req.body as { status?: string };
  if (status !== 'earned' && status !== 'paid') {
    return res.status(400).json({ error: "status must be 'earned' or 'paid'" });
  }
  const { rows } = await pool.query(
    `UPDATE won_jobs
     SET commission_status = $1,
         commission_paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(commission_paid_at, now()) ELSE NULL END
     WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await writeAudit(req, {
    action: status === 'paid' ? 'commission_paid' : 'commission_unpaid',
    entityType: 'won_job', entityId: req.params.id,
    summary: `Marked commission ${status} for "${rows[0].customer}" ($${Number(rows[0].commission_amount || 0).toLocaleString()})`,
  });
  res.json(rows[0]);
});

// Called internally when a proposal is marked awarded
router.post('/record', requireAuth, async (req, res) => {
  const { salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (proposal_id) DO NOTHING
       RETURNING *`,
      [salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id || null]
    );
    res.json(rows[0] || { skipped: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
