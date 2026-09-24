// Next round A6 — "By G.C." = APT scope (Jake's Decision 4). Pure.
//
// On electrical drawings, "G.C. furnished/installed", "by GC", "by the
// general contractor" means APT furnishes and installs it: the GC subs the
// electrical to APT. Count it, price it and write it as APT — never as an
// exclusion. Only another trade (HVAC, plumbing, fire protection…), the
// Owner, a vendor or "others" is outside APT's supply, and Owner-furnished
// equipment is still APT-installed.
import type { BidData } from './bidData';

/** The rule as the Agent 2 / Agent 4 prompts and the counter read it. */
export const GC_MEANS_APT_RULE = 'BY G.C. = APT SCOPE: on the electrical drawings, "G.C. furnished/installed", "by G.C." or "by the general contractor" means APT furnishes and installs it (the GC subcontracts the electrical work to APT). Count, price and write those items as APT scope — never as an exclusion, "by others" or "by GC". Only another trade (HVAC, plumbing, fire protection, low-voltage vendor), the Owner, an equipment vendor or "others" is outside APT\'s supply, and Owner-furnished equipment is still installed and connected by APT.';

export type AssignedParty = 'APT' | 'Owner' | 'Vendor' | 'OtherTrade' | 'Others';

export interface TradeAssignment {
  furnish: AssignedParty | null;
  install: AssignedParty | null;
  /** "HVAC", "plumbing", … when another trade is named. */
  otherTrade?: string;
  /** APT connects / wires what another party installs ("wired by EC"). */
  aptConnects: boolean;
  /** Some half came from a "by G.C." (read as APT). */
  viaGc: boolean;
  /** Which half came from a "by G.C.". */
  gcHalves: { furnish: boolean; install: boolean };
  /** What of it is APT's: full (F&I), install (owner/vendor furnished),
   *  connection (another trade installs, APT wires), none. */
  aptScope: 'full' | 'install' | 'connection' | 'none';
}

const OTHER_TRADE = /\b(hvac|mechanical|mech\.?|plumbing|plumber|fire\s+(?:protection|sprinkler|alarm\s+(?:vendor|contractor))|sprinkler|div(?:ision)?\s*2[123]|kitchen\s+(?:vendor|contractor)|low[\s-]?voltage\s+(?:vendor|contractor)|security\s+(?:vendor|contractor))\b/i;
const GC = /\b(?:g\.\s?c\.?|gc|general\s+contractor)\b/i;
const EC = /\b(?:e\.\s?c\.?|ec|electrical\s+contractor|electrician|div(?:ision)?\s*26|apt)\b/i;

