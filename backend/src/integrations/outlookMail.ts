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
  isRead: boolean;
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
  isRead?: boolean;
}

// Sender substrings that mark a Kohler new-lead notification email. Overridable via
// KOHLER_SENDER_MATCH (comma-separated). Matched case-insensitively against the from
// address. Deliberately the lead-notification sender only (kohlerleadnotification@rehlko.com)
// — a bare 'kohler' also matches PartnerComms marketing blasts, which are not leads.
export const KOHLER_SENDER_MATCH: string[] =
  (process.env.KOHLER_SENDER_MATCH || 'kohlerleadnotification').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** True when a message looks like a Kohler new-lead notification (by sender address). */
export function isKohlerNotification(msg: { from: string | null }): boolean {
  const from = (msg.from || '').toLowerCase();
  return !!from && KOHLER_SENDER_MATCH.some(s => from.includes(s));
}

/** Map a raw Graph message to our normalized shape. */
function mapRaw(m: GraphMessageRaw): GraphMailMessage {
  return {
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
    isRead: m.isRead !== false, // default true when not selected
  };
}

export async function graphGet<T>(path: string): Promise<T> {
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
      .map(mapRaw);
  } catch (err) {
    logger.error({ err }, '[outlook-mail] fetchTaggedBidEmails failed');
    return [];
  }
}

// Lightweight select for brief scans — no body (keeps payloads small), includes isRead.
const SCAN_SELECT = 'id,subject,from,receivedDateTime,bodyPreview,webLink,categories,hasAttachments,isRead';

/**
 * Unread Inbox messages (newest first). Graph rejects $orderby combined with an arbitrary
 * $filter, so we filter isRead server-side and sort by receivedDateTime in code (matches the
 * codebase's "filter in code" approach). Returns [] on any failure.
 */
export async function fetchUnreadInbox(limit = 50): Promise<GraphMailMessage[]> {
  try {
    const path = `/users/${MAILBOX}/mailFolders/Inbox/messages`
      + `?$select=${SCAN_SELECT}&$top=${limit}&$filter=isRead eq false`;
    const data = await graphGet<{ value: GraphMessageRaw[] }>(path);
    return (data.value || []).map(mapRaw)
      .sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
  } catch (err) {
    logger.error({ err }, '[outlook-mail] fetchUnreadInbox failed');
    return [];
  }
}

/**
 * All Inbox messages (read + unread) received since `sinceIso`, newest first — used to count
 * Kohler notifications "received this month". Returns [] on any failure.
 */
