// Next round A2 — the reference finder. Pure (no I/O, no AI): the regex
// half, the resolver and the "always useful" rule. The two AI halves (Haiku
// on notes text the regex can't resolve, Sonnet vision on a scanned sheet's
// notes region) live in services/sheetCheck.ts and hand their findings back
// through the same SheetRef shape.
//
// Why: on AutoZone #10077 Kissimmee the site fixtures W1/W2/S1/S2 came back 0
// because the photometric sheet PH0.1 was never sent — the classifier called
// it 'civil' and page selection dropped it, although E-7's notes say "SEE
// PHOTOMETRIC PLAN". Any sheet an electrical sheet points at, that is in the
// upload, now goes to the analysis as a reference page; a referenced sheet
// that is NOT in the upload is listed as missing (Upload / Skip with reason).

/** One page of the sheet inventory, as far as references care. */
export interface RefInventoryPage {
  /** `${file}#${page}` — stable within one sheet check. */
  key: string;
  file: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
}

export type DisciplineRefKey =
  | 'mechanical' | 'plumbing' | 'civil' | 'architectural' | 'structural' | 'fire_protection'
  | 'photometric' | 'reflected_ceiling' | 'life_safety' | 'equipment_schedule' | 'kitchen' | 'landscape';

export const DISCIPLINE_REF_LABELS: Record<DisciplineRefKey, string> = {
  mechanical: 'Mechanical drawings',
  plumbing: 'Plumbing drawings',
  civil: 'Civil / site drawings',
  architectural: 'Architectural drawings',
  structural: 'Structural drawings',
  fire_protection: 'Fire protection drawings',
  photometric: 'Photometric / site lighting plan',
  reflected_ceiling: 'Reflected ceiling plan',
  life_safety: 'Life safety plan',
  equipment_schedule: 'Mechanical / plumbing equipment schedules',
  kitchen: 'Kitchen / food service equipment drawings',
  landscape: 'Landscape drawings',
};

/** What a proposal clarification says when the estimator skips it. */
export const DISCIPLINE_NOT_PROVIDED: Record<DisciplineRefKey, string> = {
  mechanical: 'Mechanical drawings not provided at time of bid',
  plumbing: 'Plumbing drawings not provided at time of bid',
  civil: 'Civil / site drawings not provided at time of bid',
  architectural: 'Architectural drawings not provided at time of bid',
  structural: 'Structural drawings not provided at time of bid',
  fire_protection: 'Fire protection drawings not provided at time of bid',
  photometric: 'Photometric / site lighting plan not provided at time of bid',
  reflected_ceiling: 'Reflected ceiling plan not provided at time of bid',
  life_safety: 'Life safety plan not provided at time of bid',
  equipment_schedule: 'Mechanical schedules not provided at time of bid',
  kitchen: 'Kitchen equipment drawings not provided at time of bid',
  landscape: 'Landscape drawings not provided at time of bid',
};

export interface SheetRef {
  kind: 'sheet' | 'discipline';
  /** Normalized: a sheet id key ("PH0.1", "M1") or a DisciplineRefKey. */
  key: string;
  /** As written ("PH-0.1", "photometric plan"). */
  label: string;
  /** The referencing text, trimmed to a short snippet. */
  context: string;
  /** Where it was found: the referencing page's key / label. */
  fromKey: string;
  fromLabel: string;
  /** "note 3" when the snippet sits under a numbered note. */
  note?: string;
  source: 'regex' | 'haiku' | 'vision';
}

export type RefStatus = 'present' | 'missing' | 'ambiguous';

export interface ResolvedRef {
  /** `sheet:PH0.1` / `discipline:mechanical` — stable across checks (skips key on it). */
  id: string;
  kind: SheetRef['kind'];
  key: string;
  label: string;
  status: RefStatus;
  /** Inventory pages it resolves to (present / ambiguous). */
  pages: string[];
  /** Every place it was referenced from. */
  referencedBy: Array<{ fromKey: string; fromLabel: string; note?: string; context: string; source: SheetRef['source'] }>;
  /** Clarification text used when the estimator skips a missing reference. */
  notProvidedText: string;
}

// ── Sheet ids ───────────────────────────────────────────────────────────────

