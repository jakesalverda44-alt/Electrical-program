import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../utils/audit';
import { upsertCustomer } from './customers';
import { formatDue, withDueDays } from '../utils/dueDate';

const router = Router();

// Shared inbox of incoming bid invitations. Pending items plus anything
// processed in the last 7 days (so accept/decline stay visible briefly).
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM intake_items
     WHERE status = 'pending' OR updated_at > now() - interval '7 days'
     ORDER BY (status <> 'pending'), created_at DESC`
  );
  res.json(rows);
});

// Manually add an incoming bid to the inbox.
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, contact, amount, sheets, due, notes, source } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const num = (v: unknown) => (v !== undefined && v !== null && v !== '') ? Number(v) : null;
  const { rows } = await pool.query(
    `INSERT INTO intake_items (name, gc, loc, contact, amount, sheets, due, notes, source, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [name.trim(), gc?.trim() || null, loc?.trim() || null, contact?.trim() || null,
     num(amount), num(sheets), due || null, notes?.trim() || null, source || 'manual',
     req.user!.id, req.user!.name]
  );
  res.json(rows[0]);
});

// Accept → create a bid (owned by the accepter) and mark the item accepted.
// Optional body fields override the stored values (the reviewer may edit first).
router.post('/:id/accept', requireAuth, async (req: AuthRequest, res) => {
  const o = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query('SELECT * FROM intake_items WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const it = cur[0];
    if (it.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already processed' }); }

    const name = String(o.name ?? it.name ?? '').trim();
    const gc   = String(o.gc ?? it.gc ?? '').trim();
    if (!name || !gc) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Name and GC are required to accept' }); }
    const loc    = o.loc ?? it.loc;
    const amount = o.amount ?? it.amount;
    const notes  = o.notes ?? it.notes;
    const due    = o.due ?? it.due;
    const user = req.user!;
    const customerId = await upsertCustomer(gc, 'gc');

    const { rows: bidRows } = await client.query(
      `INSERT INTO bids (name, gc, loc, amount, due, notes, salesperson_id, salesperson_name, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, gc, (loc || '').trim() || '—', amount != null && amount !== '' ? Number(amount) : null,
       formatDue(due), notes?.trim?.() || notes || null, user.id, user.name, customerId]
    );
    const bid = bidRows[0];
    await client.query(
      `UPDATE intake_items SET status='accepted', accepted_bid_id=$1, accepted_at=now(), updated_at=now() WHERE id=$2`,
      [bid.id, req.params.id]
    );
    await client.query('COMMIT');
    await writeAudit(req, { action: 'accept', entityType: 'intake', entityId: req.params.id, summary: `Accepted incoming bid "${name}" (${gc}) into the pipeline` });
    res.json({ bid: withDueDays(bid) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Decline → keep a record with the reason.
router.post('/:id/decline', requireAuth, async (req: AuthRequest, res) => {
  const { reason } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE intake_items SET status='declined', decline_reason=$1, declined_at=now(), updated_at=now()
     WHERE id=$2 AND status='pending' RETURNING *`,
    [reason || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found or already processed' });
  await writeAudit(req, { action: 'decline', entityType: 'intake', entityId: req.params.id, summary: `Declined incoming bid "${rows[0].name}"${reason ? ` — ${reason}` : ''}` });
  res.json(rows[0]);
});

export default router;