export async function fetchInboxSince(sinceIso: string, limit = 200): Promise<GraphMailMessage[]> {
  try {
    const path = `/users/${MAILBOX}/mailFolders/Inbox/messages`
      + `?$select=${SCAN_SELECT}&$top=${limit}`
      + `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`
      + `&$orderby=${encodeURIComponent('receivedDateTime desc')}`;
    const data = await graphGet<{ value: GraphMessageRaw[] }>(path);
    return (data.value || []).map(mapRaw);
  } catch (err) {
    logger.error({ err }, '[outlook-mail] fetchInboxSince failed');
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
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}

/** Just the attachment filenames for an email (no download), used at import time. */
export async function listAttachmentNames(messageId: string): Promise<string[]> {
  try {
    const mid = encodeURIComponent(messageId);
    const data = await graphGet<{ value: GraphAttachmentRaw[] }>(
      `/users/${MAILBOX}/messages/${mid}/attachments?$select=id,name,contentType,size,isInline`
    );
    return (data.value || [])
      .filter(a => !a.isInline && a.name)
      .map(a => a.name as string);
  } catch (err) {
    logger.error({ err, messageId }, '[outlook-mail] listAttachmentNames failed');
    return [];
  }
}

/**
 * Download the real file attachments of an email as Buffers (for upload to Drive on accept).
 *
 * Lists attachment metadata first (skipping inline signature images), then pulls each file's
 * raw bytes via the `/$value` endpoint — which is reliable for the large PDFs bid invitations
 * carry, where `contentBytes` may be omitted from the collection response. Per-attachment
 * failures are logged and skipped rather than aborting the whole set. The message id is
 * URL-encoded because immutable Graph ids contain '/', '+' and '=' .
 */
export async function downloadAttachments(messageId: string): Promise<GraphAttachmentFile[]> {
  const mid = encodeURIComponent(messageId);
  const list = await graphGet<{ value: GraphAttachmentRaw[] }>(
    `/users/${MAILBOX}/messages/${mid}/attachments?$select=id,name,contentType,size,isInline`
  );
  const candidates = (list.value || []).filter(a =>
    a.id && a.name && !a.isInline &&
    (!a['@odata.type'] || a['@odata.type'] === '#microsoft.graph.fileAttachment')
  );
  if (!candidates.length) {
    logger.info({ messageId, total: list.value?.length ?? 0 }, '[outlook-mail] no downloadable file attachments');
    return [];
  }

  const token = await getGraphToken();
  const files: GraphAttachmentFile[] = [];
  for (const a of candidates) {
    try {
      const resp = await fetch(
        `${GRAPH_BASE}/users/${MAILBOX}/messages/${mid}/attachments/${encodeURIComponent(a.id as string)}/$value`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        logger.error({ messageId, name: a.name, status: resp.status, text }, '[outlook-mail] attachment $value fetch failed');
        continue;
      }
      const content = Buffer.from(await resp.arrayBuffer());
      files.push({ name: a.name as string, contentType: a.contentType || 'application/octet-stream', content });
    } catch (err) {
      logger.error({ err, messageId, name: a.name }, '[outlook-mail] attachment download errored');
    }
  }
  logger.info({ messageId, downloaded: files.length, candidates: candidates.length }, '[outlook-mail] downloadAttachments complete');
  return files;
}

/**
 * Create a DRAFT reply to the email's sender in Outlook (saved to Drafts, NOT sent). The
 * reviewer reviews and sends it manually. Non-blocking: logs and swallows errors. The message
 * id is URL-encoded (immutable Graph ids contain '/', '+' and '=').
 */
export interface MarkReadResult {
  ok: boolean;
  /** Graph HTTP status when the PATCH was rejected, for diagnostics. */
  status?: number;
  /** Human-readable reason the caller can surface to the user. */
  reason?: string;
}

/** Map a Graph PATCH failure to a short, actionable reason. */
function markReadReason(status: number): string {
  if (status === 403) return 'The mailbox app is missing the Mail.ReadWrite permission (needs admin consent in Azure).';
  if (status === 404) return 'That email was not found in the mailbox (it may have been moved or deleted).';
  if (status === 401) return 'Outlook authorization failed — the Graph app credentials need attention.';
  return `Outlook rejected the request (HTTP ${status}).`;
}

/**
 * Mark an Inbox message as read in Outlook (PATCH isRead=true). Uses the same
 * Mail.ReadWrite app permission as the draft-reply feature. Returns a result with
 * the Graph status so the caller can surface exactly why it failed.
 */
export async function markMessageRead(messageId: string): Promise<MarkReadResult> {
  try {
    const token = await getGraphToken();
    const resp = await fetch(
      `${GRAPH_BASE}/users/${MAILBOX}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.error({ messageId, status: resp.status, text }, '[outlook-mail] markMessageRead rejected');
      return { ok: false, status: resp.status, reason: markReadReason(resp.status) };
    }
    logger.info({ messageId }, '[outlook-mail] message marked read');
    return { ok: true };
  } catch (err) {
    logger.error({ err, messageId }, '[outlook-mail] markMessageRead failed');
    return { ok: false, reason: 'Could not reach Outlook. Check the network/Graph connection.' };
  }
}

export async function createReplyDraft(messageId: string, comment: string): Promise<void> {
  try {
    const token = await getGraphToken();
    const resp = await fetch(
      `${GRAPH_BASE}/users/${MAILBOX}/messages/${encodeURIComponent(messageId)}/createReply`,
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
