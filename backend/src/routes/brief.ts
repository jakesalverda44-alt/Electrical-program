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
  if (!msg) return res.status(502).json({ error: 'Could not load the email from Outlook.' });

  const result = await generateReplyText({ subject: msg.subject, fromName: msg.fromName, from: msg.from, body: msg.body });
  const replyHtml = result.ok ? replyTextToHtml(result.text) : '';

  const ok = await createReplyDraft(req.params.id, replyHtml);
  if (!ok) return res.status(502).json({ error: 'Could not create the draft in Outlook.' });

  // A blank draft is never silent: tell the user why so a missing key or a failed
  // call can't masquerade as intended behavior (which is what made this hard to spot).
  const aiError = result.ok
    ? undefined
    : result.reason === 'unconfigured'
      ? 'No Anthropic API key is configured on the server, so a blank draft was created. Add one in Settings → AI.'
      : 'The AI could not write this reply, so a blank draft was created. Try again in a moment.';
  res.json({ ok: true, ai: result.ok, aiError });
}));

export default router;
