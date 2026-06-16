import { Resend } from 'resend';
import { getSetting } from '../db/getSetting';
import { escapeHtml } from '../utils/escapeHtml';
import { graphSendMail, isGraphMailConfigured } from './graphMailer';

// "New commercial bid → team" notification. Shared by the manual POST /bids path
// (auto-send, gated by the bid_notify_enabled toggle) and the Intake accept path
// (opt-in per accept, with a reviewer-edited recipient list). Mail goes out via
// Microsoft Graph from the shared mailbox, falling back to Resend if Graph is off.

export interface BidNotifyData {
  name: unknown;
  gc: unknown;
  loc: unknown;
  due?: unknown;
  amount?: unknown;
}

/** The configured team distribution list (Settings → Notifications). */
export async function getBidNotifyEmails(): Promise<string[]> {
  try {
    const raw = await getSetting('bid_notify_emails');
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.map(String).map(s => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildEmail(bid: BidNotifyData, addedByName: string, base: string) {
  const dueStr = bid.due ? String(bid.due) : 'TBD';
  const amt = bid.amount ? '$' + Number(bid.amount).toLocaleString() : '—';
  const subject = `New Bid — ${bid.name}`;
  const html = `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 16px">New Bid Added</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5;width:130px">Job</td><td style="padding:8px 12px">${escapeHtml(bid.name)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">General Contractor</td><td style="padding:8px 12px">${escapeHtml(bid.gc)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Location</td><td style="padding:8px 12px">${escapeHtml(bid.loc)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Due Date</td><td style="padding:8px 12px">${escapeHtml(dueStr)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Est. Value</td><td style="padding:8px 12px">${escapeHtml(amt)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Added By</td><td style="padding:8px 12px">${escapeHtml(addedByName)}</td></tr>
      </table>
      <p style="margin:20px 0 0"><a href="${base}" style="background:#4D8DF7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open Pipeline →</a></p>
    </div>`;
  const text = `New Bid: ${bid.name}\nGC: ${bid.gc}\nLocation: ${bid.loc}\nDue: ${dueStr}\nEst. Value: ${amt}\nAdded by: ${addedByName}\n\n${base}`;
  return { subject, html, text };
}

export interface SendBidNotificationOpts {
  /** Explicit recipient list (Intake accept passes the reviewer-edited list). */
  to?: string[];
  /** Send even when bid_notify_enabled is 'false' (used for the explicit opt-in). */
  force?: boolean;
}

/**
 * Send the "new bid" team notification. Returns the recipients actually emailed
 * (empty when nothing was sent: disabled, no recipients, or no mail transport).
 */
export async function sendBidNotification(
  bid: BidNotifyData,
  addedBy: { name: string },
  opts: SendBidNotificationOpts = {},
): Promise<{ sent: boolean; to: string[] }> {
  const [enabled, apiKey, fromAddress, fromName, frontendUrl] = await Promise.all([
    getSetting('bid_notify_enabled'),
    getSetting('email_resend_api_key'),
    getSetting('email_from_address'),
    getSetting('email_from_name'),
    getSetting('frontend_url'),
  ]);
  if (!opts.force && enabled === 'false') return { sent: false, to: [] };

  const emails = (opts.to ?? await getBidNotifyEmails()).map(s => s.trim()).filter(Boolean);
  if (!emails.length) return { sent: false, to: [] };

  const base = (frontendUrl || 'https://electrical-program.onrender.com').replace(/\/$/, '');
  const { subject, html, text } = buildEmail(bid, addedBy.name, base);

  // Prefer Microsoft Graph (app-only); fall back to Resend only if Graph isn't configured.
  if (isGraphMailConfigured()) {
    await graphSendMail({ to: emails, subject, html });
    return { sent: true, to: emails };
  }
  if (!apiKey) return { sent: false, to: [] };
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: fromName ? `${fromName} <${fromAddress}>` : (fromAddress as string),
    to: emails,
    subject,
    html,
    text,
  });
  return { sent: true, to: emails };
}
