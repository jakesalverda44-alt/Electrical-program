import { Router } from 'express';
import { Resend } from 'resend';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// All settings routes require auth (manager/accounting only in a real system — simplified here)

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM app_settings ORDER BY key');
  // Never expose the raw API key — mask it
  const masked = rows.map(r => ({
    key: r.key,
    value: r.key === 'email_resend_api_key' && r.value
      ? '••••••••' + r.value.slice(-4)
      : r.value,
  }));
  res.json(masked);
});

router.put('/', requireAuth, async (req: AuthRequest, res) => {
  const updates: Record<string, string> = req.body;
  const allowedKeys = [
    'email_resend_api_key',
    'email_from_address',
    'email_from_name',
    'email_reply_to',
    'frontend_url',
  ];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of allowedKeys) {
      if (key in updates) {
        // If the value is the masked placeholder, skip (user didn't change it)
        const val = updates[key];
        if (key === 'email_resend_api_key' && val.startsWith('••••••••')) continue;
        await client.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, val.trim()]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  } finally {
    client.release();
  }
});

router.post('/test-email', requireAuth, async (req: AuthRequest, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient required' });

  const [apiKey, fromAddress, fromName, replyTo] = await Promise.all([
    getSetting('email_resend_api_key'),
    getSetting('email_from_address'),
    getSetting('email_from_name'),
    getSetting('email_reply_to'),
  ]);

  if (!apiKey) return res.status(400).json({ error: 'No API key configured' });

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      replyTo: replyTo || undefined,
      to,
      subject: 'Test Email — Accurate Power & Technology',
      html: '<p>Your email settings are configured correctly. Proposal delivery is ready. ✅</p>',
      text: 'Your email settings are configured correctly. Proposal delivery is ready.',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[email] Test send failed:', err);
    res.status(502).json({ error: 'Email delivery failed' });
  }
});

// Helper used by other routes to get a single setting value
export async function getSetting(key: string): Promise<string> {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? '';
}

export default router;
