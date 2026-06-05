import { Router } from 'express';
import { Resend } from 'resend';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../utils/audit';

const router = Router();

const MASKED_KEYS = ['email_resend_api_key', 'ai_anthropic_key'];

const ALLOWED_KEYS = [
  // Email
  'email_resend_api_key', 'email_from_address', 'email_from_name', 'email_reply_to', 'frontend_url',
  // Company
  'company_name', 'company_address', 'company_city', 'company_state', 'company_zip',
  'company_phone', 'company_email', 'company_website',
  'company_license_ec', 'company_license_cfc', 'company_license_li',
  // Proposal defaults
  'gen_default_labor', 'gen_default_permit', 'gen_default_startup', 'gen_default_tax_rate',
  'gen_default_pad', 'gen_default_smm', 'gen_default_surge_pro', 'gen_default_battery',
  'gen_default_extra_wire', 'gen_default_lull', 'gen_default_crane',
  // Generator pricing table (JSON blob)
  'gen_pricing_table',
  // AI
  'ai_anthropic_key', 'ai_model', 'ai_max_tokens', 'ai_temperature',
  // AI permissions
  'ai_enabled', 'ai_analysis_enabled', 'ai_daily_limit_per_user', 'ai_role_permissions',
  // Commissions
  'commission_default_rate',
  // Bid notifications
  'bid_notify_enabled', 'bid_notify_emails',
  // Notifications
  'notifications_json',
  // Security
  'security_session_timeout',
];

// Internal keys that must never be exposed through the API.
const INTERNAL_KEYS = ['jwt_secret'];

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM app_settings ORDER BY key');
  const masked = rows
    .filter(r => !INTERNAL_KEYS.includes(r.key))
    .map(r => ({
      key: r.key,
      value: MASKED_KEYS.includes(r.key) && r.value
        ? '••••••••' + r.value.slice(-4)
        : r.value,
    }));
  res.json(masked);
});

router.put('/', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const updates: Record<string, string> = req.body;
  const changedKeys: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of ALLOWED_KEYS) {
      if (!(key in updates)) continue;
      const val = updates[key];
      // Skip masked placeholders — user didn't change it
      if (MASKED_KEYS.includes(key) && val.startsWith('••••••••')) continue;
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, val.trim()]
      );
      changedKeys.push(key);
    }
    await client.query('COMMIT');
    if (changedKeys.length) {
      // Record which settings changed; never log secret values.
      await writeAudit(req, {
        action: 'update', entityType: 'settings', entityId: null,
        summary: `Updated settings: ${changedKeys.join(', ')}`, after: { keys: changedKeys },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  } finally {
    client.release();
  }
});

router.post('/test-email', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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

export { getSetting };

export default router;
