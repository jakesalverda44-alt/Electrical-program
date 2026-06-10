import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { buildBrief } from '../services/brief';

const router = Router();

// Command Center "morning brief": KPIs, attention items, Kohler funnel, today's agenda.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await buildBrief(req.user!));
}));

export default router;