/** One party phrase -> our vocabulary (GC read as APT; see viaGc). */
function party(raw: string): { p: AssignedParty; viaGc: boolean; trade?: string } | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  const trade = OTHER_TRADE.exec(s);
  if (trade) return { p: 'OtherTrade', viaGc: false, trade: trade[1].replace(/\.$/, '').toUpperCase() === 'HVAC' ? 'HVAC' : trade[1].toLowerCase() };
  if (/\bowner['’]?s\s+(?:[a-z]+\s+)?(vendor|contractor|supplier)\b/.test(s)) return { p: 'Vendor', viaGc: false };
  if (/\bvendor\b/.test(s) && !GC.test(s)) return { p: 'Vendor', viaGc: false };
  if (GC.test(s)) return { p: 'APT', viaGc: true };
  if (EC.test(s)) return { p: 'APT', viaGc: false };
  if (/\b(owner|tenant|landlord)\b/.test(s)) return { p: 'Owner', viaGc: false };
  if (/\b(vendor|manufacturer|supplier)\b/.test(s)) return { p: 'Vendor', viaGc: false };
  if (/\b(others?|n\.?\s?i\.?\s?c\.?|not\s+in\s+contract)\b/.test(s)) return { p: 'Others', viaGc: false };
  return null;
}

const PARTY_PHRASE = String.raw`((?:the\s+)?(?:g\.?\s?c\.?\s*\/\s*e\.?\s?c\.?|e\.?\s?c\.?\s*\/\s*g\.?\s?c\.?|owner['’]?s\s+(?:[a-z]+\s+)?(?:vendor|contractor|supplier)|[a-z]+\s+vendor|g\.\s?c\.?|gc|general\s+contractor|e\.\s?c\.?|ec|electrical\s+contractor|owner|tenant|vendor|equipment\s+vendor|manufacturer|others?|hvac|mechanical(?:\s+contractor)?|plumbing(?:\s+contractor)?|fire\s+protection(?:\s+contractor)?|sprinkler(?:\s+contractor)?)(?:\s+contractor)?)`;

/** Pure: who furnishes / installs an item, read from its schedule / legend
 *  text ("SIMPLEX RECEPTACLE, G.C. FURNISHED/INSTALLED", "EXHAUST FAN
 *  RECESSED, INSTALLED BY HVAC, WIRED BY EC", "DUPLEX RECEPTACLE, G.C.").
 *  null when the text says nothing about it (APT F&I is the default). */
export function tradeAssignmentOf(text: string): TradeAssignment | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  let furnish: ReturnType<typeof party> = null;
  let install: ReturnType<typeof party> = null;
  let trade: string | undefined;
  const both = new RegExp(String.raw`(?:furnished\s*(?:\/|and|&)\s*installed|f\s*\/\s*i|f\s*&\s*i|provided\s+and\s+installed)\s+by\s+${PARTY_PHRASE}`).exec(t)
    ?? new RegExp(String.raw`${PARTY_PHRASE}\s+(?:furnished\s*(?:\/|and|&)\s*installed|f\s*\/\s*i|f\s*&\s*i|provided\s+and\s+installed)`).exec(t);
  if (both) { furnish = party(both[1]); install = furnish; }
  const f = new RegExp(String.raw`(?:furnished|supplied|provided)\s+by\s+${PARTY_PHRASE}`).exec(t)
    ?? new RegExp(String.raw`${PARTY_PHRASE}\s+(?:furnished|supplied|provided)\b(?!\s*(?:\/|and|&)\s*installed)`).exec(t);
  if (f && !furnish) furnish = party(f[1]);
  const i = new RegExp(String.raw`(?:installed|set|mounted)\s+by\s+${PARTY_PHRASE}`).exec(t)
    ?? new RegExp(String.raw`(?<!furnished\s?\/\s?|furnished\sand\s|furnished\s&\s)${PARTY_PHRASE}\s+installed`).exec(t);
  if (i && !install) install = party(i[1]);
  const CONNECT_BY_EC = /\b(?:wired|wiring|connected|connection|final\s+connection|power(?:ed)?)\s+by\s+(?:the\s+)?(?:e\.\s?c\.?|ec|electrical\s+contractor|electrician)\b|\bec\s+to\s+(?:wire|connect|provide\s+(?:power|connection))/;
  const wiredByEc = CONNECT_BY_EC.test(t);
  if (!furnish && !install) {
    // "…, G.C." / "(BY OWNER)" / "N.I.C." — a bare trailing party. N10: the
    // EC's own connection wording ("power by EC") is not the party.
    const rest = t.replace(new RegExp(CONNECT_BY_EC.source, 'g'), ' ').replace(/[\s,;.]+$/, '').trim();
    const bare = new RegExp(String.raw`(?:,|\(|\bby)\s*${PARTY_PHRASE}\s*\)?\s*\.?\s*$`).exec(rest)
      ?? (/\bn\.?\s?i\.?\s?c\.?\b|\bnot\s+in\s+contract\b/.test(t) ? ['', 'others'] : null);
    const p = bare ? party(bare[1]) : null;
    // Fix round S9 — a bare Owner / owner's vendor / vendor is who
    // FURNISHES it: installing it is still APT's (Decision 4). Only others,
    // another trade or N.I.C. covers both halves.
    if (p) { furnish = p; install = p.p === 'Owner' || (p.p === 'Vendor' && !wiredByEc) ? null : p; }
  }
  if (!furnish && !install && !wiredByEc) return null;
  trade = furnish?.trade ?? install?.trade;
  const fP = furnish?.p ?? null;
  const iP = install?.p ?? null;
  const aptConnects = wiredByEc;
  const aptInstalls = iP === 'APT' || (iP === null && (fP === 'APT' || fP === 'Owner' || fP === 'Vendor'));
  const aptFurnishes = fP === 'APT' || (fP === null && iP === 'APT');
  const aptScope: TradeAssignment['aptScope'] = aptInstalls ? (aptFurnishes ? 'full' : 'install')
    : aptConnects ? 'connection' : 'none';
  return {
    furnish: fP, install: iP,
    ...(trade ? { otherTrade: trade } : {}),
    aptConnects, viaGc: !!(furnish?.viaGc || install?.viaGc), gcHalves: { furnish: !!furnish?.viaGc, install: !!install?.viaGc }, aptScope,
  };
}

/** Pure: a type the counter need not find — installed by another trade,
 *  the Owner, a vendor or others. A zero count for it is information, not a
 *  block (Decision 4). Owner/vendor-furnished but APT-installed is NOT. */
export function outsideAptInstall(a: TradeAssignment | null | undefined): boolean {
  return !!a && (a.aptScope === 'none' || a.aptScope === 'connection');
}

