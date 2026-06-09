import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';

// First-contact automation for inbound (Kohler) leads. Sent over our Microsoft
// 365 mailbox via SMTP. If the tenant blocks SMTP AUTH this is the single place
// to swap in Microsoft Graph sendMail (see README / env notes).

const FROM = 'JakeS@accuratepowerandtechnology.com';
// Internal heads-up address for phone-only leads (no email to contact).
const NEEDS_CALL_TO = 'jakes@accuratepowerandtechnology.com';

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

let transporter: Transporter | null = null;

/** Lazily build the Office 365 SMTP transport. Throws if credentials are unset. */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('SMTP_USER / SMTP_PASS are not configured');
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,    // STARTTLS is negotiated on the plain 587 connection
    requireTLS: true,
    auth: { user, pass },
  });
  return transporter;
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
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;">
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
    </table>
  </div>`;
}

/**
 * Send the first-contact email to an email lead, with the logo embedded inline
 * (Content-ID "apt-logo"). Throws on failure so the caller can leave
 * first_contact_sent_at NULL and retry later.
 */
export async function sendLeadFirstContactEmail(lead: LeadForContact): Promise<void> {
  if (!lead.email) throw new Error('lead has no email');
  await getTransporter().sendMail({
    from: FROM,
    to: lead.email,
    subject: 'We got your request — Accurate Power & Technology',
    html: leadFirstContactHtml(firstNameOf(lead.name)),
    attachments: [
      { filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID },
    ],
  });
  logger.info({ leadId: lead.id }, '[lead first-contact] email sent');
}

/**
 * Notify the team that a phone-only lead needs a manual call. Throws on failure
 * so the caller can leave first_contact_sent_at NULL and retry later.
 */
export async function sendNeedsCallNotification(lead: LeadForContact): Promise<void> {
  const phone = lead.phone || '(no phone on file)';
  const name = lead.name || 'Unknown';
  await getTransporter().sendMail({
    from: FROM,
    to: NEEDS_CALL_TO,
    subject: 'New Kohler lead — no email, needs a call',
    text: `New Kohler lead, no email — call ${name} at ${phone}.`,
  });
  logger.info({ leadId: lead.id }, '[lead first-contact] needs-call notification sent');
}
