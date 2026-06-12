import { getSetting } from '../db/getSetting';
import { escapeHtml } from '../utils/escapeHtml';

// The user-configured email signature (Settings → Email → "Email Signature"), appended to
// the bottom of every message graphSendMail sends. Stored in app_settings as `email_signature`.
// Accepts plain text (newlines become line breaks) or raw HTML if the value contains tags.

/** Returns the signature as an HTML block ready to append, or '' when none is configured. */
export async function emailSignatureHtml(): Promise<string> {
  const raw = ((await getSetting('email_signature')) || '').trim();
  if (!raw) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(raw);
  const body = looksHtml ? raw : escapeHtml(raw).replace(/\n/g, '<br>');
  return `<br><br><div style="margin-top:16px;padding-top:12px;border-top:1px solid #e0e0e0;color:#444;font-size:13px;line-height:1.5">${body}</div>`;
}