export function describeAssignment(a: TradeAssignment): string {
  const who = (p: AssignedParty | null) => p === 'OtherTrade' ? (a.otherTrade ?? 'another trade') : p === 'Others' ? 'others' : p ?? '';
  if (a.aptScope === 'full') return a.viaGc ? 'by G.C. — APT scope (furnish & install)' : 'APT furnish & install';
  if (a.aptScope === 'install') return `furnished by ${who(a.furnish)}, installed by APT`;
  if (a.aptScope === 'connection') return `installed by ${who(a.install)}; APT wires / connects it`;
  return `by ${who(a.install ?? a.furnish)} — not APT's to supply or install`;
}

// ── GC-document hygiene ─────────────────────────────────────────────────────

const ELECTRICAL_ITEM = /\b(receptacles?|outlets?|devices?|device\s+box(?:es)?|fixtures?|luminaires?|lights?|lighting|panel(?:board)?s?|disconnects?|safety\s+switch(?:es)?|conduits?|raceways?|wir(?:e|es|ing)|cabling|cables?|circuits?|switch(?:es)?|power(?:\s*poles?)?|temporary\s+power|temp\s+power|breakers?|transformers?|feeders?|junction\s+box(?:es)?|j-?box(?:es)?|floor\s+box(?:es)?|baseflex|exit\s+signs?|emergency\s+lights?|pull\s+strings?|sleeves?|homeruns?)\b/i;
const GC_WORD = String.raw`(?:g\.\s?c\.?|gc|general\s+contractor)`;
/** Fix round S8 — every way a note puts work on the GC: "by GC", "from the
 *  GC", "GC furnished / provided / installed", "GC to / shall / will
 *  provide / furnish / install / supply". */
const BY_GC = new RegExp(String.raw`\b(?:by|from)\s+(?:the\s+)?${GC_WORD}(?![a-z])|\b${GC_WORD}[\s-]+(?:furnished|provided|supplied|installed)\b|\b${GC_WORD}\s+(?:to|shall|will|must)\s+(?:provide|furnish|install|supply)\b`, 'i');

export interface GcScopeFinding { category: string; line: string; detail: string }

/** Fix round S8 — the items a line names, one by one ("Receptacles and
 *  lighting by GC" -> receptacles, lighting). */
function itemsOf(line: string): string[] {
  const head = line.replace(BY_GC, '|').split('|')[0] || line;
  return head.split(/\s*(?:,|;|\/|&|\band\b|\bor\b|\bplus\b)\s*/i).map(x => x.trim()).filter(x => ELECTRICAL_ITEM.test(x));
}

/** Pure: GC-facing text that puts electrical items on the GC — an
 *  exclusion or clarification ("Receptacles by GC", "GC to provide
 *  temporary power"), a scope bullet, or a takeoff line furnished by the GC.
 *  `gcTerms`: account terms the rule / estimator really assigned to the GC.
 *  They excuse only the items they cover (S8: per item, not per line). */
export function gcScopeFindings(data: Pick<BidData, 'exclusions' | 'takeoff'> & Partial<Pick<BidData, 'sections'>>, gcTerms: RegExp[] = []): GcScopeFinding[] {
  const out: GcScopeFinding[] = [];
  const covered = (item: string) => gcTerms.some(re => re.test(item));
  const text = (b: unknown) => typeof b === 'string' ? b : `${(b as { b: string }).b}${(b as { t: string }).t}`;
  const scan = (category: string, s: string) => {
    if (!BY_GC.test(s)) return;
    const items = itemsOf(s);
    const open = items.length ? items.filter(i => !covered(i)) : (ELECTRICAL_ITEM.test(s) && !covered(s) ? [s] : []);
    if (!open.length) return;
    out.push({ category, line: s, detail: `"${s}" puts electrical work on the GC${items.length > 1 ? ` (${open.join(', ')})` : ''}. On electrical drawings "by G.C." is APT scope (the GC subs the electrical to APT) — carry it as APT, or keep it with a reason.` });
  };
  for (const b of data.exclusions ?? []) scan('exclusions', text(b));
  for (const sec of data.sections ?? []) for (const b of sec.bullets ?? []) scan(sec.title, text(b));
  for (const cat of data.takeoff ?? []) {
    for (const it of cat.items) {
      const fb = String((it as { furnish_by?: string }).furnish_by ?? '').trim();
      const line = `${it.item}${it.description ? ` — ${it.description}` : ''}`;
      if (!fb || !new RegExp(String.raw`^(?:the\s+)?${GC_WORD}\b`, 'i').test(fb) || /\bec\s+installs\b/i.test(fb)) continue;
      if (covered(line)) continue;
      out.push({ category: cat.name, line: it.item, detail: `${cat.name}: "${line}" is marked furnished by ${fb}. "By G.C." on electrical drawings is APT scope — carry it as APT furnish & install, or keep it with a reason.` });
    }
  }
  return out;
}
