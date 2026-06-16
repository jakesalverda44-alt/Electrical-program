import { getSetting } from '../db/getSetting';
import { escapeHtml } from '../utils/escapeHtml';
import { graphSendMail, isGraphMailConfigured, GraphAttachment } from './graphMailer';

// "New commercial bid → team" notification. Shared by the manual POST /bids path
// (auto-send, gated by the bid_notify_enabled toggle) and the Intake accept path
// (opt-in per accept, with a reviewer-edited recipient list). Mail goes out via
// Microsoft Graph from the shared mailbox.

export interface BidNotifyData {
  name: unknown;
  gc: unknown;
  loc: unknown;
  due?: unknown;
  amount?: unknown;
  contact?: unknown;
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

function buildEmail(
  bid: BidNotifyData,
  addedByName: string,
  base: string,
  opts: { attachedNames?: string[]; driveLink?: string | null } = {},
) {
  const str = (v: unknown) => (v == null ? '' : String(v)).trim();
  const dueStr = bid.due ? String(bid.due) : 'TBD';
  const amt = bid.amount ? '$' + Number(bid.amount).toLocaleString() : null;

  // Plain, readable lines — no card/table. Only show fields we actually have.
  const rows: string[] = [
    `<strong>Job:</strong> ${escapeHtml(str(bid.name))}`,
    bid.gc ? `<strong>General Contractor:</strong> ${escapeHtml(str(bid.gc))}` : '',
    bid.loc ? `<strong>Location:</strong> ${escapeHtml(str(bid.loc))}` : '',
    bid.contact ? `<strong>Contact:</strong> ${escapeHtml(str(bid.contact))}` : '',
    `<strong>Due:</strong> ${escapeHtml(dueStr)}`,
    amt ? `<strong>Estimated Value:</strong> ${escapeHtml(amt)}` : '',
    `<strong>Added by:</strong> ${escapeHtml(addedByName)}`,
  ].filter(Boolean);

  const parts: string[] = [
    `<p>Team,</p>`,
    `<p>We have a new commercial bid to work:</p>`,
    `<p style="line-height:1.7">${rows.join('<br>')}</p>`,
  ];
  if (opts.attachedNames?.length) {
    parts.push(`<p>Plans &amp; documents attached: ${opts.attachedNames.map(n => escapeHtml(n)).join(', ')}.</p>`);
  }
  if (opts.driveLink) {
    parts.push(`<p>All job files are in Google Drive: <a href="${opts.driveLink}">${opts.driveLink}</a></p>`);
  }
  parts.push(`<p>View it in the pipeline: <a href="${base}">${base}</a></p>`);

  const subject = `New Bid — ${str(bid.name)}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${parts.join('\n')}</div>`;
  return { subject, html };
}

export interface SendBidNotificationOpts {
  /** Explicit recipient list (Intake accept passes the reviewer-edited list). */
  to?: string[];
  /** Send even when bid_notify_enabled is 'false' (used for the explicit opt-in). */
  force?: boolean;
  /** File attachments (e.g. the bid's uploaded plans). */
  attachments?: GraphAttachment[];
  /** Names of the attached files, listed in the body. */
  attachedNames?: string[];
  /** Optional Google Drive folder link (e.g. for plans too large to attach). */
  driveLink?: string | null;
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
  const [enabled, frontendUrl] = await Promise.all([
    getSetting('bid_notify_enabled'),
    getSetting('frontend_url'),
  ]);
  if (!opts.force && enabled === 'false') return { sent: false, to: [] };

  const emails = (opts.to ?? await getBidNotifyEmails()).map(s => s.trim()).filter(Boolean);
  if (!emails.length) return { sent: false, to: [] };
  if (!isGraphMailConfigured()) return { sent: false, to: [] };

  const base = (frontendUrl || 'https://electrical-program.onrender.com').replace(/\/$/, '');
  const { subject, html } = buildEmail(bid, addedBy.name, base, { attachedNames: opts.attachedNames, driveLink: opts.driveLink });
  await graphSendMail({ to: emails, subject, html, attachments: opts.attachments });
  return { sent: true, to: emails };
}

