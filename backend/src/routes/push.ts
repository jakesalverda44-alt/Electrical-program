import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validateBody } from '../utils/validate';
import { ensureVapid, saveSubscription, deleteSubscription } from '../integrations/webPush';

const router = Router();

// GET /api/push/public-key — VAPID public key the browser needs to subscribe.
router.get('/public-key', requireAuth, asyncHandler(async (_req, res) => {
  const key = await ensureVapid();
  res.json({ key });
}));

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

// POST /api/push/subscribe — opt this device into push for the current user.
router.post('/subscribe', requireAuth, validateBody(subSchema), asyncHandler(async (req: AuthRequest, res) => {
  await saveSubscription(req.user!.id, req.body, req.headers['user-agent']);
  res.status(201).json({ ok: true });
}));

// POST /api/push/unsubscribe — drop this device's subscription.
router.post('/unsubscribe', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const endpoint = (req.body?.endpoint ?? '').toString();
  if (endpoint) await deleteSubscription(endpoint);
  res.json({ ok: true });
}));

export default router;
