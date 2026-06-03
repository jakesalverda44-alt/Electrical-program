import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { withDueDays } from '../utils/dueDate';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  type: z.enum(['gc', 'customer', 'other']).default('customer'),
  company: z.string().trim().optional(),
  contact_name: z.string().trim().optional(),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zip: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  owner_id: z.string().uuid().optional().nullable(),
});

const COLUMNS = ['name', 'type', 'company', 'contact_name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'notes', 'owner_id'] as const;

/**
 * Find-or-create a customer by name+type. Used by bid/proposal creation so new
 * records link to a real customer instead of just storing a text string.
 */
export async function upsertCustomer(name: string, type: 'gc' | 'customer'): Promise<string | null> {
  const trimmed = (name || '').trim();
  if (!trimmed || trimmed === '—') return null;
  const { rows } = await pool.query(
    `INSERT INTO customers (name, type, company)
     VALUES ($1, $2, $3)
     ON CONFLICT (LOWER(name), type) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [trimmed, type, type === 'gc' ? trimmed : null]
  );
  return rows[0]?.id ?? null;
}

// List customers (shared directory). Supports ?type= and ?q= filters.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { type, q } = req.query as { type?: string; q?: string };
  const where: string[] = [];
  const params: unknown[] = [];
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  if (q)    { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR company ILIKE $${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM bids b WHERE b.customer_id = c.id)::int AS bid_count,
            (SELECT COUNT(*) FROM generator_proposals g WHERE g.customer_id = c.id)::int AS gen_count
     FROM customers c ${clause} ORDER BY c.name ASC`,
    params
  );
  res.json(rows);
}));

// Customer detail with linked records. Linked bids/proposals/won-jobs are scoped
// to the requesting rep (managers see all), consistent with the Phase 1 access model.
router.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { rows: cust } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!cust.length) return res.status(404).json({ error: 'Not found' });

  const scope = ownScopeId(req.user!);
  const ownFilter = (col = 'salesperson_id') => scope ? ` AND ${col} = $2` : '';
  const args = (id: string) => scope ? [id, scope] : [id];

  const [bidsR, gensR, wonR, commsR] = await Promise.all([
    pool.query(`SELECT * FROM bids WHERE customer_id = $1${ownFilter()} ORDER BY created_at DESC`, args(req.params.id)),
    pool.query(`SELECT * FROM generator_proposals WHERE customer_id = $1${ownFilter()} ORDER BY created_at DESC`, args(req.params.id)),
    pool.query(`SELECT * FROM won_jobs WHERE customer = $1${ownFilter()} ORDER BY date_won DESC`, args(cust[0].name)),
    pool.query('SELECT * FROM communications WHERE linked_name = $1 ORDER BY created_at DESC LIMIT 50', [cust[0].name]),
  ]);

  res.json({
    customer: cust[0],
    bids: bidsR.rows.map(withDueDays),
    gens: gensR.rows,
    wonJobs: wonR.rows,
    communications: commsR.rows,
  });
}));

router.post('/', requireAuth, validateBody(customerSchema), asyncHandler(async (req: AuthRequest, res) => {
  const b = req.body as z.infer<typeof customerSchema>;
  const vals = COLUMNS.map(c => (b as Record<string, unknown>)[c] ?? null);
  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(',');
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (${COLUMNS.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(409).json({ error: 'A customer with that name and type already exists' });
    throw err;
  }
}));

router.patch('/:id', requireAuth, validateBody(customerSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const b = req.body as Record<string, unknown>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const col of COLUMNS) {
    if (b[col] !== undefined) { fields.push(`${col} = $${i++}`); vals.push(b[col]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push('updated_at = now()');
  vals.push(req.params.id);
  const { rows } = await pool.query(`UPDATE customers SET ${fields.join(',')} WHERE id = $${i} RETURNING *`, vals);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

export default router;