/** Sheet-number prefixes real US sets use. A prefix outside this list is
 *  only accepted when the inventory itself has sheets with it — that keeps
 *  "PER NEC 210.8", "NFPA 72" and "UL 924" from reading as sheet references. */
export const KNOWN_SHEET_PREFIXES = new Set([
  'A', 'AD', 'AE', 'AS', 'C', 'CS', 'D', 'E', 'ED', 'EL', 'EP', 'ES', 'EX', 'F', 'FA', 'FP', 'G', 'GI', 'H',
  'I', 'ID', 'IT', 'L', 'LS', 'LV', 'M', 'MD', 'MP', 'P', 'PD', 'PH', 'PL', 'Q', 'R', 'S', 'SL', 'SP', 'T',
  'TC', 'TY', 'V', 'X',
]);

/** Never sheet prefixes, even when followed by a number. */
const NOT_SHEET_PREFIXES = new Set(['NEC', 'NFPA', 'UL', 'ASTM', 'IEEE', 'ANSI', 'NEMA', 'OSHA', 'FBC', 'IBC',
  'CFR', 'AWG', 'KCMIL', 'MCM', 'KV', 'KVA', 'VA', 'AMP', 'HP', 'KW', 'CKT', 'MDP', 'RTU', 'EF', 'WH', 'AHU',
  'CU', 'DS', 'LP', 'HP', 'NO', 'PG', 'ART', 'SEC', 'TYP', 'EA', 'QTY', 'FT', 'IN', 'MM']);

/** "E-7", "E7", "PH0.1", "PH-0.1", "E-001", "e 3.1", "E-1001", "E2.01" ->
 *  normalized key ("E7", "PH0.1", "E1", "E3.1", "E1001", "E2.1"), or null
 *  when it isn't a sheet id. N4 — up to 4 digits; leading zeros of the
 *  decimal part dropped so "E2.01" and "E-2.1" are one sheet. */
export function normalizeSheetId(raw: string): string | null {
  const m = /^\s*([A-Za-z]{1,3})\s*[-.\s]?\s*(\d{1,4}(?:\.\d{1,2})?)([A-Za-z])?\s*$/.exec(raw);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const num = m[2].split('.').map(part => String(Number(part))).join('.');
  return `${prefix}${num}${(m[3] ?? '').toUpperCase()}`;
}

/** Fix round B1 — the shape of THIS set's sheet numbers, learned from the
 *  inventory ("E-1", "E-0.1", "PH0.1" -> separators "-" and "", up to 1
 *  main digit, decimals used). A referenced id that is NOT in the upload is
 *  reported missing only when it has that shape. */
export interface SheetPattern {
  prefixes: Set<string>;
  seps: Set<string>;
  maxDigits: number;
  decimals: boolean;
  /** No parsable sheet numbers: fall back to the known-prefix list only. */
  empty: boolean;
}

interface IdParts { prefix: string; sep: string; digits: string; decimal: string; suffix: string }

function parseIdParts(raw: string): IdParts | null {
  const m = /^\s*([A-Za-z]{1,3})([-.\s]?)(\d{1,4})(\.\d{1,2})?([A-Za-z])?\s*$/.exec(raw);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), sep: m[2] === ' ' ? ' ' : m[2], digits: m[3], decimal: m[4] ?? '', suffix: m[5] ?? '' };
}

export function learnSheetPattern(sheetNos: string[]): SheetPattern {
  const pat: SheetPattern = { prefixes: new Set(), seps: new Set(), maxDigits: 0, decimals: false, empty: true };
  for (const no of sheetNos) {
    const p = parseIdParts(no);
    if (!p) continue;
    pat.empty = false;
    pat.prefixes.add(p.prefix);
    pat.seps.add(p.sep);
    pat.maxDigits = Math.max(pat.maxDigits, p.digits.replace(/^0+(?=\d)/, '').length);
    if (p.decimal) pat.decimals = true;
  }
  return pat;
}

/** Does a (missing) id look like one of this set's sheet numbers? */
export function matchesSheetPattern(raw: string, pat: SheetPattern | null | undefined): boolean {
  const p = parseIdParts(raw);
  if (!p || NOT_SHEET_PREFIXES.has(p.prefix)) return false;
  if (!KNOWN_SHEET_PREFIXES.has(p.prefix) && !(pat?.prefixes.has(p.prefix))) return false;
  if (!pat || pat.empty) return p.sep !== ' ';
  if (!pat.seps.has(p.sep)) return false;
  if (p.digits.replace(/^0+(?=\d)/, '').length > pat.maxDigits + 1) return false;
  if (p.decimal && !pat.decimals) return false;
  return true;
}

