import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';

// AI pre-written reply drafts for the Command Center "Respond to" queue. Claude reads
// the customer's email and writes a ready-to-send reply in Jake's voice; the result is
// dropped into Outlook's Drafts via Graph createReply so it's waiting to be reviewed,
// tweaked, and sent. Returns null when AI isn't configured or the call fails — the
// caller falls back to creating a blank draft.

const DEFAULT_DRAFT_MODEL = 'claude-opus-4-8';

const SYSTEM = `You write email replies for Jake Salverda of Accurate Power & Technology, a licensed generator and electrical contractor in Eustis, Florida (Kohler & Generac home standby generators, commercial electrical work).

Write the reply Jake would send: warm, professional, plain-spoken, and brief — usually 2-5 short sentences. Answer the sender's actual questions when you can; when a question needs information you don't have (exact pricing, scheduling specifics, technical details of their property), acknowledge it and say Jake will confirm the specifics, rather than inventing an answer. If a call would move things along faster, offer Jake's cell: 352-801-8997.

Rules:
- Output ONLY the reply body text. No subject line, no quoted thread, no commentary about what you wrote.
- Start with a greeting using the sender's first name when known (e.g. "Hi Sarah,").
- End with a simple sign-off: "Best,\\nJake" (Outlook adds the full signature).
- Never fabricate prices, dates, model numbers, or commitments that aren't in the email.
- Match the sender's level of formality.`;

export interface EmailForReply {
  subject: string;
  fromName: string | null;
  from: string | null;
  body: string;
}

/**
 * Generate the reply text for an email. Returns null when no API key is configured
 * or the model call fails — never throws.
 */
export async function generateReplyText(email: EmailForReply): Promise<string | null> {
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    logger.info('[ai-draft] no Anthropic API key configured — falling back to blank draft');
    return null;
  }

  // Cap pathological bodies (huge quoted threads) so the prompt stays lean.
  const body = (email.body || '').slice(0, 12_000);
  const prompt = `Reply to this email:

From: ${email.fromName || 'Unknown'} <${email.from || 'unknown'}>
Subject: ${email.subject || '(no subject)'}

${body}`;

  const model = ((await getSetting('ai_reply_draft_model')) || DEFAULT_DRAFT_MODEL).trim();

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
    return text || null;
  } catch (err) {
    logger.error({ err }, '[ai-draft] reply generation failed');
    return null;
  }
}

/** Plain text → simple HTML for the Graph createReply comment body. */
export function replyTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}
