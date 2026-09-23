import { Router } from 'express';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../utils/audit';
import { graphSendMail, isGraphMailConfigured } from '../email/graphMailer';

const router = Router();

const MASKED_KEYS = ['ai_anthropic_key'];

const ALLOWED_KEYS = [
  'frontend_url',
  'email_signature',
  'company_name', 'company_address', 'company_city', 'company_state', 'company_zip',
  'company_phone', 'company_email', 'company_website',
  'company_license_ec', 'company_license_cfc', 'company_license_li',
  'gen_default_labor', 'gen_default_permit', 'gen_default_startup', 'gen_default_tax_rate',
  'gen_default_pad', 'gen_default_smm', 'gen_default_surge_pro', 'gen_default_battery',
  'gen_default_extra_wire', 'gen_default_lull', 'gen_default_crane',
  'gen_default_deposit_pct', 'gen_default_valid_days',
  'ev_default_tax', 'ev_default_valid_days', 'ev_default_deposit_pct',
  'gen_pricing_table',
  'proposal_default_message', 'gas_contacts_text',
  'ai_anthropic_key', 'ai_model', 'ai_takeoff_agent2_model', 'ai_takeoff_agent3_model',
  'ai_max_tokens', 'ai_max_tokens_agent1', 'ai_max_tokens_agent2', 'ai_max_tokens_agent3',
  'ai_temperature',
  'ai_prompt_agent1', 'ai_prompt_agent2', 'ai_prompt_agent3',
  'ai_takeoff_agent4_model', 'ai_max_tokens_agent4', 'ai_prompt_agent4',
  // Takeoff accuracy Task 1 — the dedicated counting stage (Agent 1C).
  'ai_takeoff_counter_model', 'ai_max_tokens_counter',
  // Takeoff accuracy Task 1 (pre-existing gap found while adding the two keys
  // above) — Settings > AI > Document Prep has always PUT these five keys and
  // loadAIConfig has always read them, but none were in this list, so every
  // save was silently discarded (the loop below only writes listed keys).
  'ai_prep_classifier_model',
  'ai_prep_dpi_schedule', 'ai_prep_dpi_plan', 'ai_prep_tiles_schedule', 'ai_prep_tiles_plan',
  'ai_reply_draft_model', 'ai_build_from_notes_model',
  'unit_cost_library',
  'ai_enabled', 'ai_analysis_enabled', 'ai_daily_limit_per_user', 'ai_role_permissions',
  'commission_default_rate',
  'sales_goal_monthly',
  'bid_notify_enabled', 'bid_notify_emails',
  'award_recipients',
  'currency_code',
  'notifications_json',
  'security_session_timeout',
  // FIX-4 (post-review) — Task 4.2's quiet-proposal follow-up setting
  // (Settings > Notifications) posts this key, but it was missing from
  // ALLOWED_KEYS, so PUT /api/settings silently discarded the save (the
  // loop below only writes a key present in this list) — the UI showed
  // success with nothing actually persisted. services/proposalQuietSweep.ts
  // already reads it (numericSetting, with a default) — this just lets a
  // save actually reach it.
  //
  // Post-merge rework (2026-09-03) — elec_followup_viewed_days was removed:
  // the bid quiet-sweep collapsed to one tier once the "viewed" tracking it
  // depended on (the public proposal page) went away. Any previously-saved
  // value for that key is now orphaned in app_settings — harmless, just
  // never read or writable again.
  'elec_followup_quiet_days',
  // FIX-11 (post-review) — the internal pre-bid-package recipient
  // ("Chris") was hardcoded in the frontend (PcWorkspace.tsx). Moved to an
  // app_setting so it's configurable without a code change; the server
  // (POST /bids/:id/email-prebid-chris) reads it and defaults to the
  // previously-hardcoded address when unset.
  'prebid_chris_email',
  // Estimating labor engine (Part 2, Task 11 — Settings > Labor Library >
  // Defaults) — the same est_default_* keys migration 101 seeds
  // insert-if-absent; editable here through the generic settings PUT rather
  // than a dedicated route, same as every other global default on this page.
  'est_default_labor_rate', 'est_default_material_tax_pct', 'est_default_small_tools_pct',
  'est_default_supervision_pct', 'est_default_consumables_pct',
  // Fix round 1 / B8 — migration 108 seeded these two (Decision 7's
  // drops/slack defaults for a linear run's rollup) but never added them
  // here, so PUT /api/settings silently discarded any attempt to edit
  // them — the same FIX-4 gap this file's own comment above describes
  // for a different key. GET already returned them (unfiltered), so
  // Settings > Labor Library > Defaults could read but never save them.
  'est_default_drop_ft', 'est_default_slack_pct',
];

// Credentials that must never leave the server via GET /api/settings, even to an
// admin — vapid_private_key lets anyone who reads it forge push notifications to
// staff phones (audit: Security #2, High). jwt_secret was already excluded.
// vapid_public_key is intentionally NOT here: it is meant to be public (browsers
// need it to create a push subscription).
const INTERNAL_KEYS = ['jwt_secret', 'vapid_private_key'];

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

  // Mail is sent through Microsoft Graph from the shared mailbox.
  if (!isGraphMailConfigured()) {
    return res.status(400).json({ error: 'Email is not configured. Set the Microsoft Graph credentials (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET) in the environment.' });
  }

  try {
    await graphSendMail({
      to,
      subject: 'Test Email — Accurate Power & Technology',
      html: '<p>Your email settings are configured correctly. Mail delivery is ready. ✅</p>',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[email] Test send failed:', err);
    res.status(502).json({ error: 'Email delivery failed' });
  }
});

export { getSetting };

export default router;
