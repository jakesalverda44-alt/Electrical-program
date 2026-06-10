import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { fetchTaggedBidEmails, listAttachmentNames, GraphMailMessage } from './outlookMail';

// Light, NO-AI parsing + ingest of "new bid"-tagged Outlook emails into the Intake Inbox.
// Every imported item is fully editable in the review UI before it becomes a bid.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string { return String(n).padStart(2, '0'); }

/**
 * Best-effort extraction of a bid due date from subject/body text. Recognises:
 *   - "due 6/20/2026", "due 6/20" (year inferred), "bid date 06-20-26"
 *   - "due June 20, 2026", "June 20"
 * Returns YYYY-MM-DD or null. Intentionally conservative — the reviewer can always edit.
 */
export function parseDueDate(text: string, now = new Date()): string | null {
  const t = ` ${text.toLowerCase()} `;

  // Numeric M/D[/Y] — prefer one that follows a "due"/"bid"/"date" cue, else first match.
  const numeric = /(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/g;
  const cueWindow = /(due|bid\s*date|bids?\s*due|proposals?\s*due)[^\d]{0,20}(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/;
  const cue = cueWindow.exec(t);
  let mo: number | null = null, day: number | null = null, yr: number | null = null;
  if (cue) {
    mo = Number(cue[2]); day = Number(cue[3]); yr = cue[4] ? Number(cue[4]) : null;
  } else {
    const m = numeric.exec(t);
    if (m) { mo = Number(m[1]); day = Number(m[2]); yr = m[3] ? Number(m[3]) : null; }
  }
  if (mo && day && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
    let year = yr ?? now.getFullYear();
    if (year < 100) year += 2000;
    // If no year given and the date already passed this year, assume next year.
    if (!yr) {
      const candidate = new Date(year, mo - 1, day);
      if (candidate.getTime() < now.getTime() - 86400000) year += 1;
    }
    return `${year}-${pad(mo)}-${pad(day)}`;
  }

  // Month-name form: "june 20, 2026" / "june 20"
  const named = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/.exec(t);
  if (named && MONTHS[named[1]]) {
    const mon = MONTHS[named[1]];
    const d = Number(named[2]);
    let year = named[3] ? Number(named[3]) : now.getFullYear();
    if (d >= 1 && d <= 31) {
      if (!named[3]) {
        const candidate = new Date(year, mon - 1, d);
        if (candidate.getTime() < now.getTime() - 86400000) year += 1;
      }
      return `${year}-${pad(mon)}-${pad(d)}`;
    }
  }
  return null;
}

/**
 * Derive a clean project name from the subject by stripping common invitation prefixes
 * and trailing "due ..." fragments. Falls back to the raw subject.
 */
export function parseProjectName(subject: string): string {
  let s = subject.trim();
  s = s.replace(/^\s*(re|fw|fwd)\s*:\s*/i, '');
  s = s.replace(/^\s*(invitation to bid|invite to bid|bid invitation|itb|rfp|rfq|bid request|request for (proposal|quote))\s*[:\-–—|]\s*/i, '');
  s = s.replace(/\s*[-–—|]\s*(bids?\s*due|due|proposals?\s*due)\b.*$/i, '');
  return s.trim() || subject.trim();
}

function snippet(text: string, max = 400): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function importOne(msg: GraphMailMessage): Promise<boolean> {
  // Dedupe: skip anything already imported (unique index also enforces this).
  const { rows: existing } = await pool.query(
    'SELECT 1 FROM intake_items WHERE graph_message_id=$1', [msg.id]
  );
  if (existing.length) return false;

  const attachmentNames = msg.hasAttachments ? await listAttachmentNames(msg.id) : [];
  const name = parseProjectName(msg.subject) || '(no subject)';
  const due = parseDueDate(`${msg.subject}\n${msg.body}`);

  try {
    await pool.query(
      `INSERT INTO intake_items
         (name, gc, due, notes, source, status, body_snippet, graph_message_id,
          web_link, from_email, received_at, attachment_names, created_by_name)
       VALUES ($1,$2,$3,$4,'email','pending',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (graph_message_id) WHERE graph_message_id IS NOT NULL DO NOTHING`,
      [name, msg.fromName || msg.from || null, due, snippet(msg.bodyPreview), snippet(msg.bodyPreview),
       msg.id, msg.webLink, msg.from, msg.receivedDateTime, attachmentNames.length ? attachmentNames : null,
       'Outlook (new bid)']
    );
    return true;
  } catch (err) {
    logger.error({ err, messageId: msg.id }, '[intake-ingest] insert failed');
    return false;
  }
}

/**
 * Pull all "new bid"-tagged Inbox emails and create Intake Inbox items for any that haven't
 * been imported yet. Idempotent (deduped on the Graph message id). Returns the number of new
 * items created.
 */
export async function ingestTaggedBidEmails(): Promise<number> {
  const messages = await fetchTaggedBidEmails();
  let imported = 0;
  for (const msg of messages) {
    if (await importOne(msg)) imported++;
  }
  if (imported) logger.info({ imported }, '[intake-ingest] imported new bid emails');
  return imported;
}
