import { logger } from '../utils/logger';
import { getGraphToken, GRAPH_BASE, GRAPH_MAILBOX } from './graphAuth';

// Read side of the Microsoft Graph integration: pull "new bid"-tagged invitations from the
// Inbox, download their attachments, and create (but never send) a draft reply. Uses the
// same app-only client-credentials auth as the send/calendar features.
//
// Required app-only permissions (admin-consented, scoped to GRAPH_MAILBOX):
//   Mail.Read       — read the Inbox
//   Mail.ReadWrite  — create the draft reply
//   Calendars.ReadWrite (used by outlookCalendar) — add the due date

const MAILBOX = encodeURIComponent(GRAPH_MAILBOX);

// The Outlook category that flags an email for import. Matched case-insensitively in code
// (Graph stores categories with their original casing).
export const BID_CATEGORY = 'new bid';

export interface GraphMailMessage {
  id: string;
  subject: string;
  from: string | null;        // sender email address
  fromName: string | null;    // sender display name (the GC)
  receivedDateTime: string;
  bodyPreview: string;
  body: string;               // full plain-text-ish body for date parsing
  webLink: string;
  categories: string[];
  hasAttachments: boolean;
}

interface GraphMessageRaw {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  webLink?: string;
  categories?: string[];
  hasAttachments?: boolean;
}

async function graphGet<T>(path: string): Promise<T> {
  const token = await getGraphToken();
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Graph GET ${path} failed: HTTP ${resp.status} ${text}`);
  }
  return (await resp.json()) as T;
}

/** Strip HTML tags to a rough plain-text body for light date parsing. */
function toPlainText(content: string, contentType?: string): string {
  if (contentType?.toLowerCase() === 'html') {
    return content.replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return content;
}

/**
 * Fetch recent Inbox messages tagged with the "new bid" Outlook category. We pull the most
 * recent N and filter the category in code so the match is case-insensitive (Graph's
 * categories/any OData filter is case-sensitive). Returns [] on any failure.
 */
export async function fetchTaggedBidEmails(limit = 50): Promise<GraphMailMessage[]> {
  try {
    const select = 'id,subject,from,receivedDateTime,bodyPreview,body,webLink,categories,hasAttachments';
    const path = `/users/${MAILBOX}/mailFolders/Inbox/messages`
      + `?$select=${select}&$top=${limit}&$orderby=receivedDateTime desc`;
    const data = await graphGet<{ value: GraphMessageRaw[] }>(path);
    const wanted = BID_CATEGORY.toLowerCase();
    return (data.value || [])
      .filter(m => (m.categories || []).some(c => c.trim().toLowerCase() === wanted))
      .map(m => ({
        id: m.id,
        subject: (m.subject || '').trim(),
        from: m.from?.emailAddress?.address || null,
        fromName: m.from?.emailAddress?.name || null,
        receivedDateTime: m.receivedDateTime || new Date().toISOString(),
        bodyPreview: (m.bodyPreview || '').trim(),
        body: toPlainText(m.body?.content || m.bodyPreview || '', m.body?.contentType),
        webLink: m.webLink || '',
        categories: m.categories || [],
        hasAttachments: !!m.hasAttachments,
      }));
  } catch (err) {
    logger.error({ err }, '[outlook-mail] fetchTaggedBidEmails failed');
    return [];
  }
}

export interface GraphAttachmentFile {
  name: string;
  contentType: string;
  content: Buffer;
}

interface GraphAttachmentRaw {
  '@odata.type'?: string;
  name?: string;
  contentType?: string;
  contentBytes?: string;
}

/** Just the attachment filenames for an email (no download), used at import time. */
export async function listAttachmentNames(messageId: string): Promise<string[]> {
  try {
    const data = await graphGet<{ value: GraphAttachmentRaw[] }>(
      `/users/${MAILBOX}/messages/${messageId}/attachments?$select=name,@odata.type`
    );
    return (data.value || [])
      .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.name)
      .map(a => a.name as string);
  } catch (err) {
    logger.error({ err, messageId }, '[outlook-mail] listAttachmentNames failed');
    return [];
  }
}

/** Download the file attachments of an email as Buffers (for upload to Drive on accept). */
export async function downloadAttachments(messageId: string): Promise<GraphAttachmentFile[]> {
  const data = await graphGet<{ value: GraphAttachmentRaw[] }>(
    `/users/${MAILBOX}/messages/${messageId}/attachments`
  );
  return (data.value || [])
    .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.name && a.contentBytes)
    .map(a => ({
      name: a.name as string,
      contentType: a.contentType || 'application/octet-stream',
      content: Buffer.from(a.contentBytes as string, 'base64'),
    }));
}

/**
 * Create a DRAFT reply to the GC in Outlook (saved to Drafts, NOT sent). The reviewer
 * reviews and sends it manually. Non-blocking: logs and swallows errors.
 */
export async function createReplyDraft(messageId: string, comment: string): Promise<void> {
  try {
    const token = await getGraphToken();
    const resp = await fetch(
      `${GRAPH_BASE}/users/${MAILBOX}/messages/${messageId}/createReply`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Graph createReply failed: HTTP ${resp.status} ${text}`);
    }
    logger.info({ messageId }, '[outlook-mail] draft reply created');
  } catch (err) {
    logger.error({ err, messageId }, '[outlook-mail] createReplyDraft failed');
  }
}
