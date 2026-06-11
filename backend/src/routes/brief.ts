import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { buildBrief, invalidateGraphSnapshot } from '../services/brief';
import { markMessageRead, createReplyDraft, fetchMessage } from '../integrations/outlookMail';
import { generateReplyText, replyTextToHtml } from '../email/aiReplyDraft';

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

// Create a reply draft in Outlook's Drafts folder so it's waiting when the user opens
// the email. The id is the Graph message id. When AI is configured, Claude reads the
// email and pre-writes the reply; otherwise (or on AI failure) a blank draft is created.
router.post('/email/:id/draft-reply', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const msg = await fetchMessage(req.params.id);
  const replyText = msg
    ? await generateReplyText({ subject: msg.subject, fromName: msg.fromName, from: msg.from, body: msg.body })
    : null;

  const ok = await createReplyDraft(req.params.id, replyText ? replyTextToHtml(replyText) : '');
  if (!ok) return res.status(502).json({ error: 'Could not create the draft in Outlook.' });
  res.json({ ok: true, ai: !!replyText });
}));

export default router;
