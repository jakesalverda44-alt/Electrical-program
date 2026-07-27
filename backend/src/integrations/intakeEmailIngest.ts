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
const DUE_CUE = 'due(?:\\s*date)?|bid\\s*due\\s*date|bids?\\s*(?:are\\s*)?due|bid\\s*date|bid\\s*deadline'
  + '|proposals?\\s*due|quotes?\\s*due|pricing\\s*due|estimates?\\s*due|responses?\\s*due'
  + '|submittals?\\s*due|submit\\s*by|respond\\s*by|due\\s*by|deadline|must\\s*be\\s*received'
  + '|received\\s*by|bids?\\s*(?:must\\s*be\\s*)?submitted|bid\\s*closing|closing\\s*date'
  + '|turn(?:ed)?\\s*in\\s*by';

// Month-name alternation (accepts common abbreviations). Used by the month-name date forms.
const MONTH_ALT = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?'
  + '|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/**
 * Best-effort extraction of a bid due date from subject/body text. Only accepts a date that
 * appears shortly AFTER a due cue (see DUE_CUE), e.g.:
 *   - "Bids Due 6/24/2026", "due 6/20", "bid date 06-20-26", "BID DUE DATE: 07/17/2026"
 *   - "Bids due by 2:00 PM on 6/20/2026"       (time-of-day between the cue and the date)
 *   - "Proposals due June 20, 2026", "due Thursday, June 20, 2026", "submit by 7/15"
 *   - "Bids due 20 June 2026"                   (day-first)
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

  // Collect the end offset of every due cue; we then look for a date in a short window
  // after each. A window (rather than requiring the date to butt against the cue) lets a
  // time-of-day or weekday sit in between — "due by 2:00 PM on 6/20", "due Thursday, June 20".
  const cueRe = new RegExp(`\\b(?:${DUE_CUE})`, 'g');
  const cueEnds: number[] = [];
  for (let m = cueRe.exec(t); m; m = cueRe.exec(t)) cueEnds.push(m.index + m[0].length);
  if (!cueEnds.length) return null;

  const WINDOW = 40;
  // Numeric M/D[/Y] with / . or - separators. .exec() scans past an intervening time-of-day
  // ("2:00 PM") because a clock time uses ":" — never a date separator.
  const numRe = /(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?/;

  // PHASE 1 — a cued NUMERIC date wins over a cued month-name date, so a letter/"DATE:"
  // send date can never beat the real "BID DUE DATE: 07/17" that appears further along.
  for (const end of cueEnds) {
    const m = numRe.exec(t.slice(end, end + WINDOW));
    if (m) {
      const r = finalize(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
      if (r) return r;
    }
  }

  // PHASE 2 — month-name dates: "June 20, 2026" and day-first "20 June 2026". Whichever
  // form appears first in the window is the real date (day-first must be tried so
  // "15 June 2026" isn't misread as June 20, taking the day from the year).
  const namedRe    = new RegExp(`(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`);
  const dayFirstRe = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?(?:,?\\s*(\\d{4}))?`);
  for (const end of cueEnds) {
    const win = t.slice(end, end + WINDOW);
    const named = namedRe.exec(win);
    const dayFirst = dayFirstRe.exec(win);
    const useDayFirst = dayFirst && (!named || dayFirst.index < named.index);
    if (useDayFirst && dayFirst && MONTHS[dayFirst[2]] != null) {
      const r = finalize(MONTHS[dayFirst[2]], Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : null);
      if (r) return r;
    }
    if (named && MONTHS[named[1]] != null) {
      const r = finalize(MONTHS[named[1]], Number(named[2]), named[3] ? Number(named[3]) : null);
      if (r) return r;
    }
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

// Free-mail and bid-platform domains that identify a *person* or a *relay service* — never
// a specific general contractor. We must not treat two invitations sharing one of these
// domains as coming from the same GC.
const NON_GC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net',
  'att.net', 'verizon.net', 'sbcglobal.net', 'bellsouth.net', 'proton.me', 'protonmail.com',
  // Bid-invitation platforms that relay on behalf of many GCs
  'procore.com', 'procoretech.com', 'buildingconnected.com', 'autodesk.com', 'isqft.com',
  'constructconnect.com', 'planhub.com', 'smartbidnet.com', 'bidclerk.com', 'pipelinesuite.com',
  'sharefile.com', 'dropbox.com', 'wetransfer.com',
]);

export function emailDomain(email: string | null): string | null {
  const m = /@([A-Za-z0-9.-]+)/.exec(email || '');
  return m ? m[1].toLowerCase().replace(/[.,;]+$/, '') : null;
}

/**
 * Keep the GC name stable across invitations from the same company. Invitation subjects and
 * sender display names vary ("Kingdom Construction" one week, "Ian Nichols" the next), which
 * would otherwise scatter one GC across several names/customer records. If we've already
 * recorded a GC for this sender's (company) domain, reuse that exact name. Free-mail and
 * bid-platform domains are excluded (see NON_GC_DOMAINS) — they don't identify a GC.
 */
export async function canonicalGc(parsedGc: string | null, fromEmail: string | null): Promise<string | null> {
  const domain = emailDomain(fromEmail);
  if (!domain || NON_GC_DOMAINS.has(domain)) return parsedGc;
  const { rows } = await pool.query(
    `SELECT gc FROM intake_items
      WHERE gc IS NOT NULL AND btrim(gc) <> '' AND from_email ILIKE $1
      GROUP BY gc
      ORDER BY count(*) DESC, max(created_at) DESC
      LIMIT 1`,
    [`%@${domain}`]
  );
  return rows[0]?.gc || parsedGc;
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

// Tight normalization (alphanumerics only) — used to compare GC company names.
function normTight(s: string | null): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Loose normalization (words separated by single spaces) — used to compare project names,
// where a reminder often appends "- City, ST" or a store number to the original title.
function normLoose(s: string | null): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * True when two invitations are for the same opportunity — same general contractor AND the
 * same project (exact title, or one title is contained in the other, e.g. a reminder that
 * appends the city). Requires a non-empty GC and a reasonably long shared title so short,
 * generic names ("Clinic") never collapse two distinct projects. Same project bid by two
 * different GCs are correctly treated as separate (the GC differs).
 */
export function isSameProject(
  a: { name: string | null; gc: string | null },
  b: { name: string | null; gc: string | null },
): boolean {
  const ga = normTight(a.gc);
  if (!ga || ga !== normTight(b.gc)) return false;
  const na = normLoose(a.name), nb = normLoose(b.name);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 12 && long.includes(short);
}

// Fill in only the fields still blank on a pending intake item — never overwrite a value the
// reviewer may have set. Shared by the same-email and reminder/duplicate paths.
async function backfillPending(
  row: { id: string; loc: string | null; contact: string | null; due: string | null },
  loc: string | null, contact: string | null, due: string | null,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ((row.loc == null || row.loc === '') && loc) { vals.push(loc); sets.push(`loc=$${vals.length}`); }
  if ((row.contact == null || row.contact === '') && contact) { vals.push(contact); sets.push(`contact=$${vals.length}`); }
  if ((row.due == null || row.due === '') && due) { vals.push(due); sets.push(`due=$${vals.length}`); }
  if (sets.length) {
    vals.push(row.id);
    await pool.query(`UPDATE intake_items SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
  }
}

