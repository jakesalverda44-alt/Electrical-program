import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';
import { graphSendMail, TEAM_NOTIFY_TO } from './graphMailer';
import { brandedSignatureHtml, getLogoAttachment } from './signature';

// First-contact automation for inbound (Kohler) leads, sent from our Microsoft
// 365 mailbox via the shared Graph mailer (email/graphMailer.ts).

export interface LeadForContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
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
    ${brandedSignatureHtml()}
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
    ${brandedSignatureHtml()}
  </div>`;
}

/**
 * HTML body for the "going cold" final touch: sent a few days after the day-2 nudge
 * when a Kohler lead still hasn't replied and nobody has reached them. No-pressure,
 * leaves the door open, and makes it one tap to call/text Jake directly.
 */
export function leadColdHtml(firstName: string): string {
  const name = escapeHtml(firstName);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6;">
    <p>Hi ${name},</p>
    <p>I haven't heard back, so I'll close out your request for now — no problem at all.</p>
    <p>Whenever you're ready to talk backup power, just reply or call/text me at
    <a href="tel:3528018997" style="color:#1c2c54;">352-801-8997</a> and we'll pick right up.</p>
    ${brandedSignatureHtml()}
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
    appendSignature: false,
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
    appendSignature: false,
  });
  logger.info({ leadId: lead.id }, '[lead nudge] engagement email sent');
}

/**
 * Send the "going cold" final touch to a lead that never engaged after the nudge.
 * Throws on failure so the caller can release the claim and retry.
 */
export async function sendLeadColdEmail(lead: LeadForContact): Promise<void> {
  if (!lead.email) throw new Error('lead has no email');
  await graphSendMail({
    to: lead.email,
    subject: "Closing the loop on your generator request",
    html: leadColdHtml(firstNameOf(lead.name)),
    attachments: [getLogoAttachment()],
    appendSignature: false,
  });
  logger.info({ leadId: lead.id }, '[lead cold] final-touch email sent');
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
