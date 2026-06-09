import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';

// First-contact automation for inbound (Kohler) leads, sent from our Microsoft
// 365 mailbox via the Microsoft Graph API using app-only (client credentials)
// auth. SMTP is intentionally not used: the tenant blocks SMTP AUTH and app
// passwords.

// The mailbox we send as / from. App-only Mail.Send must be scoped to this
// mailbox via an Application Access Policy (see env/README notes).
const SEND_AS = 'JakeS@accuratepowerandtechnology.com';
// Internal heads-up address for phone-only leads (no email to contact).
const NEEDS_CALL_TO = 'jakes@accuratepowerandtechnology.com';

// Resolved relative to the compiled dist/email dir → backend/assets, matching
// how proposalDocx.ts locates its assets. Embedded as an inline attachment so
// the logo renders without any external fetch.
const LOGO_PATH = path.resolve(__dirname, '../../assets/email-logo.png');
const LOGO_CID = 'apt-logo';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface LeadForContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

// --- Auth: app-only client credentials with a tiny in-process token cache. ---

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET are not configured');
  }

  // Reuse a still-valid token (refresh 60s before actual expiry).
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Graph token request failed: HTTP ${resp.status} ${text}`);
  }

  const json = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

// --- Graph sendMail ---

interface GraphAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
  isInline: boolean;
  contentId: string;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: GraphAttachment[];
}

async function graphSendMail({ to, subject, html, attachments }: SendArgs): Promise<void> {
  const token = await getGraphToken();
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  if (attachments?.length) message.attachments = attachments;

  const resp = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(SEND_AS)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  );

  // Graph sendMail returns 202 Accepted with an empty body on success.
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Graph sendMail failed: HTTP ${resp.status} ${text}`);
  }
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
  await graphSendMail({
    to: lead.email,
    subject: 'We got your request — Accurate Power & Technology',
    html: leadFirstContactHtml(firstNameOf(lead.name)),
    attachments: [getLogoAttachment()],
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
  await graphSendMail({
    to: NEEDS_CALL_TO,
    subject: 'New Kohler lead — no email, needs a call',
    html: `<p>New Kohler lead, no email — call ${escapeHtml(name)} at ${escapeHtml(phone)}.</p>`,
  });
  logger.info({ leadId: lead.id }, '[lead first-contact] needs-call notification sent');
}
