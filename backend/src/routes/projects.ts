import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { writeAudit } from '../utils/audit';

const router = Router();

/**
 * Ownership guard for a project's sub-resources. Restricted reps (salespeople)
 * may only touch projects sourced from their own bid/proposal; everyone else
 * sees all. Returns true if allowed, otherwise sends 403/404 and returns false.
 */
async function ensureProjectAccess(req: AuthRequest, res: import('express').Response): Promise<boolean> {
  const scope = ownScopeId(req.user!);
  if (!scope) return true; // managers/admins/etc. are unrestricted
  const table = req.params.type === 'gen' ? 'generator_proposals' : 'bids';
  const { rows } = await pool.query(`SELECT salesperson_id FROM ${table} WHERE id=$1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Project not found' }); return false; }
  if (rows[0].salesperson_id !== scope) { res.status(403).json({ error: 'You do not have access to this project' }); return false; }
  return true;
}

// ── Project (the awarded-work entity; id == source bid/gen id) ──
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  const proj = rows[0];
  const scope = ownScopeId(req.user!);
  if (scope) {
    const table = proj.source_type === 'gen' ? 'generator_proposals' : 'bids';
    const { rows: src } = await pool.query(`SELECT salesperson_id FROM ${table} WHERE id=$1`, [proj.id]);
    if (src[0]?.salesperson_id !== scope) return res.status(403).json({ error: 'You do not have access to this project' });
  }
  res.json(proj);
});

// ── Change Orders ──────────────────────────────────────────────
router.get('/:type/:id/change-orders', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { rows } = await pool.query(
    'SELECT * FROM project_change_orders WHERE project_id=$1 AND project_type=$2 ORDER BY number',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/change-orders', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { description, amount, status, submitted_date } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'description required' });
  const { rows: cnt } = await pool.query(
    'SELECT COALESCE(MAX(number),0)+1 AS next FROM project_change_orders WHERE project_id=$1 AND project_type=$2',
    [req.params.id, req.params.type]
  );
  const { rows } = await pool.query(
    `INSERT INTO project_change_orders (project_id, project_type, number, description, amount, status, submitted_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.params.type, cnt[0].next, description.trim(),
     Number(amount)||0, status||'pending', submitted_date||null]
  );
  res.json(rows[0]);
});

router.patch('/:type/:id/change-orders/:coId', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { description, amount, status } = req.body;
  const { rows: before } = await pool.query('SELECT status, amount, number FROM project_change_orders WHERE id=$1 AND project_id=$2', [req.params.coId, req.params.id]);
  if (!before.length) return res.status(404).json({ error: 'not found' });

  const fields: string[] = [], vals: unknown[] = [];
  let i = 1;
  if (description !== undefined) { fields.push(`description=$${i++}`); vals.push(description.trim()); }
  if (amount      !== undefined) { fields.push(`amount=$${i++}`);      vals.push(Number(amount)); }
  if (status      !== undefined) { fields.push(`status=$${i++}`);      vals.push(status); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(req.params.coId);
  const { rows } = await pool.query(
    `UPDATE project_change_orders SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });

  // Approving a change order rolls its amount into the project's contract value;
  // reversing an approval backs it out (and a re-priced approved CO adjusts the delta).
  const wasApproved = before[0].status === 'approved';
  const isApproved  = rows[0].status === 'approved';
  let delta = 0;
  if (!wasApproved && isApproved)      delta =  Number(rows[0].amount);
  else if (wasApproved && !isApproved) delta = -Number(before[0].amount);
  else if (wasApproved && isApproved)  delta =  Number(rows[0].amount) - Number(before[0].amount);
  if (delta !== 0) {
    await pool.query('UPDATE projects SET contract_value = COALESCE(contract_value,0) + $1, updated_at=now() WHERE id=$2', [delta, req.params.id]);
  }
  if (before[0].status !== rows[0].status) {
    const action = rows[0].status === 'approved' ? 'co_approved' : rows[0].status === 'rejected' ? 'co_rejected' : 'co_update';
    await writeAudit(req, {
      action, entityType: 'change_order', entityId: req.params.coId,
      summary: `Change order #${rows[0].number} ${rows[0].status} on project ${req.params.id} ($${Number(rows[0].amount).toLocaleString()})`,
      before: { status: before[0].status, amount: before[0].amount }, after: { status: rows[0].status, amount: rows[0].amount },
    });
  }
  res.json(rows[0]);
});