function prefixOf(key: string): string {
  return /^[A-Z]+/.exec(key)?.[0] ?? '';
}

// ── Regex reference extraction ──────────────────────────────────────────────

/** Fix round B1 — an explicit pointer only. Bare ON / IN are NOT context
 *  words ("6 RECEPTACLES ON A 20 AMP CIRCUIT" is not sheet A20); "ON SHEET"
 *  / "ON DWG" are. */
const ANCHOR_RE = /\b(?:SEE|REFER(?:\s+TO)?|REFERENCE|PER|COORDINATE\s+WITH|(?:AS\s+)?SHOWN\s+ON|(?:ON|IN)\s+(?=SHEETS?\b|DWGS?\b|DRAWINGS?\b)|SHEETS?|DWGS?\.?|DRAWINGS?|DETAILS?)\b/g;
/** Words that may sit between the pointer and the id. A SHEET/DWG word also
 *  allows a spaced id ("SHEET E 3"). */
const FILLER_RE = /^(?:[\s:#,]|THE\b|SHEETS?\b|DWGS?\.?|DRAWINGS?\b|DETAILS?\b|PLANS?\b|(?:\d{1,2}|[A-Z])\s*(?:\/|ON\s+SHEET\b|ON\s+DWG\b))+/;
/** An id followed by one of these is an amperage, circuit, fixture/pole
 *  tag, level, conduit size… never a sheet. */
const REJECT_AFTER = /^(?:["”'’]|\s*(?:AMPS?|A|V|VOLTS?|VA|KVA|KW|HP|W|WATTS?|FIXTURES?|POLES?|CIRCUITS?|CKTS?|TYPES?|LEVELS?|REQUIREMENTS?|SIDES?|CONDUITS?|CABLES?|WIRES?|BOX(?:ES)?|RECEPTACLES?|OUTLETS?|HEADS?|LAMPS?)\b)/;
/** A filler word that means the id is a type / circuit / panel tag. */
const REJECT_FILLER = /\b(?:TYPE|FIXTURE|CKT|CIRCUIT|PANEL|POLE)\b/;
const ID_RE = /^([A-Z]{1,3})(\s?[-.]?)(\d{1,4}(?:\.\d{1,2})?)([A-Z])?(?![A-Z0-9])/;
const JOIN_RE = /^\s*(,|AND\b|&|THRU\b|THROUGH\b|TO\b)\s*/;

export interface RefExtractOptions {
  /** Extra accepted prefixes (the inventory's own). */
  knownPrefixes?: Set<string>;
  /** This set's sheet-number shape; ids not in `inventoryKeys` must match it. */
  pattern?: SheetPattern;
  /** Normalized sheet ids actually in the upload. */
  inventoryKeys?: Set<string>;
}

/** Fix round B1 — the ids after one pointer: "SEE E-2 AND E-3",
 *  "REFER TO SHEET C-3.1", "DETAIL 3/E-5", "E-1 THRU E-4" (N2: a range is
 *  expanded, at most 20). Returns the raw ids. */
function idsAfterPointer(text: string): string[] {
  const out: string[] = [];
  const fm = FILLER_RE.exec(text);
  const filler = fm ? fm[0] : '';
  if (REJECT_FILLER.test(filler)) return out;
  const allowSpace = /\b(SHEETS?|DWGS?)\b/.test(filler);
  let rest = text.slice(filler.length);
  let prev: { prefix: string; n: number; int: boolean } | null = null;
  let rangeNext = false;
  for (let guard = 0; guard < 12; guard++) {
    const m = ID_RE.exec(rest);
    if (!m) break;
    const sep = m[2];
    if (/\s/.test(sep) && !allowSpace) break;
    const after = rest.slice(m[0].length);
    if (REJECT_AFTER.test(after)) break;
    const raw = `${m[1]}${sep.trim()}${m[3]}${m[4] ?? ''}`;
    const int = !m[3].includes('.') && !m[4];
    const n = Number(m[3]);
    if (rangeNext && prev && prev.prefix === m[1] && prev.int && int && n > prev.n && n - prev.n <= 20) {
      const sepRaw = sep.trim();
      for (let k = prev.n + 1; k < n; k++) out.push(`${m[1]}${sepRaw}${k}`);
    }
    out.push(raw);
    prev = { prefix: m[1], n, int };
    rest = after;
    const j = JOIN_RE.exec(rest);
    if (!j) break;
    rangeNext = /THRU|THROUGH|TO/.test(j[1]);
    rest = rest.slice(j[0].length).replace(/^(?:SHEETS?\s+|DWGS?\.?\s+)/, '');
  }
  return out;
}

/** Discipline-only references and what makes them one. `needsContext`: the
 *  phrase only counts after SEE / REFER / PER / COORDINATE WITH (so "wired by
 *  mechanical contractor" is not a reference to the mechanical drawings). */
const DISCIPLINE_PATTERNS: Array<{ key: DisciplineRefKey; re: RegExp; needsContext: boolean }> = [
  { key: 'equipment_schedule', re: /\b(?:MECHANICAL|PLUMBING|HVAC|MECH\.?|EQUIPMENT)\s+(?:EQUIPMENT\s+)?SCHEDULES?\b/, needsContext: true },
  { key: 'photometric', re: /\bPHOTOMETRICS?(?:\s+(?:SITE\s+)?(?:PLAN|LAYOUT|CALC(?:ULATION)?S?|DRAWINGS?))?\b|\bSITE\s+LIGHTING\s+PLAN\b/, needsContext: true },
  { key: 'reflected_ceiling', re: /\bREFLECTED\s+CEILING\s+PLANS?\b|\bR\.?C\.?P\.?\b/, needsContext: true },
  { key: 'life_safety', re: /\bLIFE\s+SAFETY\s+PLANS?\b/, needsContext: true },
  { key: 'mechanical', re: /\b(?:MECHANICAL|HVAC)(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?))?\b/, needsContext: true },
  { key: 'plumbing', re: /\bPLUMBING(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?))?\b/, needsContext: true },
  { key: 'civil', re: /\b(?:CIVIL|SITE\s+CIVIL|SITE\s+UTILITY)(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?))?\b/, needsContext: true },
  { key: 'architectural', re: /\b(?:ARCHITECTURAL|ARCH\.?)(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?|ELEVATIONS?))?\b/, needsContext: true },
  { key: 'structural', re: /\bSTRUCTURAL(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?))?\b/, needsContext: true },
  { key: 'fire_protection', re: /\bFIRE\s+(?:PROTECTION|SPRINKLER)(?:\s+(?:DRAWINGS?|PLANS?|SHEETS?|DWGS?))?\b/, needsContext: true },
  { key: 'kitchen', re: /\b(?:KITCHEN|FOOD\s+SERVICE)\s+(?:EQUIPMENT\s+)?(?:DRAWINGS?|PLANS?|SHEETS?|SCHEDULES?)\b/, needsContext: true },
  { key: 'landscape', re: /\bLANDSCAPE\s+(?:DRAWINGS?|PLANS?|SHEETS?)\b/, needsContext: true },
];
const BROAD_DISCIPLINES = new Set<DisciplineRefKey>(['mechanical', 'plumbing', 'civil', 'architectural', 'structural', 'fire_protection', 'landscape']);
const DISCIPLINE_CONTEXT = /\b(?:SEE|REFER(?:\s+TO)?|REFERENCE|PER|COORDINATE\s+WITH|AS\s+SHOWN\s+ON|SHOWN\s+ON|IN\s+ACCORDANCE\s+WITH)\s+(?:THE\s+)?(?:[A-Z/&]+\s+){0,2}$/;

