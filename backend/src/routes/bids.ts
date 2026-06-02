import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Parse "Mon D" or "Mon DD" due string → days from today
function parseDueDays(str: string): number {
  const MONTHS: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  };
  const m = /([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/.exec(str || '');
  if (!m) return 14;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mo === undefined) return 14;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(today.getFullYear(), mo, parseInt(m[2]));
  if (d < today) d = new Date(today.getFullYear() + 1, mo, parseInt(m[2]));
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function withDueDays(row: Record<string, unknown>) {
  return { ...row, due_days: parseDueDays(String(row.due || '')) };
}

// Accept ISO "YYYY-MM-DD" from date picker OR legacy "Mon D" text
function formatDue(raw: string | undefined): string {
  if (!raw?.trim()) return 'TBD';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
  if (iso) {
    const [, m, d] = raw.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m)-1]} ${parseInt(d)}`;
  }
  return raw.trim();
}

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM bids ORDER BY created_at DESC');
  res.json(rows.map(withDueDays));
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, amount, due } = req.body;
  if (!name?.trim() || !gc?.trim()) return res.status(400).json({ error: 'Name and GC required' });
  const user = req.user!;
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, amount, due, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name.trim(), gc.trim(), (loc||'').trim()||'—', amount ? Number(amount) : null, formatDue(due), user.id, user.name]
  );
  res.json(withDueDays(rows[0]));
});

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  const valid = ['due', 'submitted', 'awarded', 'lost'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current bid
    const { rows: cur } = await client.query('SELECT * FROM bids WHERE id=$1', [req.params.id]);
    if (!cur.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const bid = cur[0];

    // Update stage
    const { rows } = await client.query(
      'UPDATE bids SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
      [stage, req.params.id]
    );

    // If transitioning TO awarded (not already awarded), create won-job record
    let wonJob = null;
    if (stage === 'awarded' && bid.stage !== 'awarded') {
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
         VALUES ($1,$2,$3,'Electrical',$4,$5)
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [bid.salesperson_name, bid.name, bid.id, bid.amount, bid.salesperson_id || null]
      );
      wonJob = wj[0] || null;

      await client.query(
        `INSERT INTO activity (kind, div, text)
         VALUES ('awarded','elec',$1)`,
        [`${bid.name} awarded — ${bid.salesperson_name}`]
      );
    } else if (stage !== bid.stage) {
      const labels: Record<string, string> = { due:'Bids Due', submitted:'Submitted', lost:'Lost' };
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ($1,'elec',$2)`,
        [stage === 'lost' ? 'lost' : 'new', `${bid.name} moved to ${labels[stage] || stage}`]
      );
    }

    await client.query('COMMIT');
    res.json({ bid: withDueDays(rows[0]), wonJob });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

export default router;
