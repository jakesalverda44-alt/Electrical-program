import { GraphMailMessage } from './outlookMail';
import { emailDomain, parseLocation, NON_GC_DOMAINS } from './intakeEmailIngest';
import { extractCandidates } from '../utils/customerMatch';

// Format-specific (deterministic, NO-AI) parsers for known bid-invitation email shapes,
// layered on top of the generic parser in intakeEmailIngest.ts. Procore is the only format
// today (Bay to Bay Properties is the highest-volume sender and always uses it) — more
// formats (BuildingConnected, PlanHub) can join this registry once real samples are on hand.

export interface ProcoreLinks {
  procore?: string;
  documents?: string;
}

export interface ProcoreParse {
  name: string | null;
  gc: string | null;
  contact: string | null;
  due: string | null;      // YYYY-MM-DD
  dueTime: string | null;  // e.g. "3:00 PM"
  loc: string | null;
  links: ProcoreLinks;
  summary: string | null;
}

/**
 * Which known format an inbound email matches, or null for "use the generic parser".
 * Procore/Bay to Bay: sender domain is procore.com/procoretech.com (a relay Procore hosts
 * on behalf of many GCs), or — belt and suspenders, in case the relay domain ever changes —
 * the body carries Procore's standard "View in Procore" call-to-action text.
 */
export function detectFormat(msg: Pick<GraphMailMessage, 'from' | 'body' | 'bodyHtml'>): 'procore' | null {
  const domain = emailDomain(msg.from);
  if (domain === 'procore.com' || domain === 'procoretech.com') return 'procore';
  if (/view in procore/i.test(msg.body || '') || /view in procore/i.test(msg.bodyHtml || '')) return 'procore';
  return null;
}

// --- name -------------------------------------------------------------------------------

// Procore appends its own invitation phrase as a SUFFIX ("<Project>: Invitation to bid on
// <Project>"), the opposite of every other format we've seen (which prefixes it). Cutting at
// the separator recovers the clean project name and, as a side effect, drops the duplicated
// half in one step.
const SUFFIX_CUT_RE = /[:\-–—]\s*(?:invitation|reminder)\s+to\s+(?:bid|submit)\b/i;

// Fallback for subjects that don't carry the cut phrase: the body's "invited you to bid on
// project <Project> (" sentence.
const BODY_NAME_RE = /invited you to bid on (?:project )?(.+?)\s*\(/i;

// Defensive backstop: some Procore subjects duplicate the whole project name with nothing
// but whitespace between the two copies ("<Project> <Project>"). Collapse to one copy.
function collapseDuplicate(s: string): string {
  const m = /^(.{3,}?)\s*\1\s*$/.exec(s.trim());
  return (m ? m[1] : s).trim();
}

export function parseProcoreName(subject: string, body: string): string | null {
  const s = (subject || '').trim();
  const cut = SUFFIX_CUT_RE.exec(s);
  let name: string | null = null;
  if (cut) {
    name = s.slice(0, cut.index).trim();
  } else {
    const m = BODY_NAME_RE.exec(body || '');
    if (m) name = m[1].trim();
  }
  if (!name) return null;
  return collapseDuplicate(name) || null;
}

// --- gc -----------------------------------------------------------------------------------

function unwrapGc(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const [candidate] = extractCandidates(raw.trim());
  return candidate?.trim() || null;
}

const BODY_GC_RE = /\bfrom\s+(.+?)\s+has invited you\b/i;

/**
 * The GC company. The sender display name ("Estimating Department (Bay to Bay Properties,
 * LLC)") is preferred when it's junk-wrapped — unwrapping it recovers the fuller legal name
 * (often with the Inc/LLC suffix) that the body's plain "from <Company> has invited you"
 * mention usually omits. Falls back to the body mention, then the raw sender name.
 */
export function parseProcoreGc(body: string, fromName: string | null): string | null {
  if (fromName && /\(/.test(fromName)) {
    const c = unwrapGc(fromName);
    if (c) return c;
  }
  const m = BODY_GC_RE.exec(body || '');
  if (m) {
    const c = unwrapGc(m[1].trim());
    if (c) return c;
  }
  return unwrapGc(fromName);
}

// --- contact --------------------------------------------------------------------------------

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Our own domain — Procore invitations routinely end with "Bid Submission via email to
// <our estimating address>", which is the RECIPIENT, not the GC's contact. Without this
// exclusion the body scan below would fill the contact field with our own email.
const OWN_DOMAINS = new Set(['accuratepowerandtechnology.com']);

/**
 * The relay address a Procore notification comes from is never a usable contact (null is the
 * correct default). On the rare invitation that names an actual person's email in the body —
 * on a real company domain, not another relay/free-mail domain and not our own — use that.
 */
export function parseProcoreContact(body: string): string | null {
  const matches = (body || '').match(EMAIL_RE) || [];
  for (const e of matches) {
    const domain = emailDomain(e);
    if (domain && !NON_GC_DOMAINS.has(domain) && !OWN_DOMAINS.has(domain)) return e;
  }
  return null;
}

// --- due + dueTime ----------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_DISPLAY: Record<string, string> = {
  jan: 'January', january: 'January', feb: 'February', february: 'February',
  mar: 'March', march: 'March', apr: 'April', april: 'April', may: 'May',
  jun: 'June', june: 'June', jul: 'July', july: 'July', aug: 'August', august: 'August',
  sep: 'September', sept: 'September', september: 'September', oct: 'October', october: 'October',
  nov: 'November', november: 'November', dec: 'December', december: 'December',
};
const MONTH_ALT = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?'
  + '|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function pad(n: number): string { return String(n).padStart(2, '0'); }

const PROCORE_DUE_RE = new RegExp(
  'bid due:\\s*(?:(\\w+day),\\s*)?'          // 1: weekday (optional)
  + `(${MONTH_ALT})\\.?\\s+`                  // 2: month name
  + '(\\d{1,2})(?:st|nd|rd|th)?,?\\s*'        // 3: day
  + '(\\d{4})'                                // 4: year
  + '(?:\\s+at\\s+(\\d{1,2}:\\d{2}\\s*[ap]m))?', // 5: time
  'i'
);

/** Normalize a raw "03:00 pm" clock reading to "3:00 PM". */
function formatDueTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(raw.trim());
  if (!m) return null;
  return `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}`;
}