/** A sentence / note of a page's text, with the numbered note it sits under. */
export interface NoteSentence { text: string; note?: string }

/** Pure: split pdftotext output into sentences, remembering the numbered
 *  note each sits under ("3. ALL CONDUIT ..." -> note 3). */
export function splitNotes(pageText: string): NoteSentence[] {
  const out: NoteSentence[] = [];
  let note: string | undefined;
  // pdftotext -layout keeps a sheet's columns side by side on one line; a
  // run of 3+ spaces is a column gap, so each column piece is its own line.
  const pieces = pageText.split(/\r?\n/).flatMap(l => l.split(/\s{3,}/));
  // N1 — "SEE SHEET" at the end of a line continues on the next one.
  const lines: string[] = [];
  for (const piece of pieces) {
    const prev = lines[lines.length - 1];
    if (prev !== undefined && /\b(?:SEE|REFER(?:\s+TO)?|PER|SHEETS?|DWGS?\.?|DETAILS?|COORDINATE\s+WITH|(?:AS\s+)?SHOWN\s+ON)\s*$/i.test(prev.trim()) && piece.trim()) {
      lines[lines.length - 1] = `${prev.trim()} ${piece.trim()}`;
    } else {
      lines.push(piece);
    }
  }
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const n = /^(\d{1,2})[.)]\s+/.exec(line);
    if (n) note = `note ${n[1]}`;
    // The note number itself ("3.") is not a sentence end.
    const body = n ? line.slice(n[0].length) : line;
    body.split(/(?<=[.;])\s+(?=[A-Z0-9])/).forEach((s, i) => {
      const t = `${i === 0 && n ? n[0] : ''}${s.trim()}`.trim();
      if (t) out.push({ text: t, ...(note ? { note } : {}) });
    });
  }
  return out;
}