async function importOne(msg: GraphMailMessage): Promise<boolean> {
  const name = parseProjectName(msg.subject) || '(no subject)';
  // Keep one GC company mapped to one name — reuse the name already on file for this
  // sender's domain when we have one, so the same GC doesn't land under several spellings.
  const gc = await canonicalGc(parseGc(msg.subject, msg.fromName, msg.from), msg.from);
  const loc = parseLocation(msg.subject, msg.body);
  const contact = parseContact(msg.fromName, msg.from, gc);
  const due = parseDueDate(`${msg.subject}\n${msg.body}`);
  // Prefer the full (HTML-stripped) body over bodyPreview, which on Mailchimp-style
  // senders is mostly invisible spacer padding. snippet() strips those either way.
  const body = snippet(msg.body?.trim() ? msg.body : msg.bodyPreview);

  // Dedupe on the Graph message id. For an item already imported, backfill a missing
  // location/contact/due while it's still pending — never overwrite a value the reviewer set
  // or any other field. This lets a Refresh fill these in on items imported earlier (e.g.
  // ones whose due date the older parser couldn't read).
  const { rows: existing } = await pool.query(
    'SELECT id, status, loc, contact, due FROM intake_items WHERE graph_message_id=$1', [msg.id]
  );
  if (existing.length) {
    const ex = existing[0];
    if (ex.status === 'pending') await backfillPending(ex, loc, contact, due);
    return false;
  }

  // Reminder / duplicate suppression: a follow-up invite or platform reminder (Procore,
  // BuildingConnected, …) for a project we already have arrives as a SEPARATE email with its
  // own message id. Rather than spawn a second intake item, fold it into the one we already
  // have — backfill any blanks if that item is still pending — and skip creating a new row.
  if (normTight(gc)) {
    const { rows: sameGc } = await pool.query(
      `SELECT id, name, gc, status, loc, contact, due
         FROM intake_items
        WHERE created_at > now() - interval '60 days'
          AND gc IS NOT NULL
          AND lower(regexp_replace(gc, '[^a-zA-Z0-9]', '', 'g')) = $1`,
      [normTight(gc)]
    );
    const dup = sameGc.find(r => isSameProject({ name, gc }, { name: r.name, gc: r.gc }));
    if (dup) {
      if (dup.status === 'pending') await backfillPending(dup, loc, contact, due);
      logger.info({ messageId: msg.id, existingId: dup.id, status: dup.status }, '[intake-ingest] suppressed duplicate/reminder');
      return false;
    }
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
