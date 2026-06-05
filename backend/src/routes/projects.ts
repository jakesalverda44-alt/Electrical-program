import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Project (the awarded-work entity; id == source bid/gen id) ──
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  res.json(rows[0]);
});

// ── Change Orders ──────────────────────────────────────────────
router.get('/:type/:id/change-orders', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM project_change_orders WHERE project_id=$1 AND project_type=$2 ORDER BY number',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/change-orders', requireAuth, async (req: AuthRequest, res) => {
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

router.patch('/:type/:id/change-orders/:coId', requireAuth, async (req, res) => {
  const { description, amount, status } = req.body;
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
  res.json(rows[0]);
});

router.delete('/:type/:id/change-orders/:coId', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM project_change_orders WHERE id=$1', [req.params.coId]);
  res.json({ ok: true });
});

// ── Field Notes ───────────────────────────────────────────────
router.get('/:type/:id/field-notes', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM project_field_notes WHERE project_id=$1 AND project_type=$2 ORDER BY note_date DESC, created_at DESC',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/field-notes', requireAuth, async (req: AuthRequest, res) => {
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

router.delete('/:type/:id/field-notes/:noteId', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM project_field_notes WHERE id=$1', [req.params.noteId]);
  res.json({ ok: true });
});

// ── Project RFIs ──────────────────────────────────────────────
router.get('/:type/:id/rfis', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM project_rfis WHERE project_id=$1 AND project_type=$2 ORDER BY created_at DESC',
    [req.params.id, req.params.type]
  );
  res.json(rows);
});

router.post('/:type/:id/rfis', requireAuth, async (req, res) => {
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

router.patch('/:type/:id/rfis/:rfiId', requireAuth, async (req, res) => {
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
router.get('/:type/:id/section/:section', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT data FROM project_sections WHERE project_id=$1 AND project_type=$2 AND section=$3',
    [req.params.id, req.params.type, req.params.section]
  );
  res.json(rows[0]?.data ?? {});
});

router.put('/:type/:id/section/:section', requireAuth, async (req, res) => {
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
