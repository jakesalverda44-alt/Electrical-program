// Takeoff accuracy, Task 8 — Settings → Account Rules. Anyone signed in can
// read the rules (the Takeoff step shows which one applied); only an admin can
// change them. The Default rule can be edited but not deleted or renamed away
// from being the default.
import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { writeAudit } from '../utils/audit';
import { listAccountRules, getAccountRule, validateRuleInput, saveAccountRule } from '../bidstd/accountRulesDb';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ rules: await listAccountRules() });
}));

router.post('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const v = validateRuleInput(req.body ?? {}, { isDefault: false });
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const rule = await saveAccountRule(null, v.rule);
    await writeAudit(req, { action: 'create', entityType: 'account_rule', entityId: rule.id, summary: `Created account rule ${rule.name}`, after: rule });
    res.json(rule);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(409).json({ error: 'A rule with that name already exists.' });
    throw err;
  }
}));

router.put('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const existing = await getAccountRule(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const v = validateRuleInput(req.body ?? {}, { isDefault: existing.isDefault });
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const rule = await saveAccountRule(existing.id, v.rule);
    await writeAudit(req, { action: 'update', entityType: 'account_rule', entityId: rule.id, summary: `Updated account rule ${rule.name}`, before: existing, after: rule });
    res.json(rule);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(409).json({ error: 'A rule with that name already exists.' });
    throw err;
  }
}));

router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const existing = await getAccountRule(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.isDefault) return res.status(400).json({ error: 'The Default rule cannot be deleted — edit it instead.' });
  await pool.query('DELETE FROM account_rules WHERE id = $1', [existing.id]);
  await writeAudit(req, { action: 'delete', entityType: 'account_rule', entityId: existing.id, summary: `Deleted account rule ${existing.name}`, before: existing });
  res.json({ ok: true });
}));

export default router;