router.delete('/:type/:id/change-orders/:coId', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  // Backing out an approved CO keeps the project contract value correct.
  const { rows } = await pool.query('DELETE FROM project_change_orders WHERE id=$1 AND project_id=$2 RETURNING status, amount, number', [req.params.coId, req.params.id]);
  if (rows.length && rows[0].status === 'approved') {
    await pool.query('UPDATE projects SET contract_value = COALESCE(contract_value,0) - $1, updated_at=now() WHERE id=$2', [Number(rows[0].amount), req.params.id]);
  }
  res.json({ ok: true });
});

// ── Field Notes ───────────────────────────────────────────────
router.get('/:type/:id/field-notes', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { rows } = await pool.query(
    'SELECT * FROM project_field_notes WHERE project_id=$1 AND project_type=$2 ORDER BY note_date DESC, created_at DESC',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/field-notes', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { note, note_date, weather, crew_size } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'note required' });
  const author = req.user!.name;
  const { rows } = await pool.query(
    `INSERT INTO project_field_notes (project_id, project_type, note_date, author, note, weather, crew_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.params.type, note_date||null, author, note.trim(),
     weather||'', Number(crew_size)||0]
  );
  res.json(rows[0]);
});

router.delete('/:type/:id/field-notes/:noteId', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  await pool.query('DELETE FROM project_field_notes WHERE id=$1 AND project_id=$2', [req.params.noteId, req.params.id]);
  res.json({ ok: true });
});

// ── Project RFIs ──────────────────────────────────────────────
router.get('/:type/:id/rfis', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { rows } = await pool.query(
    'SELECT * FROM project_rfis WHERE project_id=$1 AND project_type=$2 ORDER BY created_at DESC',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/rfis', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { question, submitted_to, submitted_date, due_date } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });
  const { rows: cnt } = await pool.query(
    'SELECT COALESCE(MAX(CAST(REPLACE(rfi_number,\'RFI-\',\'\') AS INT)),0)+1 AS next FROM project_rfis WHERE project_id=$1 AND project_type=$2',
    [req.params.id, req.params.type]
  );
  const rfiNum = `RFI-${String(cnt[0].next).padStart(3,'0')}`;
  const { rows } = await pool.query(
    `INSERT INTO project_rfis (project_id, project_type, rfi_number, question, submitted_to, submitted_date, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.params.type, rfiNum, question.trim(),
     submitted_to||'', submitted_date||null, due_date||null]
  );
  res.json(rows[0]);
});

router.patch('/:type/:id/rfis/:rfiId', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { status, answer, answered_date } = req.body;
  const fields: string[] = [], vals: unknown[] = [];
  let i = 1;
  if (status        !== undefined) { fields.push(`status=$${i++}`);        vals.push(status); }
  if (answer        !== undefined) { fields.push(`answer=$${i++}`);        vals.push(answer); }
  if (answered_date !== undefined) { fields.push(`answered_date=$${i++}`); vals.push(answered_date||null); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(req.params.rfiId);
  const { rows } = await pool.query(
    `UPDATE project_rfis SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// ── Flexible section data (schedule, materials, closeout, etc.) ─
router.get('/:type/:id/section/:section', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { rows } = await pool.query(
    'SELECT data FROM project_sections WHERE project_id=$1 AND project_type=$2 AND section=$3',
    [req.params.id, req.params.type, req.params.section]
  );
  res.json(rows[0]?.data ?? {});
});

router.put('/:type/:id/section/:section', requireAuth, async (req: AuthRequest, res) => {
  if (!(await ensureProjectAccess(req, res))) return;
  const { data } = req.body;
  await pool.query(
    `INSERT INTO project_sections (project_id, project_type, section, data, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (project_id, section) DO UPDATE SET data=$4, updated_at=now()`,
    [req.params.id, req.params.type, req.params.section, JSON.stringify(data)]
  );
  res.json({ ok: true });
});

export default router;
