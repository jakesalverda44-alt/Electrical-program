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

// A "due"-style cue that must precede the date for it to count. Deliberately requires
// a cue — bid invitations are full of other dates (the letter/"DATE:" send date, phone
// numbers like 865-691-6818, cost codes like 02500-003) that an uncued scan would
// wrongly grab. Better to leave the due date blank for the reviewer than to fill a wrong one.
const DUE_CUE = '(?:due(?:\\s*date)?|bid\\s*due\\s*date|bids?\\s*due|bid\\s*date|proposals?\\s*due|responses?\\s*due|submittals?\\s*due|submit\\s*by|respond\\s*by|due\\s*by|deadline)';

/**
 * Best-effort extraction of a bid due date from subject/body text. Only accepts a date that
 * follows a due cue (see DUE_CUE), e.g.:
 *   - "Bids Due 6/24/2026", "due 6/20", "bid date 06-20-26", "BID DUE DATE: 07/17/2026"
 *   - "Proposals due June 20, 2026", "submit by 7/15"
 * Returns YYYY-MM-DD or null. Intentionally conservative — the reviewer can always edit.
 */
export function parseDueDate(text: string, now = new Date()): string | null {
  const t = ` ${text.toLowerCase()} `;

  const finalize = (mo: number, day: number, yr: number | null): string | null => {
    if (!(mo >= 1 && mo <= 12 && day >= 1 && day <= 31)) return null;
    let year = yr ?? now.getFullYear();
    if (year < 100) year += 2000;
    // If no year given and the date already passed this year, assume next year.
    if (yr == null) {
      const candidate = new Date(year, mo - 1, day);
      if (candidate.getTime() < now.getTime() - 86400000) year += 1;
    }
    return `${year}-${pad(mo)}-${pad(day)}`;
  };

  // 1) Cued numeric M/D[/Y]: "... due 6/24/2026", "BID DUE DATE: 07/17/2026".
  //    The gap may contain words ("due date:"), but not digits, so it can't span past
  //    the cue into an unrelated number.
  const cuedNum = new RegExp(`${DUE_CUE}[^\\d]{0,25}(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?`).exec(t);
  if (cuedNum) {
    const r = finalize(Number(cuedNum[1]), Number(cuedNum[2]), cuedNum[3] ? Number(cuedNum[3]) : null);
    if (r) return r;
  }

  // 2) Cued month-name: "... due June 20, 2026". The gap excludes letters so it can't
  //    swallow the month word itself.
  const cuedNamed = new RegExp(`${DUE_CUE}[^a-z\\d]{0,15}([a-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`).exec(t);
  if (cuedNamed && MONTHS[cuedNamed[1]]) {
    const r = finalize(MONTHS[cuedNamed[1]], Number(cuedNamed[2]), cuedNamed[3] ? Number(cuedNamed[3]) : null);
    if (r) return r;
  }

  return null;
}

/**
 * Derive a clean project name from the subject by stripping common invitation prefixes
 * and trailing "due ..." fragments. Falls back to the raw subject. Handles the three
 * shapes we actually receive:
 *   - "Invitation to Bid - Firestone - (Prototype)"            (prefix + separator)
 *   - "Invitation to Bid from <GC> for <Project>"              (Kingdom-style)
 *   - "Reminder to submit your Bid for <Project>"              (Procore-style)
 */
