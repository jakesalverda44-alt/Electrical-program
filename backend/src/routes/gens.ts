import { Router } from 'express';
import { Resend } from 'resend';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { proposalEmailHtml, proposalEmailText } from '../email/proposalEmail';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const router = Router();

router.get('/benchmark', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT kw, amount FROM generator_proposals WHERE stage = 'awarded' AND kw > 0 AND amount > 0`
  );
  const BRACKETS = [
    { label: 'Under 20kW',   min: 0,   max: 20   },
    { label: '20–50kW',      min: 20,  max: 50   },
    { label: '50–100kW',     min: 50,  max: 100  },
    { label: '100–200kW',    min: 100, max: 200  },
    { label: '200–500kW',    min: 200, max: 500  },
    { label: '500kW+',       min: 500, max: Infinity },
  ];
  const result = BRACKETS.map(b => {
    const group = rows.filter(r => Number(r.kw) >= b.min && Number(r.kw) < b.max);
    if (!group.length) return { ...b, count: 0, avgAmount: null, avgPerKw: null };
    const avgAmount = group.reduce((s, r) => s + Number(r.amount), 0) / group.length;
    const avgPerKw  = group.reduce((s, r) => s + Number(r.amount) / Number(r.kw), 0) / group.length;
    return { ...b, count: group.length, avgAmount: Math.round(avgAmount), avgPerKw: Math.round(avgPerKw) };
  });
  res.json(result);
});

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM generator_proposals ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { customer, loc, mfr, model, kw, amount, tax, addons } = req.body;
  if (!customer?.trim()) return res.status(400).json({ error: 'Customer required' });
  const user = req.user!;
  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (customer, loc, mfr, model, kw, amount, tax, addons, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [customer.trim(), (loc || '').trim() || '—', mfr, model, Number(kw) || 0,
     Number(amount) || 0, Number(tax) || 0, Number(addons) || 0, user.id, user.name]
  );
  res.json(rows[0]);
});

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  const valid = ['building', 'sent', 'awarded', 'declined'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cur } = await client.query(
      'SELECT * FROM generator_proposals WHERE id=$1', [req.params.id]
    );
    if (!cur.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const gen = cur[0];

    const { rows } = await client.query(
      'UPDATE generator_proposals SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
      [stage, req.params.id]
    );

    let wonJob = null;
    if (stage === 'awarded' && gen.stage !== 'awarded') {
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
         VALUES ($1,$2,$3,'Generator',$4,$5)
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [gen.salesperson_name, gen.customer, gen.id, gen.amount, gen.salesperson_id || null]
      );
      wonJob = wj[0] || null;
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ('awarded','gen',$1)`,
        [`${gen.customer} awarded — ${gen.salesperson_name}`]
      );
    } else if (stage !== gen.stage) {
      const labels: Record<string, string> = {
        building: 'Building', sent: 'Proposal Sent', declined: 'Declined',
      };
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ($1,'gen',$2)`,
        [stage === 'declined' ? 'lost' : stage === 'sent' ? 'sent' : 'new',
         `${gen.customer} moved to ${labels[stage] || stage}`]
      );
    }

    await client.query('COMMIT');
    res.json({ gen: rows[0], wonJob });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.patch('/:id/phase', requireAuth, async (req: AuthRequest, res) => {
  const { phase } = req.body;
  const valid = ['scheduled','ordered','delivered','install','startup','complete'];
  if (!valid.includes(phase)) return res.status(400).json({ error: 'Invalid phase' });
  const { rows } = await pool.query(
    'UPDATE generator_proposals SET gen_install_phase=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [phase, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { customer, loc, mfr, model, kw, amount, tax, addons } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (customer !== undefined) { fields.push(`customer=$${i++}`); vals.push(customer.trim()); }
  if (loc      !== undefined) { fields.push(`loc=$${i++}`);      vals.push(loc.trim() || '—'); }
  if (mfr      !== undefined) { fields.push(`mfr=$${i++}`);      vals.push(mfr); }
  if (model    !== undefined) { fields.push(`model=$${i++}`);    vals.push(model); }
  if (kw       !== undefined) { fields.push(`kw=$${i++}`);       vals.push(Number(kw)); }
  if (amount   !== undefined) { fields.push(`amount=$${i++}`);   vals.push(Number(amount)); }
  if (tax      !== undefined) { fields.push(`tax=$${i++}`);      vals.push(Number(tax)); }
  if (addons   !== undefined) { fields.push(`addons=$${i++}`);   vals.push(Number(addons)); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at=now()`);
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE generator_proposals SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
    vals
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const gen = rows[0];

  // If amount changed on an awarded gen, keep won_jobs in sync
  let wonJob = null;
  if (amount !== undefined && gen.stage === 'awarded') {
    const { rows: wj } = await pool.query(
      `UPDATE won_jobs SET value=$1 WHERE proposal_id=$2 RETURNING *`,
      [Number(amount), gen.id]
    );
    wonJob = wj[0] || null;
  }

  res.json({ gen, wonJob });
});

// ── Send proposal email ──────────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req: AuthRequest, res) => {
  const { to, subject, note, proposalNo, total, deposit } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET sent_at = now(), stage = CASE WHEN stage = 'building' THEN 'sent' ELSE stage END, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const gen = rows[0];

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/p/${gen.proposal_token}`;

  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping send, returning link:', link);
    return res.json({ gen, link, skipped: true });
  }

  try {
    await resend.emails.send({
      from: 'proposals@accuratepowerandtechnology.com',
      replyTo: 'jakes@accuratepowerandtechnology.com',
      to,
      subject: subject || `Your Generator Proposal — ${proposalNo}`,
      html: proposalEmailHtml({ customerName: gen.customer, proposalNo, total, deposit, link, senderNote: note }),
      text: proposalEmailText({ customerName: gen.customer, proposalNo, total, link }),
    });
  } catch (err) {
    console.error('[email] Resend error:', err);
    return res.status(502).json({ error: 'Email delivery failed' });
  }

  res.json({ gen, link });
});

// ── Public: view proposal by token (no auth) ────────────────────────────────
router.get('/p/:token', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET viewed_at = COALESCE(viewed_at, now())
     WHERE proposal_token = $1
     RETURNING *`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  res.json(rows[0]);
});

// ── Public: sign proposal by token (no auth) ────────────────────────────────
router.post('/p/:token/sign', async (req, res) => {
  const { signatureData } = req.body;
  if (!signatureData) return res.status(400).json({ error: 'Signature required' });

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET signed_at = COALESCE(signed_at, now()),
         signature_data = $1,
         stage = CASE WHEN stage != 'declined' THEN 'signed' ELSE stage END,
         updated_at = now()
     WHERE proposal_token = $2
     RETURNING id, customer, stage, signed_at`,
    [signatureData, req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ ok: true, gen: rows[0] });
});

export default router;
