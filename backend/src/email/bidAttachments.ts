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

interface DocRow {
  id: string;
  name: string | null;
  display_name: string | null;
  category: string | null;
  file_type: string | null;
  file_size: number | null;
  file_data: string | null;
  storage_url: string | null;
}

async function fetchDocBytes(doc: DocRow): Promise<Buffer | null> {
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
  const { rows } = await pool.query<DocRow>(
    `SELECT id, name, display_name, category, file_type, file_size, file_data, storage_url
       FROM documents
      WHERE linked_id = $1 AND deleted_at IS NULL${categoryClause}
      ORDER BY created_at ASC`,
    params
  );

  const attachments: GraphAttachment[] = [];
  const attachedNames: string[] = [];
  const attached: LinkedDocRef[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const doc of rows) {
    const name = (doc.display_name || doc.name || 'file').trim();
    // Skip clearly-oversized files up front when the size is recorded.
    if (doc.file_size && doc.file_size > maxTotalBytes) { skipped.push(name); continue; }

    let buf: Buffer | null = null;
    try { buf = await fetchDocBytes(doc); }
    catch (err) { logger.warn({ err, docId: doc.id }, '[bid-attach] could not fetch document'); }
    if (!buf) { skipped.push(name); continue; }

    if (total + buf.length > maxTotalBytes) { skipped.push(name); continue; }
    total += buf.length;

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