export function parseProjectName(subject: string): string {
  let s = subject.trim();
  s = s.replace(/^\s*(re|fw|fwd)\s*:\s*/i, '');

  // "(Invitation|Invite|Request) to Bid from <GC> for <Project>" → keep the project only.
  const fromFor = /^\s*(?:invitation|invite|request)\s+to\s+bid\s+from\s+.+?\s+for\s+(.+)$/i.exec(s);
  if (fromFor) {
    s = fromFor[1];
  } else {
    // A bid-invitation / reminder prefix that runs into "... for <Project>".
    const forProj = /^\s*(?:reminder\s+to\s+(?:submit\s+(?:your\s+)?)?bid|invitation\s+to\s+bid|invite\s+to\s+bid|bid\s+invitation|itb|rfp|rfq|bid\s+request)\b.*?\bfor\s+(.+)$/i.exec(s);
    if (forProj) {
      s = forProj[1];
    } else {
      // Plain prefix followed by a separator: "Invitation to Bid - <Project>".
      s = s.replace(/^\s*(invitation to bid|invite to bid|bid invitation|itb|rfp|rfq|bid request|request for (proposal|quote))\s*[:\-–—|]\s*/i, '');
    }
  }

  // Drop a trailing "… - Bids Due 6/20" fragment and any dangling separator.
  s = s.replace(/\s*[-–—|(]?\s*(bids?\s*due|due\s*date|due|proposals?\s*due)\b.*$/i, '');
  s = s.replace(/\s*[-–—|]\s*$/, '').trim();
  return s || subject.trim();
}

/**
 * Derive the general contractor from the invitation. Prefers an explicit
 * "from <GC> for <Project>" in the subject (where the sender is often the individual
 * contact, not the company), otherwise falls back to the sender's display name, then
 * the sender address.
 */
export function parseGc(subject: string, fromName: string | null, fromEmail: string | null): string | null {
  const m = /\bfrom\s+(.+?)\s+for\s+/i.exec(subject);
  if (m && /\bbid\b/i.test(subject)) {
    const gc = m[1].trim();
    if (gc) return gc;
  }
  return (fromName && fromName.trim()) || (fromEmail && fromEmail.trim()) || null;
}

/**
 * Best-effort project location. Prefers a structured "PROJECT LOCATION:" / "address:"
 * field in the body (Kingdom-style); otherwise falls back to a trailing "City, ST"
 * (optionally + ZIP) in the subject, which is how Summit/Procore invitations carry the
 * site (e.g. "… - AutoZone - St. Johns, FL"). Returns null when nothing reliable is found
 * (e.g. Summit prototypes whose address is still TBD).
 */
export function parseLocation(subject: string, body: string): string | null {
  const field = /\b(?:project\s+location|project\s+address|job\s*site\s*address|jobsite|job\s*site|site\s+address|project\s+site|location|address)\s*[:\-]\s*([^\n]+)/i.exec(body || '');
  if (field) {
    let v = field[1].replace(/\s+/g, ' ').trim();
    // Cut at the next labelled field that commonly follows in these templates.
    v = v.split(/\b(?:bid\s+due\s+date|due\s+date|project\s+description|project\s+name|scope|to\s+access|click\s+here|\*\*)/i)[0].trim();
    // Collapse an immediately-repeated address ("8191 NW 43rdST 8191 NW 43rdST, 32653").
    v = v.replace(/^(.{4,}?)\s+\1\b/i, '$1').trim();
    v = v.replace(/[;,]\s*$/, '').trim();
    if (v && v.length <= 120 && /[,\d]/.test(v)) return v;
  }
  // Trailing "City, ST" / "City, ST 12345" in the subject.
  const cs = /([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)*),\s*([A-Z]{2})(?:\s+\d{5})?\s*$/.exec(subject.trim());
  if (cs) return `${cs[1]}, ${cs[2]}`;
  return null;
}

// Invisible spacer/zero-width characters that Mailchimp-style senders pad previews with
// (combining grapheme joiner, zero-width (non-)joiners, bidi marks, soft hyphen, BOM).
const INVISIBLE_CHARS = /[\u00AD\u034F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

function snippet(text: string, max = 400): string {
  const s = (text || '').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Contact for the invitation: prefer a sender display name that's an actual person
 * (i.e. different from the GC company we derived), otherwise fall back to the address
 * the email came from. So Kingdom → "Ian Nichols", Summit → "estimating@summitgc.net".
 */
export function parseContact(fromName: string | null, fromEmail: string | null, gc: string | null): string | null {
  const name = fromName?.trim();
  if (name && name !== (gc || '').trim()) return name;
  return (fromEmail && fromEmail.trim()) || name || null;
}

async function importOne(msg: GraphMailMessage): Promise<boolean> {
  const name = parseProjectName(msg.subject) || '(no subject)';
  const gc = parseGc(msg.subject, msg.fromName, msg.from);
  const loc = parseLocation(msg.subject, msg.body);
  const contact = parseContact(msg.fromName, msg.from, gc);
  const due = parseDueDate(`${msg.subject}\n${msg.body}`);
  // Prefer the full (HTML-stripped) body over bodyPreview, which on Mailchimp-style
  // senders is mostly invisible spacer padding. snippet() strips those either way.
  const body = snippet(msg.body?.trim() ? msg.body : msg.bodyPreview);

  // Dedupe on the Graph message id. For an item already imported, backfill a missing
  // location/contact while it's still pending — never overwrite a value the reviewer set
  // or any other field. This lets a Refresh fill these in on items imported earlier.
  const { rows: existing } = await pool.query(
    'SELECT id, status, loc, contact FROM intake_items WHERE graph_message_id=$1', [msg.id]
  );
  if (existing.length) {
    const ex = existing[0];
    if (ex.status === 'pending') {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if ((ex.loc == null || ex.loc === '') && loc) { vals.push(loc); sets.push(`loc=$${vals.length}`); }
      if ((ex.contact == null || ex.contact === '') && contact) { vals.push(contact); sets.push(`contact=$${vals.length}`); }
      if (sets.length) {
        vals.push(ex.id);
        await pool.query(`UPDATE intake_items SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
      }
    }
    return false;
  }

  const attachmentNames = msg.hasAttachments ? await listAttachmentNames(msg.id) : [];
  try {
    await pool.query(
      `INSERT INTO intake_items
         (name, gc, loc, contact, due, notes, source, status, body_snippet, graph_message_id,
          web_link, from_email, received_at, attachment_names, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,'email','pending',$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (graph_message_id) WHERE graph_message_id IS NOT NULL DO NOTHING`,
      [name, gc, loc, contact, due, body, body,
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
