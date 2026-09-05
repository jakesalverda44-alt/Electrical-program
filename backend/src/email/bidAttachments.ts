import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getFileMedia } from '../services/googleDrive';
import { GraphAttachment } from './graphMailer';

// Loads the files uploaded to a bid (the `documents` table, linked by linked_id) and
// turns them into Graph mail attachments — used to attach plans to the "new bid → team"
// email. Files can live in three places: base64 in the DB, Cloudinary (storage_url), or
// Google Drive (storage_url like /file/d/<id>/view). A total-size cap keeps the message
// under typical mailbox limits; anything skipped is reported so the caller can fall back
// to a Drive folder link.

const DEFAULT_MAX_TOTAL = 18 * 1024 * 1024; // ~18MB raw (stays under a 25MB envelope once base64-encoded)

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export interface DocRow {
  id: string;
  name: string | null;
  display_name: string | null;
  category: string | null;
  file_type: string | null;
  file_size: number | null;
  file_data: string | null;
  storage_url: string | null;
}

export async function fetchDocBytes(doc: DocRow): Promise<Buffer | null> {
  if (doc.file_data) return Buffer.from(doc.file_data, 'base64');
  if (doc.storage_url) {
    const drive = /\/file\/d\/([^/?#]+)/.exec(doc.storage_url);
    if (drive) {
      const media = await getFileMedia(drive[1]);
      return media ? streamToBuffer(media.stream) : null;
    }
    const resp = await fetch(doc.storage_url);
    if (resp.ok) return Buffer.from(await resp.arrayBuffer());
  }
  return null;
}

export interface BidAttachmentsResult {
  attachments: GraphAttachment[];
  attachedNames: string[];
  skipped: string[];   // names skipped (too large to fit, or could not be fetched)
}

export interface LinkedDocRef { name: string; category: string | null; }

export interface LinkedAttachmentsResult extends BidAttachmentsResult {
  /** name + category for every document actually attached, in order — lets the
   *  caller label each one (e.g. "Signed Proposal", "Sizer Report") in the email body. */
  attached: LinkedDocRef[];
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
  'image/webp': '.webp', 'image/heic': '.heic',
};
const HAS_EXT = /\.[A-Za-z0-9]{1,5}$/;

/** Attachment filename with a real extension — Outlook won't preview an
 *  extensionless attachment, it forces a save instead. */
export function attachmentFileName(displayName: string | null, originalName: string | null, fileType: string | null): string {
  const display = (displayName || '').trim();
  const original = (originalName || '').trim();
  const base = display || original || 'file';
  if (HAS_EXT.test(base)) return base;
  const fromOriginal = original.match(HAS_EXT)?.[0];
  if (fromOriginal) return base + fromOriginal;
  const fromMime = fileType ? MIME_EXT[fileType.toLowerCase()] : undefined;
  return fromMime ? base + fromMime : base;
}

/** Build Graph attachments from any linked_id's uploaded documents (bid or gen proposal),
 *  capped at maxTotalBytes total. Pass `categories` to only pull specific document types. */
export async function loadLinkedDocumentsAsAttachments(
  linkedId: string,
  opts: { maxTotalBytes?: number; categories?: string[] } = {},
): Promise<LinkedAttachmentsResult> {
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL;
  const params: unknown[] = [linkedId];
  let categoryClause = '';
  if (opts.categories?.length) {
    params.push(opts.categories);
    categoryClause = ` AND category = ANY($${params.length})`;
  }

  // Task 9 (audit data #10), refined by post-review hardening 5d — this
  // selects metadata only (no file_data — the largest single column on this
  // table, up to a few MB of base64 per row), so most oversized documents
  // never even have their bytes fetched. The metadata-only file_size budget
  // below is a coarse pre-filter deciding what's worth fetching; the
  // authoritative budget decision happens afterward against confirmed,
  // actually-fetched byte counts, so a failed fetch or a size estimate that
  // turns out wrong can never consume budget a later attachment could have
  // used.
  const { rows: meta } = await pool.query<Omit<DocRow, 'file_data'>>(
    `SELECT id, name, display_name, category, file_type, file_size, storage_url
       FROM documents
      WHERE linked_id = $1 AND deleted_at IS NULL${categoryClause}
      ORDER BY created_at ASC`,
    params
  );

  // Pass 1 (from metadata alone): a per-document pre-filter deciding which
  // documents are even worth fetching bytes for — skip only a document
  // whose OWN recorded file_size already busts the budget on its own.
  // Post-review hardening 5d: this is deliberately NOT a cumulative running
  // total the way the old single-pass version's was — charging one
  // document's estimated size against a shared total here, before any byte
  // has actually been fetched, could wrongly exclude a later, smaller
  // document from ever being attempted over an estimate that might not even
  // pan out (exactly the class of bug this hardening pass fixes one stage
  // later, at the fetch itself). The real, cumulative budget decision is
  // entirely pass 2's job, against confirmed, actually-fetched byte counts.
  const provisional: Array<Omit<DocRow, 'file_data'> & { attachName: string }> = [];
  const preSkippedIds = new Set<string>();
  for (const doc of meta) {
    const name = attachmentFileName(doc.display_name, doc.name, doc.file_type);
    if (doc.file_size && doc.file_size > maxTotalBytes) { preSkippedIds.add(doc.id); continue; }
    provisional.push({ ...doc, attachName: name });
  }

  const fileDataById = new Map<string, string | null>();
  if (provisional.length) {
    const { rows: dataRows } = await pool.query<{ id: string; file_data: string | null }>(
      `SELECT id, file_data FROM documents WHERE id = ANY($1::uuid[])`,
      [provisional.map(s => s.id)]
    );
    for (const r of dataRows) fileDataById.set(r.id, r.file_data);
  }

  // Pass 2 (confirmed): fetch each provisional survivor's bytes and decide
  // its real fate against a running total that only ever grows on a
  // successful fetch that actually fit — a failed fetch (or one that turns
  // out to overshoot once its real size is known) must never have already
  // consumed budget a later, successfully-fetched attachment could have used.
  const fetchedById = new Map<string, Buffer>();
  let confirmedTotal = 0;
  for (const doc of provisional) {
    let buf: Buffer | null = null;
    try { buf = await fetchDocBytes({ ...doc, file_data: fileDataById.get(doc.id) ?? null }); }
    catch (err) { logger.warn({ err, docId: doc.id }, '[bid-attach] could not fetch document'); }
    if (!buf) continue; // failed fetch — no charge, not attached
    if (confirmedTotal + buf.length > maxTotalBytes) continue; // doesn't actually fit — no charge
    confirmedTotal += buf.length;
    fetchedById.set(doc.id, buf);
  }

  // Assemble the result by walking the documents in their original
  // created_at order once, exactly like the pre-Task-9 single-pass version
  // did — restores the original skipped[] ordering (post-review hardening
  // 5d), rather than "every pre-skip, then every fetch-time skip".
  const attachments: GraphAttachment[] = [];
  const attachedNames: string[] = [];
  const attached: LinkedDocRef[] = [];
  const skipped: string[] = [];
  for (const doc of meta) {
    const name = attachmentFileName(doc.display_name, doc.name, doc.file_type);
    const buf = fetchedById.get(doc.id);
    if (preSkippedIds.has(doc.id) || !buf) { skipped.push(name); continue; }
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name,
      contentType: doc.file_type || 'application/octet-stream',
      contentBytes: buf.toString('base64'),
      isInline: false,
      contentId: `bidfile-${doc.id}`,
    });
    attachedNames.push(name);
    attached.push({ name, category: doc.category });
  }

  return { attachments, attachedNames, attached, skipped };
}

/** Back-compat wrapper — same as before for the bid "new bid → team" email. */
export function loadBidDocumentsAsAttachments(bidId: string, maxTotalBytes = DEFAULT_MAX_TOTAL): Promise<BidAttachmentsResult> {
  return loadLinkedDocumentsAsAttachments(bidId, { maxTotalBytes });
}
