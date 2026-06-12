import fs from 'fs';
import path from 'path';
import { getSetting } from '../db/getSetting';
import { escapeHtml } from '../utils/escapeHtml';
import type { GraphAttachment } from './graphMailer';

// Outbound email signature, appended by graphSendMail to every message it sends.
// A custom `email_signature` setting (Settings → Email) wins; otherwise the branded
// Accurate Power signature with the logo embedded inline (Content-ID), so it renders
// even when a client blocks remote images by default.

// Asset resolved relative to the compiled dist/email dir → backend/assets, same as
// proposalDocx.ts and the lead first-contact email.
const LOGO_PATH = path.resolve(__dirname, '../../assets/email-logo.png');
export const LOGO_CID = 'apt-logo';

let logoAttachment: GraphAttachment | null = null;
/** The PNG logo as a Graph inline file attachment (base64). Read+encoded lazily. */
export function getLogoAttachment(): GraphAttachment {
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

/** Branded Accurate Power signature: inline logo (Content-ID) beside contact details. */
export function brandedSignatureHtml(): string {
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

export interface ResolvedSignature {
  html: string;
  attachments: GraphAttachment[];
}

/**
 * The signature to append to outbound app email. A custom `email_signature` setting wins
 * (plain text or HTML, no logo); otherwise the branded signature with the inline logo.
 */
export async function resolveSignature(): Promise<ResolvedSignature> {
  const raw = ((await getSetting('email_signature')) || '').trim();
  if (raw) {
    const looksHtml = /<[a-z][\s\S]*>/i.test(raw);
    const body = looksHtml ? raw : escapeHtml(raw).replace(/\n/g, '<br>');
    return {
      html: `<br><br><div style="margin-top:16px;padding-top:12px;border-top:1px solid #e0e0e0;color:#444;font-size:13px;line-height:1.5">${body}</div>`,
      attachments: [],
    };
  }
  return { html: `<br>${brandedSignatureHtml()}`, attachments: [getLogoAttachment()] };
}
