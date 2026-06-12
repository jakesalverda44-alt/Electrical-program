import { getGraphToken, GRAPH_BASE } from '../integrations/graphAuth';
import { resolveSignature } from './signature';

// Shared Microsoft Graph sendMail helper (app-only auth). All outbound mail —
// lead first contact, nudges, proposal sends, internal notifications — goes out
// from this mailbox so replies land back in the shared inbox. SMTP is
// intentionally not used: the tenant blocks SMTP AUTH and app passwords.

export const SEND_AS = 'JakeS@accuratepowerandtechnology.com';
// Internal heads-up address for team notifications (needs-call, proposal signed).
export const TEAM_NOTIFY_TO = 'jakes@accuratepowerandtechnology.com';

export interface GraphAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
  isInline: boolean;
  contentId: string;
}

export interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: GraphAttachment[];
  /** Append the configured signature (default true). Set false when the body already has one. */
  appendSignature?: boolean;
}

export function isGraphMailConfigured(): boolean {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

export async function graphSendMail({ to, subject, html, attachments, appendSignature = true }: SendArgs): Promise<void> {
  const token = await getGraphToken();
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);

  // Append the signature (branded-with-logo by default, or the custom setting) unless the
  // caller already embedded one. Merge any inline logo attachment with the caller's.
  let content = html;
  const allAttachments: GraphAttachment[] = attachments ? [...attachments] : [];
  if (appendSignature) {
    const sig = await resolveSignature();
    content += sig.html;
    allAttachments.push(...sig.attachments);
  }

  const message: Record<string, unknown> = {
    subject,
    body: { contentType: 'HTML', content },
    toRecipients: toList.map(address => ({ emailAddress: { address } })),
  };
  if (allAttachments.length) message.attachments = allAttachments;

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
