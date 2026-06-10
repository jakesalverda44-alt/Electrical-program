import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';
import { graphSendMail, GraphAttachment, TEAM_NOTIFY_TO } from './graphMailer';

// First-contact automation for inbound (Kohler) leads, sent from our Microsoft
// 365 mailbox via the shared Graph mailer (email/graphMailer.ts).

// Resolved relative to the compiled dist/email dir → backend/assets, matching
// how proposalDocx.ts locates its assets. Embedded as an inline attachment so
// the logo renders without any external fetch.
const LOGO_PATH = path.resolve(__dirname, '../../assets/email-logo.png');
const LOGO_CID = 'apt-logo';

export interface LeadForContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** The PNG logo as a Graph inline file attachment (base64). Read+encoded lazily. */
let logoAttachment: GraphAttachment | null = null;
function getLogoAttachment(): GraphAttachment {
  if (logoAttachment) return logoAttachment;
  const contentBytes = fs.readFileSync(LOGO_PATH).toString('base64');
  logoAttachment = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'logo.png',
    contentType: 'image/png',
    contentBytes,
    isInline: true,
    contentId: LOGO_CID,
  };
  return logoAttachment;
}

// --- Content (unchanged subject + HTML body) ---

/**
 * Kohler sends placeholder addresses when a homeowner refuses to share an email
 * (e.g. refuse@kohler.com). These can never be emailed — leads carrying one are
 * treated as phone-only and flagged for a call.
 */
export function isPlaceholderLeadEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return false;
  return e.endsWith('@kohler.com') || /^(refuse[d]?|no-?email|do-?not-?email|none|declined)@/.test(e);
}

/** First word of the lead's name, or "there" when we have nothing usable. */
export function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

/** Shared signature block (logo via inline Content-ID). */
function signatureHtml(): string {
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;">
      <tr>
        <td style="vertical-align:middle;padding-right:16px;border-right:2px solid #1c2c54;">
          <img src="cid:${LOGO_CID}" alt="Accurate Power and Technology" width="180"
            style="display:block;max-width:180px;height:auto;">
        </td>
        <td style="vertical-align:middle;padding-left:16px;font-family:Arial,sans-serif;font-size:13px;color:#1c2c54;line-height:1.5;">
          <div style="font-size:15px;font-weight:bold;color:#1c2c54;">Jake Salverda</div>
          <div style="color:#444;">Commercial A.E · Central FL Region</div>
          <div style="margin-top:6px;">License EC13007737 · LI45063</div>
          <div><a href="tel:3527358285" style="color:#1c2c54;text-decoration:none;">352-735-8285</a> Office
            &nbsp;·&nbsp; <a href="tel:3528018997" style="color:#1c2c54;text-decoration:none;">352-801-8997</a> Cell</div>
          <div>15519 W US Hwy 441, Suite 101A, Eustis, FL 32726</div>
          <div><a href="mailto:JakeS@accuratepowerandtechnology.com" style="color:#1c2c54;">JakeS@accuratepowerandtechnology.com</a></div>
        </td>
      </tr>
    </table>`;
}

/** HTML body for the first-contact email. `firstName` is escaped before use. */
export function leadFirstContactHtml(firstName: string): string {
  const name = escapeHtml(firstName);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;">
    <p>Hi ${name},</p>
    <p>Thanks for reaching out through Kohler about a home standby generator — we've got
    your information and someone from our team will follow up within one business day.</p>
    <p>Want to move faster? Reply here with the best number and time to reach you, or call
    or text Jake directly at <a href="tel:3528018997" style="color:#1c2c54;">352-801-8997</a>.
    We'll walk you through your options and rough pricing.</p>
    <p style="font-weight:bold;">What's the best way and time to reach you?</p>
    ${signatureHtml()}
  </div>`;
}

/**
 * HTML body for the day-2 engagement nudge: sent the morning after a Kohler lead
 * was accepted when they haven't replied and nobody has reached them by phone.
 * Goal: get them to reply with what they actually want out of a generator.
 */
export function leadNudgeHtml(firstName: string): string {
  const name = escapeHtml(firstName);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;">
    <p>Hi ${name},</p>
    <p>Following up on your Kohler generator request — I'd like to understand what you
    want to accomplish with this project so I can point you in the right direction.
    A few quick questions, just hit reply:</p>
    <ul style="margin:0 0 14px 0;padding-left:22px;">
      <li style="margin-bottom:6px;">What's driving the need for backup power — past
        outages, storm prep, medical equipment?</li>
      <li style="margin-bottom:6px;">Whole-home coverage, or just the essentials
        (A/C, fridge, well pump)?</li>
      <li>Natural gas at the house, or propane?</li>
    </ul>
    <p>Even a one-line reply is enough to get you real answers and honest numbers.</p>
    ${signatureHtml()}
  </div>`;
}

/**
 * Send the first-contact email to an email lead, with the logo embedded inline
 * (Content-ID "apt-logo"). Throws on failure so the caller can leave
 * first_contact_sent_at NULL and retry later.
 */
export async function sendLeadFirstContactEmail(lead: LeadForContact): Promise<void> {
  if (!lead.email) throw new Error('lead has no email');
  await graphSendMail({
    to: lead.email,
    subject: 'We got your request — Accurate Power & Technology',
    html: leadFirstContactHtml(firstNameOf(lead.name)),
    attachments: [getLogoAttachment()],
  });
  logger.info({ leadId: lead.id }, '[lead first-contact] email sent');
}

/**
 * Send the day-2 engagement nudge to a lead that has gone quiet since first
 * contact. Throws on failure so the caller can release the claim and retry.
 */
export async function sendLeadNudgeEmail(lead: LeadForContact): Promise<void> {
  if (!lead.email) throw new Error('lead has no email');
  await graphSendMail({
    to: lead.email,
    subject: 'Quick question about your generator project',
    html: leadNudgeHtml(firstNameOf(lead.name)),
    attachments: [getLogoAttachment()],
  });
  logger.info({ leadId: lead.id }, '[lead nudge] engagement email sent');
}

/**
 * Notify the team that a phone-only lead needs a manual call. Throws on failure
 * so the caller can leave first_contact_sent_at NULL and retry later.
 */
export async function sendNeedsCallNotification(lead: LeadForContact): Promise<void> {
  const phone = lead.phone || '(no phone on file)';
  const name = lead.name || 'Unknown';
  await graphSendMail({
    to: TEAM_NOTIFY_TO,
    subject: 'New Kohler lead — no usable email, needs a call',
    html: `<p>New Kohler lead with no usable email — call ${escapeHtml(name)} at ${escapeHtml(phone)}.</p>`,
  });
  logger.info({ leadId: lead.id }, '[lead first-contact] needs-call notification sent');
}
