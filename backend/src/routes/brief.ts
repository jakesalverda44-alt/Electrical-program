import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { buildBrief, invalidateGraphSnapshot } from '../services/brief';
import { markMessageRead } from '../integrations/outlookMail';

const router = Router();

// Command Center "morning brief": KPIs, attention items, Kohler funnel, today's agenda.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await buildBrief(req.user!));
}));

// Mark a "respond to" email read in Outlook so it leaves the queue for everyone
// (not just this device's per-day checklist). The id arrives as the Graph message id.
router.post('/email/:id/read', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const result = await markMessageRead(req.params.id);
  if (!result.ok) {
    return res.status(502).json({ error: result.reason || 'Could not mark the email read in Outlook.' });
  }
  invalidateGraphSnapshot();
  res.json({ ok: true });
}));

export default router;
