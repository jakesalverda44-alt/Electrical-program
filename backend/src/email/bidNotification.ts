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
  opts: { attachedNames?: string[]; driveLink?: string | null } = {},
) {
  const str = (v: unknown) => (v == null ? '' : String(v)).trim();
  const dueStr = bid.due ? String(bid.due) : 'TBD';
  const amt = bid.amount ? '$' + Number(bid.amount).toLocaleString() : null;

  // Plain lines, no styling — reads like a normal typed email; the signature follows.
  const rows: string[] = [
    `Job: ${escapeHtml(str(bid.name))}`,
    bid.gc ? `General Contractor: ${escapeHtml(str(bid.gc))}` : '',
    bid.loc ? `Location: ${escapeHtml(str(bid.loc))}` : '',
    bid.contact ? `Contact: ${escapeHtml(str(bid.contact))}` : '',
    `Due: ${escapeHtml(dueStr)}`,
    amt ? `Estimated Value: ${escapeHtml(amt)}` : '',
    `Added by: ${escapeHtml(addedByName)}`,
  ].filter(Boolean);

  const parts: string[] = [
    `<p>Team,</p>`,
    `<p>We have a new commercial bid to work:</p>`,
    `<p>${rows.join('<br>')}</p>`,
  ];
  if (opts.attachedNames?.length) {
    parts.push(`<p>Plans &amp; documents attached: ${opts.attachedNames.map(n => escapeHtml(n)).join(', ')}.</p>`);
  }
  if (opts.driveLink) {
    parts.push(`<p>All job files are in Google Drive: <a href="${opts.driveLink}">${opts.driveLink}</a></p>`);
  }

  const subject = `New Bid — ${str(bid.name)}`;
  const html = parts.join('\n');
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
  const enabled = await getSetting('bid_notify_enabled');
  if (!opts.force && enabled === 'false') return { sent: false, to: [] };

  const emails = (opts.to ?? await getBidNotifyEmails()).map(s => s.trim()).filter(Boolean);
  if (!emails.length) return { sent: false, to: [] };
  if (!isGraphMailConfigured()) return { sent: false, to: [] };

  const { subject, html } = buildEmail(bid, addedBy.name, { attachedNames: opts.attachedNames, driveLink: opts.driveLink });
  await graphSendMail({ to: emails, subject, html, attachments: opts.attachments });
  return { sent: true, to: emails };
}