function snippet(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Pure: every reference the regex can read from one page's text. The
 *  third argument is either extra accepted prefixes (the inventory's own) or
 *  the full options (B1: the set's sheet-number pattern and the ids in the
 *  upload — an id not in the upload must match the pattern). The
 *  referencing page's own sheet number is never a reference. */
export function extractRegexRefs(
  pageText: string,
  from: { key: string; label: string; sheetNo: string },
  optsIn: Set<string> | RefExtractOptions = {},
): { refs: SheetRef[]; unresolved: NoteSentence[] } {
  const opts: RefExtractOptions = optsIn instanceof Set ? { knownPrefixes: optsIn } : optsIn;
  const refs: SheetRef[] = [];
  const unresolved: NoteSentence[] = [];
  const selfKey = normalizeSheetId(from.sheetNo);
  const seen = new Set<string>();
  const add = (r: Omit<SheetRef, 'fromKey' | 'fromLabel' | 'source'>) => {
    const k = `${r.kind}:${r.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    refs.push({ ...r, fromKey: from.key, fromLabel: from.label, source: 'regex' });
  };
  const known = (prefix: string) => KNOWN_SHEET_PREFIXES.has(prefix) || !!opts.knownPrefixes?.has(prefix) || !!opts.pattern?.prefixes.has(prefix);

  for (const s of splitNotes(pageText)) {
    const upper = s.text.toUpperCase();
    let found = false;
    // Explicit sheet ids after a pointer ("SEE E-5 AND E-6", "REFER TO SHEET C-3.1").
    ANCHOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANCHOR_RE.exec(upper))) {
      const tail = upper.slice(m.index + m[0].length);
      for (const id of idsAfterPointer(tail)) {
        const key = normalizeSheetId(id);
        if (!key) continue;
        const prefix = prefixOf(key);
        if (NOT_SHEET_PREFIXES.has(prefix) || !known(prefix)) continue;
        if (key === selfKey) { found = true; continue; }
        const inUpload = !!opts.inventoryKeys?.has(key);
        if (!inUpload && opts.pattern && !matchesSheetPattern(id, opts.pattern)) continue;
        add({ kind: 'sheet', key, label: id, context: snippet(s.text), ...(s.note ? { note: s.note } : {}) });
        found = true;
      }
    }
    // Discipline-only references ("SEE MECHANICAL DRAWINGS", "PER PHOTOMETRIC PLAN").
    // Most specific first; a matched phrase is blanked so "MECHANICAL
    // EQUIPMENT SCHEDULE" is not also a "mechanical drawings" reference.
    let rest = upper;
    let specific = false;
    for (const d of DISCIPLINE_PATTERNS) {
      const dm = d.re.exec(rest);
      if (!dm) continue;
      // N3 — "REFER TO ARCHITECTURAL REFLECTED CEILING PLAN" is the RCP,
      // not also every architectural sheet.
      if (specific && BROAD_DISCIPLINES.has(d.key)) continue;
      if (d.needsContext && !DISCIPLINE_CONTEXT.test(rest.slice(0, dm.index))) continue;
      rest = `${rest.slice(0, dm.index)}${' '.repeat(dm[0].length)}${rest.slice(dm.index + dm[0].length)}`;
      add({ kind: 'discipline', key: d.key, label: dm[0].toLowerCase(), context: snippet(s.text), ...(s.note ? { note: s.note } : {}) });
      if (!BROAD_DISCIPLINES.has(d.key)) specific = true;
      found = true;
    }
    // A sentence that plainly points somewhere, but nowhere the regex could
    // read: the vaguer phrasing goes to Haiku (services/sheetCheck.ts).
    if (!found && /\b(SEE|REFER|PER|COORDINATE\s+WITH|REFERENCE|SHOWN\s+ON|PROVIDED\s+ON)\b/.test(upper)
      && /\b(DRAWINGS?|PLANS?|SHEETS?|SCHEDULES?|DWGS?|SPECIFICATIONS?|DOCUMENTS?)\b/.test(upper)) {
      unresolved.push(s);
    }
  }
  return { refs, unresolved };
}

// ── Resolution against the inventory ────────────────────────────────────────

/** Pure: inventory pages a discipline-only reference points at. For the
 *  broad disciplines only the useful pages go (their schedules, else up to
 *  4 of their sheets) — the reference is for context, not a second set. */
export function pagesForDiscipline(key: DisciplineRefKey, inventory: RefInventoryPage[]): RefInventoryPage[] {
  const pre = (p: RefInventoryPage, re: RegExp) => re.test(p.sheetNo.trim());
  const title = (p: RefInventoryPage, re: RegExp) => re.test(p.title.toUpperCase());
  const byDisc = (disc: string, prefix: RegExp) => inventory.filter(p => p.discipline === disc || pre(p, prefix));
  const preferSchedules = (pages: RefInventoryPage[]) => {
    const sched = pages.filter(p => title(p, /SCHEDULE/));
    return (sched.length ? sched : pages).slice(0, 3);
  };
  switch (key) {
    case 'photometric':
      return inventory.filter(p => pre(p, /^PH/i) || title(p, /PHOTOMETRIC|SITE\s+LIGHTING|FOOT[\s-]?CANDLE|POINT[\s-]BY[\s-]POINT/));
    case 'reflected_ceiling':
      return inventory.filter(p => title(p, /REFLECTED\s+CEILING|\bRCP\b/));
    case 'life_safety':
      return inventory.filter(p => title(p, /LIFE\s+SAFETY/));
    case 'equipment_schedule':
      return inventory.filter(p => (p.discipline === 'mechanical' || p.discipline === 'plumbing' || pre(p, /^(M|P|MP|PL)[-\s.]?\d/i))
        && title(p, /SCHEDULE/));
    case 'mechanical': return preferSchedules(byDisc('mechanical', /^M[-\s.]?\d/i));
    case 'plumbing': return preferSchedules(byDisc('plumbing', /^P[-\s.]?\d/i));
    case 'civil': {
      const pages = byDisc('civil', /^C[-\s.]?\d/i).filter(p => !pagesForDiscipline('photometric', [p]).length);
      const site = pages.filter(p => title(p, /SITE|UTILIT|PAVING|GRADING/));
      return (site.length ? site : pages).slice(0, 3);
    }
    case 'architectural': return byDisc('architectural', /^A[-\s.]?\d/i).slice(0, 3);
    case 'structural': return byDisc('structural', /^S[-\s.]?\d/i).slice(0, 3);
    case 'fire_protection': return inventory.filter(p => pre(p, /^FP/i) || title(p, /FIRE\s+(PROTECTION|SPRINKLER)/)).slice(0, 3);
    case 'kitchen': return inventory.filter(p => pre(p, /^(K|Q|FS)[-\s.]?\d/i) || title(p, /KITCHEN|FOOD\s+SERVICE/)).slice(0, 3);
    case 'landscape': return inventory.filter(p => pre(p, /^L[-\s.]?\d/i) && p.discipline !== 'electrical').slice(0, 3);
    default: return [];
  }
}

/** Pure: resolve every reference against the inventory. One ResolvedRef per
 *  distinct target (a sheet referenced from three places is one entry with
 *  three `referencedBy`). */
export function resolveRefs(refs: SheetRef[], inventory: RefInventoryPage[], pattern?: SheetPattern): ResolvedRef[] {
  const byId = new Map<string, ResolvedRef>();
  const bySheetKey = new Map<string, RefInventoryPage[]>();
  for (const p of inventory) {
    const k = normalizeSheetId(p.sheetNo);
    if (!k) continue;
    if (!bySheetKey.has(k)) bySheetKey.set(k, []);
    bySheetKey.get(k)!.push(p);
  }
  for (const r of refs) {
    const id = `${r.kind}:${r.key}`;
    let entry = byId.get(id);
    if (!entry) {
      let pages: RefInventoryPage[];
      let status: RefStatus;
      if (r.kind === 'sheet') {
        pages = bySheetKey.get(r.key) ?? [];
        // B1 — a missing id must look like this set's sheet numbers.
        if (!pages.length && pattern && !matchesSheetPattern(r.label, pattern)) continue;
        const titles = new Set(pages.map(p => p.title.trim().toUpperCase()));
        status = pages.length === 0 ? 'missing' : titles.size > 1 ? 'ambiguous' : 'present';
      } else {
        pages = pagesForDiscipline(r.key as DisciplineRefKey, inventory);
        status = pages.length ? 'present' : 'missing';
      }
      entry = {
        id, kind: r.kind, key: r.key,
        label: r.kind === 'sheet' ? r.label : DISCIPLINE_REF_LABELS[r.key as DisciplineRefKey] ?? r.label,
        status,
        pages: pages.map(p => p.key),
        referencedBy: [],
        notProvidedText: r.kind === 'sheet'
          ? `Sheet ${r.label} not provided at time of bid`
          : DISCIPLINE_NOT_PROVIDED[r.key as DisciplineRefKey] ?? `${r.label} not provided at time of bid`,
      };
      byId.set(id, entry);
    }
    if (!entry.referencedBy.some(x => x.fromKey === r.fromKey && x.context === r.context)) {
      entry.referencedBy.push({ fromKey: r.fromKey, fromLabel: r.fromLabel, ...(r.note ? { note: r.note } : {}), context: r.context, source: r.source });
    }
  }
  return [...byId.values()];
}

/** Pure: pages worth sending as reference even when nothing points at them —
 *  mechanical & plumbing equipment schedules, photometric / site lighting,
 *  reflected ceiling and life safety plans. */
export function alwaysUsefulPages(inventory: RefInventoryPage[]): Array<{ key: string; why: string }> {
  const out: Array<{ key: string; why: string }> = [];
  const add = (pages: RefInventoryPage[], why: string) => {
    for (const p of pages) if (!out.some(o => o.key === p.key)) out.push({ key: p.key, why });
  };
  add(pagesForDiscipline('equipment_schedule', inventory), 'equipment schedule');
  add(pagesForDiscipline('photometric', inventory), 'photometric / site lighting');
  add(pagesForDiscipline('reflected_ceiling', inventory), 'reflected ceiling plan');
  add(pagesForDiscipline('life_safety', inventory), 'life safety plan');
  return out;
}

/** Pure: parse the Haiku / vision reply — a JSON array of
 *  {kind:'sheet',id} | {kind:'discipline',key} with an optional context.
 *  Anything malformed is dropped (never guessed). */
export function parseAiRefs(text: string, from: { key: string; label: string }, source: 'haiku' | 'vision', fallbackContext = ''): SheetRef[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = (fenced?.[1] ?? text).trim();
  const start = src.search(/[[{]/);
  if (start < 0) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(src.slice(start)); } catch { return []; }
  const arr = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { refs?: unknown })?.refs) ? (parsed as { refs: unknown[] }).refs : [];
  const out: SheetRef[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const context = snippet(String(r.context ?? fallbackContext ?? ''));
    if (r.kind === 'sheet' && typeof r.id === 'string') {
      const key = normalizeSheetId(r.id);
      if (!key || NOT_SHEET_PREFIXES.has(prefixOf(key))) continue;
      out.push({ kind: 'sheet', key, label: r.id.trim(), context, fromKey: from.key, fromLabel: from.label, source });
    } else if (r.kind === 'discipline' && typeof r.key === 'string' && r.key in DISCIPLINE_REF_LABELS) {
      out.push({ kind: 'discipline', key: r.key, label: DISCIPLINE_REF_LABELS[r.key as DisciplineRefKey], context, fromKey: from.key, fromLabel: from.label, source });
    }
  }
  return out;
}