interface ProcoreDue { due: string | null; dueTime: string | null; phrase: string | null }

/** Parses the "Bid Due: <weekday,> <Month> <day>, <year> [at <time>]" field. */
export function parseProcoreDue(text: string): ProcoreDue {
  const m = PROCORE_DUE_RE.exec(text || '');
  if (!m) return { due: null, dueTime: null, phrase: null };
  const [, weekday, monthRaw, dayRaw, yearRaw, timeRaw] = m;
  const monthKey = monthRaw.toLowerCase();
  const mo = MONTHS[monthKey];
  if (!mo) return { due: null, dueTime: null, phrase: null };
  const due = `${yearRaw}-${pad(mo)}-${pad(Number(dayRaw))}`;
  const dueTime = formatDueTime(timeRaw);
  const monthDisplay = MONTH_DISPLAY[monthKey] || monthRaw;
  const phrase = `${weekday ? `${weekday}, ` : ''}${monthDisplay} ${Number(dayRaw)}, ${yearRaw}`
    + (dueTime ? ` at ${dueTime}` : '');
  return { due, dueTime, phrase };
}

// --- links --------------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

interface Anchor { href: string; text: string }

// Tolerates nested tags inside the anchor (e.g. <a href="..."><span>View in Procore</span></a>)
// by stripping any inner tags from the captured text before matching the label.
const ANCHOR_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function findAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  let m: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html))) {
    const href = decodeEntities(m[1]);
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    anchors.push({ href, text });
  }
  return anchors;
}

/** Pulls the "View in Procore" and "Download Documents" links out of the HTML body. */
export function extractProcoreLinks(html: string | null): ProcoreLinks {
  const links: ProcoreLinks = {};
  if (!html) return links;
  for (const a of findAnchors(html)) {
    if (!/^https?:\/\//i.test(a.href)) continue;
    if (!links.procore && /view in procore/i.test(a.text)) links.procore = a.href;
    if (!links.documents && /download documents/i.test(a.text)) links.documents = a.href;
  }
  return links;
}

// --- summary --------------------------------------------------------------------------------

/**
 * One clean line for the Notes prefill. GraphMailMessage only carries a hasAttachments
 * boolean (the real count needs an extra Graph call, done later by importOne) — so unlike a
 * hand-read sample email, this reports attachment PRESENCE, not a count.
 */
export function buildProcoreSummary(duePhrase: string | null, links: ProcoreLinks, hasAttachments: boolean): string {
  let s = 'Procore invitation';
  s += duePhrase ? ` — bid due ${duePhrase}.` : '.';
  s += ` Documents: ${links.documents ? 'link present' : 'no link found'}.`;
  if (hasAttachments) s += ' Has attachments.';
  return s;
}

// --- parseProcore ---------------------------------------------------------------------------

export function parseProcore(msg: GraphMailMessage): ProcoreParse {
  const bodyText = msg.body || '';
  const name = parseProcoreName(msg.subject || '', bodyText);
  const gc = parseProcoreGc(bodyText, msg.fromName);
  const { due, dueTime, phrase } = parseProcoreDue(bodyText);
  const loc = parseLocation(name || msg.subject || '', '');
  const links = extractProcoreLinks(msg.bodyHtml);
  const contact = parseProcoreContact(bodyText);
  const summary = buildProcoreSummary(phrase, links, msg.hasAttachments);
  return { name, gc, contact, due, dueTime, loc, links, summary };
}
