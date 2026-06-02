import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

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

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const [bidsR, gensR, wonR, actR] = await Promise.all([
      pool.query('SELECT * FROM bids ORDER BY created_at DESC'),
      pool.query('SELECT * FROM generator_proposals ORDER BY created_at DESC'),
      pool.query('SELECT * FROM won_jobs ORDER BY date_won DESC'),
      pool.query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 10'),
    ]);
    res.json({
      bids: bidsR.rows.map((r: Record<string, unknown>) => ({ ...r, due_days: parseDueDays(String(r.due || '')) })),
      gens: gensR.rows,
      wonJobs: wonR.rows,
      activity: actR.rows,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
