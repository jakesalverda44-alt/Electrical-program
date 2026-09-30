// Estimating labor engine — Task 4: takeoff line → assembly/item mapper.
//
// Pure and deterministic: no AI, no DB, no I/O. Given a normalized takeoff
// line and the library (items + assemblies, each with aliases), returns the
// best match and how confident that match is. A "suggest with AI" button for
// lines that come back `none` is a follow-up, not this task.
//
// Accepts two real input shapes so the caller doesn't have to pre-normalize:
//   - the bidstd TakeoffItem/TakeoffCategory shape (backend/src/bidstd/bidData.ts):
//     `item` is Agent 4's short takeoff item id ("5.1"), `description` is the text.
//   - the legacy Agent 2/4 line shape used by the frontend's
//     buildLineItemsFromTakeoff (PcWorkspace/parsing.ts) — { category, item,
//     qty, unit, spec?, confidence?, notes? }. Corrected understanding (Part 1
//     follow-up): `item` here is ALSO the short takeoff item id, matching Agent
//     4's convention (Agent 4 QCs and restructures Agent 2's output, preserving
//     its numbering) — `spec` carries the descriptive text. An earlier version
//     of this file treated `item` as the description, which meant est_bid_lines
//     never recorded the short id and composeBidData's per-line confidence
//     lookup (keyed on that id) couldn't match a new-engine-saved bid. See
//     NormalizedTakeoffLine.takeoffItemId / MappedLine.takeoffItemId below.

import { canonicalizeTakeoffCategory } from '../bidstd/boilerplate';

export type MapConfidence = 'exact' | 'alias' | 'fuzzy' | 'none';
export type SourceConfidence = 'FIRM' | 'APPROX' | 'VERIFY';

export interface NormalizedTakeoffLine {
  category: string;
  /** The text matched against the library — a takeoff item's `description`
   *  (falling back to `item`/`spec` when blank, shape-dependent). */
  description: string;
  /** Agent 4's short takeoff item id (e.g. "5.1"), when the source shape has
   *  one — carried through untouched so callers can key on it (composeBidData's
   *  SavedConfidenceItem, est_bid_lines.takeoff_item_id) without re-deriving it. */
  takeoffItemId?: string | null;
  /** Raw qty as the takeoff carries it. A string (e.g. "VERIFY", "TBD") is never
   *  coerced to a number — see MappedLine.qty / isVerifyQty. */
  qty: number | string;
  unit: string;
  /** The takeoff's OWN stated confidence about the quantity (FIRM/APPROX/VERIFY),
   *  distinct from MappedLine.matchConfidence (how sure the mapper is about WHICH
   *  library row this is). */
  sourceConfidence?: SourceConfidence | null;
  /** A secondary raw text field — the OTHER of a takeoff row's item/spec fields,
   *  whichever one wasn't chosen as `description` (B3 fix). Real Agent 2/4 rows
   *  split the descriptive noun unpredictably across the two fields — e.g. item
   *  "Duplex receptacle" / spec "20A,125V,NEMA 5-20R,spec grade" carries the
   *  device name in `item`, while item "5.1" / spec "3/4\" EMT" carries it in
   *  `spec`. Using only the "primary" field lost the noun in the first case and
   *  mapped a receptacle to a switch. altText widens alias/fuzzy recall (its
   *  tokens are merged into the match text) without weakening the primary
   *  description's own exact-match precision — exact match still requires the
   *  primary text (or altText) to equal a candidate name/alias outright. */
  altText?: string | null;
}

export interface LibraryCandidate {
  kind: 'assembly' | 'item';
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  aliases: string[];
  /** Review round 2 / B3 — est_items.source / est_assemblies.source
   *  ('seed'|'accubid'|'manual'|'calibrated'). Used only as a tie-break
   *  (below): a curated seed/manual/calibrated row outranks a raw,
   *  unreconciled Accubid-imported row when both score identically —
   *  an accubid-imported "3/4" Coupling - EMT Set Screw Steel" must never
   *  beat the seed's own "3/4" EMT" item on a bare tie. Optional so every
   *  existing caller that built a LibraryCandidate by hand (tests, mostly)
   *  keeps compiling; a candidate with no source is treated as neutral. */
  source?: string;
  /** Price accuracy round C1 — the candidate's own per-library-unit material
   *  $ and labor hours (an assembly's resolved components). Used only to
   *  hold back an expensive FUZZY match for the estimator to confirm
   *  (FUZZY_CONFIRM_*). Optional: a hand-built candidate without them is
   *  never held back on cost (the family rules still apply). */
  materialCost?: number;
  laborHours?: number;
}

export interface MappedLine {
  category: string;
  description: string;
  /** Passed through from NormalizedTakeoffLine.takeoffItemId — never derived here. */
  takeoffItemId: string | null;
  /** Resolved qty — 0 when the source qty was a non-numeric string (VERIFY-style). */
  qty: number;
  unit: string;
  isVerifyQty: boolean;
  sourceConfidence: SourceConfidence | null;
  matchConfidence: MapConfidence;
  matchedKind: 'assembly' | 'item' | null;
  matchedId: string | null;
  matchedCode: string | null;
  /** The matched item/assembly's OWN unit (e.g. "C" for a per-100-ft item),
   *  as opposed to `unit` above which stays the takeoff line's display unit
   *  (e.g. "LF"). Callers (bidEstimate.ts) pass this through to pricing.ts as
   *  PricingLineInput.libraryUnit so a 1,200 LF line matched to a per-C item
   *  prices as 12 C, not 1,200 EA (B1). Null when there is no match. */
  matchedUnit: string | null;
  /** Price accuracy round C1 — set on a FUZZY match the estimator must
   *  confirm before it prices (an expensive item, or any match into gear):
   *  the line carries the suggestion but contributes $0 / 0 h until then
   *  (bidEstimate.ts stores it as match_confidence 'confirm'). */
  confirmReason: string | null;
  /** Price accuracy round C1 — why a line was deliberately left unresolved
   *  (a panel's circuit list, an equipment connection with no unit at its
   *  amperage) — written to the line's evidence note. */
  note: string | null;
}

// ── Price accuracy round C1 — equipment families ────────────────────────────
//
// A fuzzy match may never cross equipment families: a panel's circuit list
// must never become a transformer, a disconnect never a wall pack. A line's
// family comes from its words, category and unit; a library row's from its
// name within its library category (the library's categories are coarse —
// "Branch Power" holds devices, boxes, raceway and wire alike — so the
// category is the fallback, never the first word).
export type EquipmentFamily =
  | 'transformer' | 'gear' | 'disconnect' | 'fixture' | 'device' | 'control'
  | 'wire' | 'conduit' | 'fitting' | 'box' | 'equipment_connection'
  | 'demolition' | 'low_voltage' | 'site' | 'grounding'
  // N10 — a fixture's own part (ballast, driver): never the fixture itself.
  | 'accessory';

/** HVAC / motor / appliance loads: the equipment-connection rows (C1). */
const EQUIPMENT_LOAD_RE = /air ?handler|\bahu\b|\brtu\b|roof ?top unit|\bcomp(?:ressor)?\b|a\/c\b|condens(?:er|ing)|heat pump|water heater|\bwh\b(?=\s*[-—–])|\bmotor\b|\bpump\b|unit heater|\bmua\b|make.?up air|\berv\b|\bdoas\b|\bvav\b/i;
const CONTROL_RE = /occupancy|vacancy|\bsensors?\b|photo ?cells?|photo ?control|contactors?|relay panel|lighting control|control panel|time ?clock|time ?switch|timer|\balc\b/i;
const DISCONNECT_RE = /disconnect|safety switch|fused switch|non-?fused|\bdisc(?:on)?\b/i;
const GEAR_RE = /panel ?board|\bpanels?\b|switch ?board|switch ?gear|load center|\bmeter\b|\bct cabinet|transfer switch|\bats\b|busway|surge|\bspd\b|service entrance|\bmdp\b|\bmsb\b|wireway|gutter|breaker/i;
const FIXTURE_RE_FAM = /luminaire|fixtures?|troffer|down ?light|\bcan\b|high ?bay|low ?bay|\bstrip ?lights?\b|\bstrip fixtures?\b|\bled strips?\b|\bstriplights?\b|track lighting|wall ?pack|\bexit\b|emergency|egress|pendant|sconce|vanity|flood ?light|bollard|area light|pole light|light pole|canopy|\blights?\b|\blt\b|\blamps?\b|\bled\b|fixture heads?/i;
const DEVICE_RE_FAM = /light ?switch(?:es)?|plug-?mold|multi-?outlet|(?:receptacle|outlet) strips?|receptacles?|\boutlets?\b|duplex|\bgfci?\b|\bquad(?:plex)?\b|fourplex|\bswitch(?:es)?\b|dimmer|\busb\b|power poles?|twist.?lock|wiring device/i;
const BOX_RE = /\bbox(?:es)?\b|j-?box|junction|handhole|\brings?\b|\bcovers?\b|floor box/i;
const FITTING_RE = /conduit body|fittings?|couplings?|connectors?|straps?|bushings?|locknuts?|\bclips?\b|condulet/i;
const LOW_VOLTAGE_RE_FAM = /\bdata\b|fire alarm|\bfa\b|\bfacp\b|catv|\ba\/v\b|access control(?: panel)?|card access|card reader|maglock|camera|cctv|intercom|paging|telephone|\bphone\b|\btel\b|security|backboard|plywood|low voltage/i;
const GROUNDING_RE_FAM = /ground rod|ground bar|ground ring|bonding|\bbond\b|ufer|lightning|grounding|exothermic/i;
const SITE_RE_FAM = /trench|\bbore\b|equipment pad|concrete pad|duct (?:spacer|rack)|traffic/i;
const EQUIPMENT_RE_FAM = /\(connection\)|\bconnections?\b|direct power|\bequipment\b|\bfans?\b|exhaust|charger|\bev\b|car wash|fuel dispenser|gate operator|starter|\bsigns?\b|hook ?up/i;
const WIRE_RE_FAM = /thhn|thwn|xhhw|\bconductors?\b|\bwire\b|\bmc\b|mc cable|\bcable\b|kcmil|\bawg\b/i;
const CONDUIT_RE_FAM = /\bemt\b|\bpvc\b|\brmc\b|\bimc\b|\brigid\b|conduit|\bflex\b|\blfmc\b|\bfmc\b|liquidtight|raceway/i;

/** An HVAC / motor load named BEFORE any device, control, disconnect or
 *  fixture noun: "A/C Comp Unit #1 … with disconnect" is the unit's
 *  connection; "WP GFCI receptacle at condensers" is a receptacle and "Roof
 *  photocell sensor on RTU" a photocell. */
const COMPETING_NOUN_RE = /receptacles?|\boutlets?\b|duplex|\bgfci?\b|\bswitch(?:es)?\b|photo ?cells?|\bsensors?\b|disconnect|safety switch|luminaire|fixtures?|\blights?\b/i;
function equipmentLoadLeads(t: string): boolean {
  const load = t.search(EQUIPMENT_LOAD_RE);
  if (load < 0) return false;
  const other = t.search(COMPETING_NOUN_RE);
  return other < 0 || load < other;
}

function categoryFamily(category: string, unit: string): EquipmentFamily | null {
  const c = canonicalizeTakeoffCategory(category ?? '').toLowerCase();
  if (unitFamily(unit) === 'LINEAR') return null;
  if (/demoli/.test(c)) return 'demolition';
  if (/lighting controls/.test(c)) return 'control';
  if (/interior lighting|exterior|site lighting/.test(c)) return 'fixture';
  if (/low voltage/.test(c)) return 'low_voltage';
  if (/grounding/.test(c)) return 'grounding';
  if (/service & distribution/.test(c)) return 'gear';
  return null;
}

/** The one family classifier, for a takeoff line's text (description + the
 *  other field) and for a library row's name. Order matters: an HVAC load
 *  row names its panel ("… Panel A ckts 15,17") and its disconnect; a
 *  disconnect says "switch"; a lighting-control panel says "panel". */
/** Fix round B1/S2 — a fixture's own noun. "Panel" is a fixture word only
 *  when paired with light / LED / flat / troffer ("LED flat panel", "panel
 *  light"); "security light" is a fixture, not low voltage. */
const STRONG_FIXTURE_RE = /luminaire|\b(?:led|light|lighting) fixtures?\b|troffer|high ?bay|low ?bay|\bstrip (?:light|fixture)|\bled strip\b|wall ?pack|down ?light|\bcan (?:light|lt)\b|flood ?light|area light|pole (?:fixture )?head|fixture heads?|security light|\b(?:flat|led) panel\b|\bpanel light\b|\bpendant\b|\bsconce\b|\bvanity light\b|\bexit (?:sign|light)\b|emergency (?:light|egress)/i;
/** A fixture noun in a lighting category always wins over accessory words. */
const FIXTURE_NOUN_RE = /luminaire|\bfixtures?\b|\blights?\b|\blt\b|high ?bay|low ?bay|\bstrip\b|troffer|\bpanel light\b|\b(?:flat|led) panel\b|wall ?pack|down ?light|\bcan\b|pole (?:fixture )?head|fixture heads?|\bexit\b|emergency|pendant|sconce|flood|canopy|bollard/i;

/** Fix round B1/S1/S2 — what the family is read from: circuit references
 *  ("circuit to Panel A", "Panel A ckts 15,17", "ckt 2", "circuit A08")
 *  never set a family, and an accessory phrase ("with sensor", "w/ integral
 *  occupancy sensor", "with disconnect", "incl. …") never beats the item it
 *  qualifies. */
export function familyText(text: string): string {
  let t = ` ${(text ?? '').toLowerCase()} `;
  const nums = '\\s*\\d+(?:\\s*[,&/-]\\s*\\d+(?![\\da-z\\/]))*';
  // Fix round N2 — a panel reference is stripped only where it follows a
  // circuit / feed word ("circuit to Panel A", "fed from Panel A", "sub-feed
  // from Panel A ckts 27,29") or carries its circuits ("Panel A ckts 15,17");
  // "PANEL B FEED", "Sub-panel B" keep the panel as their item.
  t = t.replace(new RegExp(`\\b(?:circuits?|ckts?|fed|feeds?|feed|served|from)\\s+(?:to|from|by|off)?\\s*(?:the\\s+)?(?:existing\\s+)?(?:panel|pnl)\\s+[a-z]{1,2}-?\\d{0,3}\\b(?:\\s*(?:ckts?|circuits?)${nums})?`, 'g'), ' ');
  t = t.replace(new RegExp(`\\b(?:panel|pnl)\\s+[a-z]{1,2}-?\\d{0,3}\\s+(?:ckts?|circuits?)${nums}`, 'g'), ' ');
  t = t.replace(new RegExp(`\\b(?:ckts?|circuits?)\\s*(?:to\\s+)?[a-z]?-?\\d+(?:\\s*[,&/-]\\s*[a-z]?-?\\d+(?![\\da-z\\/]))*`, 'g'), ' ');
  t = t.replace(/\b(?:ckts?|circuits?)\b/g, ' ');
  // A schedule reference ("not in fixture schedule") names a document, not the item.
  t = t.replace(/\b(?:not\s+)?(?:in|on|per|from)?\s*(?:the\s+)?(?:fixture|panel|lighting|light|equipment)\s+schedules?\b/g, ' ');
  // An accessory clause ("with sensor", "w/ integral occupancy sensor",
  // "incl. …") never beats the item it qualifies: drop to the end.
  const acc = t.search(/\s(?:with|w\/|integral|incl\.?|including)\s/);
  if (acc > 0 && /[a-z]{3,}/.test(t.slice(0, acc))) t = t.slice(0, acc);
  // Fix round N1 — an object / location clause ("for sign lights", "at pole
  // light", "serving …", "feeding …", "to …", "on RTU", "in restroom") names
  // what the item serves or where it is, never the item: dropped up to the
  // next comma / semicolon / parenthesis.
  t = t.replace(/\s(?:for|at|serving|feeding|to|on|in)\s[^,;()]*/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Fix round N1 — the head noun decides the family. Every family noun is
 *  found; the first one starts the item's noun phrase, and a compound noun
 *  runs on through the nouns right after it ("wall switch sensor" is a
 *  sensor, "lighting contactor" a contactor, "disconnect switch" a
 *  disconnect). "Connection" / "equipment" never take over a phrase. */
const FAMILY_NOUNS: Array<[EquipmentFamily, RegExp, boolean?]> = [
  ['transformer', /\btransformers?\b|\bxfmr\b/g],
  ['disconnect', /disconnect switch(?:es)?|disconnect|safety switch|fused switch|non-?fused switch|non-?fused|\bdisc(?:on)?\b/g],
  ['fixture', new RegExp(STRONG_FIXTURE_RE.source, 'gi')],
  ['equipment_connection', new RegExp(EQUIPMENT_LOAD_RE.source, 'gi')],
  ['low_voltage', new RegExp(LOW_VOLTAGE_RE_FAM.source, 'gi')],
  ['control', new RegExp(`${CONTROL_RE.source}|lighting relay|relay`, 'gi')],
  ['device', /power poles?/g],
  ['gear', new RegExp(GEAR_RE.source, 'gi')],
  ['equipment_connection', /\bfans?\b|exhaust/g],
  ['device', new RegExp(DEVICE_RE_FAM.source, 'gi')],
  ['fixture', new RegExp(FIXTURE_RE_FAM.source, 'gi')],
  ['box', new RegExp(BOX_RE.source, 'gi')],
  ['fitting', new RegExp(FITTING_RE.source, 'gi')],
  ['grounding', new RegExp(GROUNDING_RE_FAM.source, 'gi')],
  ['site', new RegExp(SITE_RE_FAM.source, 'gi')],
  ['equipment_connection', /\(connection\)|\bconnections?\b|direct power|\bequipment\b/g, true],
  ['equipment_connection', new RegExp(EQUIPMENT_RE_FAM.source, 'gi')],
];

interface NounHit { fam: EquipmentFamily; start: number; end: number; weak: boolean; rank: number }

export function headFamily(t: string): EquipmentFamily | null {
  const hits: NounHit[] = [];
  FAMILY_NOUNS.forEach(([fam, re, weak], rank) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      if (!m[0]) { re.lastIndex++; continue; }
      hits.push({ fam, start: m.index, end: m.index + m[0].length, weak: !!weak, rank });
    }
  });
  if (!hits.length) return null;
  // The longest (then highest-priority) noun at each position.
  const better = (a: NounHit, b: NounHit) => (a.end - a.start) - (b.end - b.start) || b.rank - a.rank;
  hits.sort((a, b) => a.start - b.start || -better(a, b));
  const strong = hits.filter(h => !h.weak);
  const pool = strong.length ? strong : hits;
  let head = pool[0];
  const chain: NounHit[] = [head];
  for (const h of pool) {
    if (h === head) continue;
    if (h.start < head.end) {
      // Fix round 3 N5 — overlapping phrases: the longer, more specific one
      // wins ("access control" over "control panel", "time switch" over
      // "switch").
      if (better(h, head) > 0) { chain[chain.length - 1] = h; head = h; }
      continue;
    }
    const gap = t.slice(head.end, h.start);
    // A compound runs on across at most one plain word ("relay/control
    // panel") and — fix round 3 N4 — only within one family (a device may
    // run on to its box / plate / cover, or to the control it is: "switch
    // sensor"); never across to a fixture word ("receptacle strip" is not an
    // LED strip).
    const sameHead = h.fam === head.fam || (head.fam === 'device' && (h.fam === 'box' || h.fam === 'control'));
    if (sameHead && /^[\s/&+-]*(?:[a-z0-9."'#-]+[\s/&+-]*)?$/i.test(gap) && !/[,;()]/.test(gap)) { head = h; chain.push(h); continue; }
    break;
  }
  // A low-voltage system word anywhere in the phrase makes it that system's
  // rough-in ("data outlet", "fire alarm control panel").
  if (chain.some(h => h.fam === 'low_voltage')) return 'low_voltage';
  return head.fam;
}

export function equipmentFamily(text: string, category: string, unit: string, opts: { categoryFallback?: boolean } = {}): EquipmentFamily | null {
  const raw = (text ?? '').toLowerCase();
  if (/^\s*demo(?:lition|lish)?\b|^\s*remov/.test(raw) || /demoli/i.test(category ?? '')) return 'demolition';
  const t = familyText(raw);
  if (unitFamily(unit) === 'LINEAR') {
    const wire = WIRE_RE_FAM.test(t);
    const conduit = CONDUIT_RE_FAM.test(t);
    if (wire && !conduit) return 'wire';
    if (conduit && !wire) return 'conduit';
    if (SITE_RE_FAM.test(t)) return 'site';
    return null;
  }
  // Fix round N2 — a tie-in to a panel is the panel's work.
  if (/\btie-?in to (?:the )?(?:existing )?(?:panel|pnl)\b|\bsub-?panel\b|\bpanel\s+[a-z0-9]{1,3}\s+(?:sub-?)?feed\b/.test(raw)) return 'gear';
  // Fix round N1 — the head noun decides; the category is only the
  // tiebreak when no family noun is recognized at all.
  const head = headFamily(t);
  // N10 — a fixture word followed by a trailing relay / panel / switch /
  // inverter / ballast / driver / base noun that ends the item phrase is
  // that thing, not the fixture ("emergency lighting relay", "exit sign test
  // switch", "emergency ballast", "light pole base").
  if (head === 'fixture') {
    const phrase = t.split(/[,;(]/)[0].trim();
    const trail = phrase.match(/(\S+)\s+(relays?|panels?|switch(?:es)?|inverters?|ballasts?|drivers?|bases?)$/);
    if (trail && !(/^panels?$/.test(trail[2]) && /^(?:led|flat)$/.test(trail[1]))) {
      const noun = trail[2];
      if (/^relay/.test(noun)) return 'control';
      if (/^panel|^inverter/.test(noun)) return 'gear';
      if (/^switch/.test(noun)) return 'device';
      if (/^base/.test(noun)) return 'site';
      return 'accessory';
    }
  }
  if (head) return head;
  return opts.categoryFallback === false ? null : categoryFamily(category, unit);
}

/** Two families that may still fuzzy-match each other: a wall-switch
 *  occupancy sensor is both a control and a device. */
const COMPATIBLE_FAMILIES: Array<[EquipmentFamily, EquipmentFamily]> = [['device', 'control']];

export function familiesConflict(a: EquipmentFamily | null, b: EquipmentFamily | null): boolean {
  if (!a || !b || a === b) return false;
  return !COMPATIBLE_FAMILIES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Price accuracy round C1 — a fuzzy match above these (per library unit,
 *  EA rows) is never priced automatically: it waits for the estimator. */
export const FUZZY_CONFIRM_MATERIAL = 250;
export const FUZZY_CONFIRM_HOURS = 2;
const GEAR_FAMILIES = new Set<EquipmentFamily>(['transformer', 'gear']);

/** C1 — a panel's circuit enumeration (Agent 2's "Branch circuit 20/1 —
 *  Panel A" rows, qty = circuit count). Never an item: a branch-circuit
 *  assembly when the library has one, else unresolved. */
export function isCircuitListRow(line: Pick<NormalizedTakeoffLine, 'description' | 'altText' | 'unit'>): boolean {
  if (unitFamily(line.unit) !== 'EA') return false;
  const texts = [line.description, line.altText ?? ''];
  if (texts.some(t => /^\s*(?:branch\s+)?circuits?\s+(?:[\d?]+\s*\/\s*[\d?]+|list|schedule)\b|^\s*(?:\d{2,3}\s*a?\s*\/\s*[123]\s*p?\s+)?branch circuits?\b/i.test(t))) return true;
  // A bare circuit enumeration: "1 1; 2 1; 3 1; …".
  return texts.some(t => /^\s*\d+\s+\d+\s*(?:;\s*\d+\s+\d+\s*){3,}/.test(t));
}
export const CIRCUIT_LIST_NOTE = 'Branch circuit count — wiring carried by the allowance';

/** C1 — an HVAC / motor / appliance connection row ("A/C Comp Unit #1 …
 *  40A/2P", "Air Handler …"). Maps only to an equipment-connection unit at
 *  its amperage; else unresolved. */
export function isEquipmentConnectionRow(line: Pick<NormalizedTakeoffLine, 'description' | 'altText' | 'unit' | 'category'>): boolean {
  if (unitFamily(line.unit) !== 'EA') return false;
  if (isDemolitionText(line.category, line.description)) return false;
  return lineFamily(line) === 'equipment_connection' && [line.altText, line.description].some(t => !!t && equipmentLoadLeads(familyText(t)));
}

/** The amperage/poles a row states ("40A/2P", "60/3", "30 amp"). */
export function statedAmperage(text: string): { amps: number; poles: number | null } | null {
  const t = text ?? '';
  const m = t.match(/\b(\d{2,3})\s*a(?:mps?)?\s*\/\s*([123])\s*p\b/i) ?? t.match(/\b(\d{2,3})\s*\/\s*([123])\b(?!\s*(?:c\b|"|in))/i);
  if (m) return { amps: Number(m[1]), poles: Number(m[2]) };
  const a = t.match(/\b(\d{2,3})\s*(?:a|amps?)\b/i);
  return a ? { amps: Number(a[1]), poles: null } : null;
}

function candidateAmperage(c: LibraryCandidate): { amps: number; poles: number | null } | null {
  for (const n of [c.name, ...c.aliases]) {
    const a = statedAmperage(n);
    if (a) return a;
  }
  return null;
}

/** B2: normalize the handful of real-world unit spellings AI output and hand
 *  entry both produce down to the canonical EstUnit set. Unrecognized units
 *  (LS/SET/LOT/blank/anything else) pass through unchanged — callers treat
 *  those as "unit unknown", not as EA. */
export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? '').trim().toUpperCase();
  if (u === 'EA' || u === 'EACH') return 'EA';
  if (u === 'LF' || u === 'FT' || u === 'FOOT' || u === 'FEET') return 'LF';
  if (u === 'C' || u === 'M') return u;
  return u;
}

const KNOWN_UNITS = new Set(['EA', 'LF', 'C', 'M']);
// LF/C/M are all "linear count at a different pricing denomination" — the same
// raw qty (feet) just gets divided by 1, 100 or 1000. EA is a fundamentally
// different kind of quantity (a count of discrete things) and must never be
// paired with a linear unit (B1: "If the line unit is incompatible with the
// library unit (EA vs LF), don't match; leave the line unmatched").
export function unitFamily(u: string): 'EA' | 'LINEAR' | 'OTHER' {
  const n = normalizeUnit(u);
  if (n === 'EA') return 'EA';
  if (n === 'LF' || n === 'C' || n === 'M') return 'LINEAR';
  return 'OTHER';
}
export function isUnitCompatible(lineUnit: string, candidateUnit: string): boolean {
  const a = unitFamily(lineUnit);
  const b = unitFamily(candidateUnit);
  // An unrecognized unit on either side can't be judged compatible or not —
  // treat it as incompatible so the line goes to "unmatched" (B2's manual/
  // unit_unknown path) rather than silently mismatching EA against it.
  if (a === 'OTHER' || b === 'OTHER') return false;
  return a === b;
}

// ── Normalization ────────────────────────────────────────────────────────────

// Electrical trade sizes are a small, known set — a generic decimal→fraction
// converter isn't needed, just enough entries to unify how AI output and an
// estimator's own typing both spell the same conduit/box size.
const DECIMAL_TO_FRACTION: Record<string, string> = {
  '.125': '1/8', '0.125': '1/8',
  '.25': '1/4', '0.25': '1/4',
  '.375': '3/8', '0.375': '3/8',
  '.5': '1/2', '0.5': '1/2',
  '.625': '5/8', '0.625': '5/8',
  '.75': '3/4', '0.75': '3/4',
  '.875': '7/8', '0.875': '7/8',
  '1.25': '1-1/4',
  '1.5': '1-1/2',
  '2.5': '2-1/2',
};

/** Lowercase, unify size notation (3/4" / .75" / 3/4 in all become "3/4"), strip
 *  punctuation that carries no matching signal, collapse whitespace.
 *
 *  B3: fractional trade sizes arrive in three written forms that must all
 *  collapse to the SAME single token — "1-1/4\"" (hyphenated), "1 1/4\""
 *  (space-separated whole + fraction), and "1.25\"" (decimal) all become the
 *  one token "1-1/4". Without joining the space-separated form, "1 1/4"
 *  tokenizes as two separate tokens ("1", "1/4") and never matches the
 *  hyphenated library spelling. */
export function normalize(s: string): string {
  let t = (s ?? '').toLowerCase();
  t = t.replace(/(\d*\.\d+)/g, (m) => DECIMAL_TO_FRACTION[m] ?? m);
  t = t.replace(/(\d+)\s+(\d+\/\d+)/g, '$1-$2');
  // Fix round 2 / SF1 — "#" immediately before a number is a WIRE GAUGE
  // marker ("#1 THHN" = 1 AWG), never a trade size — a BARE number next to
  // EMT/PVC/etc ("1\" flex") is a trade size instead. The old code stripped
  // every "#" outright, so "#1" and a bare "1" became the identical token
  // "1" and a wire item could fuzzy-match a conduit/raceway description
  // sharing nothing but that coincidental digit. Marking a gauge as "gaN"
  // keeps the two permanently distinguishable at the token level.
  t = t.replace(/#\s*(\d)/g, 'ga$1');
  t = t.replace(/\b(inch|inches|in)\b\.?/g, ' ');
  t = t.replace(/["']/g, '');
  t = t.replace(/[(),#]/g, ' ');
  t = t.replace(/[.,]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Overlap coefficient — |A∩B| / min(|A|,|B|) — rather than Jaccard, because
 *  takeoff descriptions and library names are short technical phrases where a
 *  couple of shared core nouns (e.g. "duplex", "receptacle") is a real match
 *  even when one side carries extra qualifiers ("spec grade", "20A 125V").
 *  Jaccard's union-based denominator over-penalizes exactly that case.
 *
 *  Plain (unweighted) overlap has a real failure mode within one category:
 *  two assemblies that differ only by a rating ("400A ... service entrance
 *  assembly, NEMA 3R" vs "800A ... service entrance assembly, NEMA 3R")
 *  share almost every generic trade word ("service", "entrance", "assembly",
 *  "nema") and differ only in the one token that actually matters ("400a" vs
 *  "800a") — plain overlap can rank the WRONG rating higher than the RIGHT
 *  one's alias match just by sharing more common words. `weight` down-weights
 *  a token by how many library entries it appears in (a cheap TF-IDF-style
 *  correction, built fresh from the library passed in), so a token unique to
 *  one or two candidates (a size, a rating, a model qualifier) counts far
 *  more than a word every entry in the category shares. */
function overlapScore(a: Set<string>, b: Set<string>, weight: (t: string) => number): number {
  if (a.size === 0 || b.size === 0) return 0;
  let interWeight = 0;
  for (const t of a) if (b.has(t)) interWeight += weight(t);
  const weightSum = (s: Set<string>) => { let w = 0; for (const t of s) w += weight(t); return w; };
  const minWeight = Math.min(weightSum(a), weightSum(b));
  return minWeight > 0 ? interWeight / minWeight : 0;
}

/** Document frequency of each token across every candidate's name+aliases (each
 *  candidate counts a token at most once, even if it repeats across its own
 *  aliases) — the basis for down-weighting common trade words in overlapScore. */
/** Price accuracy round C3 — the generated allowance units (ALW-*) are
 *  reached only by their exact name (the allowance rows name them); they
 *  never fuzzy/alias-match a real takeoff line ("Support hardware allowance
 *  — per fixture" is not a fixture) and never weigh on token frequencies. */
export function isExactOnlyCandidate(c: Pick<LibraryCandidate, 'code'>): boolean {
  return /^ALW-/.test(c.code ?? '');
}

/** Fix round nit — the demolition units' words ("pole", "fixture",
 *  "receptacle") weigh only on demolition lines: a demolition row can never
 *  match a new-work line, so it must not dilute a new-work line's tokens. */
interface TokenFreqs { demolition: Map<string, number>; general: Map<string, number> }
function buildTokenFreqs(library: LibraryCandidate[]): TokenFreqs {
  return {
    demolition: buildTokenDocFreq(library),
    general: buildTokenDocFreq(library.filter(c => !isDemolitionCandidate(c.category, c.name))),
  };
}

function buildTokenDocFreq(library: LibraryCandidate[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of library) {
    if (isExactOnlyCandidate(c)) continue;
    const seen = new Set<string>();
    for (const n of [c.name, ...c.aliases]) for (const t of tokens(n)) seen.add(t);
    for (const t of seen) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

const FUZZY_THRESHOLD = 0.4;
const CATEGORY_BONUS = 0.2;
const UNIT_BONUS = 0.05;

// B3/R2-SF1: raceway/wire-TYPE families that must agree when a description
// names one — "3/4 EMT" must never fuzzy/alias-match a THHN wire item, an
// RMC (rigid) item, an LFMC item, etc, even if they share generic trade
// words or a bare size number. 'rigid' folds into 'rmc' (commonly written
// "rigid"); 'flex'/'fmc' and 'liquidtight'/'lfmc' are each their own family,
// distinct from one another and from EMT/PVC/RMC — a generic "3/4\" conduit"
// (no type word at all) must never alias-match "liquidtight flexible metal
// conduit" just because "conduit" is a substring of that name (see the
// under-specified-description guard below, which uses this same tag set).
const MATERIAL_TAGS: Record<string, string> = {
  emt: 'emt', pvc: 'pvc', rmc: 'rmc', rigid: 'rmc', mc: 'mc', thhn: 'thhn', thwn: 'thhn',
  flex: 'fmc', fmc: 'fmc', liquidtight: 'lfmc', lfmc: 'lfmc',
};
// R2-SF1 — conductor MATERIAL (aluminum vs copper) is a separate dimension
// from raceway/wire type: a THHN wire item is implicitly copper (this seed
// library has no aluminum conductor items at all), and XHHW is tagged
// aluminum per the reviewer's own grouping — "#4/0 aluminum XHHW" must never
// fuzzy-match a copper THHN item on shared generic wire words.
const CONDUCTOR_TAGS: Record<string, string> = {
  aluminum: 'aluminum', al: 'aluminum', xhhw: 'aluminum',
  copper: 'copper', cu: 'copper', thhn: 'copper', thwn: 'copper',
};
function tagsOf(tokenSet: Set<string>, table: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokenSet) {
    // A compound token like "thhn/thwn" (normalize() only strips the slash
    // when it's surrounded by whitespace, not inside a word) must still be
    // read as naming THHN — split on '/' before the exact-tag lookup.
    for (const part of t.split('/')) {
      const tag = table[part];
      if (tag) out.add(tag);
    }
  }
  return out;
}
function materialTagsOf(tokenSet: Set<string>): Set<string> {
  return tagsOf(tokenSet, MATERIAL_TAGS);
}
function conductorTagsOf(tokenSet: Set<string>): Set<string> {
  return tagsOf(tokenSet, CONDUCTOR_TAGS);
}
/** True when both sides name a material type and they disagree — e.g. desc
 *  says "emt" and the candidate is a "thhn" wire item. Neither side naming a
 *  material type is not a conflict (most items don't care). */
function materialConflict(aTags: Set<string>, bTags: Set<string>): boolean {
  if (aTags.size === 0 || bTags.size === 0) return false;
  for (const t of aTags) if (bTags.has(t)) return false;
  return true;
}

// Review round 2 / B3 — a raceway line ("3/4 EMT") must never alias/fuzzy-
// match a FITTING for that same raceway type (a coupling, connector, strap,
// bushing, locknut, adapter or elbow) just because they share a material tag
// (both "emt") and a size: {3/4, emt} is a token SUBSET of "3/4 Connector -
// EMT Set Screw Steel" (real regression: the takeoff mapper priced a 1,200 LF
// run of 3/4 EMT as if every foot were one $ea EMT connector). A fitting word
// in the text always wins over the bare-raceway fallback below - a
// description that explicitly says "EMT coupling" IS a coupling, not
// conduit. This is a separate dimension from MATERIAL_TAGS (which already
// correctly keeps EMT from matching a THHN wire item): two names can share
// the identical material tag and still be a hard conflict here.
const FITTING_KIND_WORDS: Record<string, string> = {
  coupling: 'coupling', connector: 'connector', strap: 'strap', clamp: 'strap', clip: 'strap',
  bushing: 'bushing', locknut: 'locknut', adapter: 'adapter', elbow: 'elbow',
  // A generic "fitting" word (e.g. "Expansion fitting, conduit") is a
  // fitting too, even though it names no OTHER specific fitting word —
  // found in testing alongside accubidImport.ts's own identical fix.
  fitting: 'fitting', fittings: 'fitting',
  // "Conduit body (LB/T), EMT or rigid" names no other fitting word and
  // carries an EMT/rigid material tag, so without this it falls through to
  // the bare-conduit material-tag inference below and collides with a real
  // run of EMT conduit on the same raceway kind — same bug shape as
  // accubidImport.ts's identical "conduit body" fix, mirrored here so the
  // mapper's alias/fuzzy guard agrees with import reconciliation.
  body: 'fitting',
};
const RACEWAY_MATERIALS = new Set(['emt', 'pvc', 'rmc', 'fmc', 'lfmc']);

/** null = "no raceway/fitting kind named" (never a conflict with anything -
 *  most items, e.g. a duplex receptacle, don't participate in this guard at
 *  all). A fitting word (checked first) always wins; otherwise a raceway
 *  material tag with no fitting word implies bare conduit/raceway. */
function racewayKind(tokenSet: Set<string>, materialTags: Set<string>): string | null {
  for (const t of tokenSet) {
    const kind = FITTING_KIND_WORDS[t];
    if (kind) return kind;
  }
  for (const tag of materialTags) if (RACEWAY_MATERIALS.has(tag)) return 'conduit';
  return null;
}
function racewayKindConflict(a: string | null, b: string | null): boolean {
  return a != null && b != null && a !== b;
}

// Review round 2 / N-R2-4 — matching kind NAME alone ("connector" ==
// "connector") isn't enough for a FITTING: "3/4\" EMT connector" must never
// match an accubid-imported lighting-track part just because both are
// tagged "connector" — a real EMT connector's own name says EMT (or another
// raceway material), and a live-end-feed track connector's doesn't.
// "Fittings match on size plus raceway type" (the decision's own words) —
// size is already covered by the existing spec/rating-conflict guard
// (hasConflictingSpec); this adds the raceway-type half for the FITTING
// kinds specifically. 'conduit' is excluded here: two bare raceway runs
// ("3/4\" EMT" vs "3/4\" conduit") disagreeing on named material is already
// caught by the ordinary materialConflict check above (which requires both
// sides to actually name a *different* material — not just "one names
// none"), so re-requiring a shared tag for 'conduit' would wrongly reject a
// legitimate generic-vs-specific raceway alias.
function fittingKindNeedsMaterialMatch(kind: string | null): kind is string {
  return kind != null && kind !== 'conduit';
}
function sharesMaterialTag(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

// Review round 2 / R2-S1 — an item's kind comes from its PRIMARY (head) noun,
// not from every word that happens to appear in its name. "3/4\" EMT conduit
// w/ fittings", "2\" rigid steel conduit (incl. fittings)" and the seed
// catalog's own all-in raceway items ("3/4\" EMT (incl. couplings/straps)",
// "…(incl. fittings/glue)") are all RACEWAY — "fittings"/"couplings"/
// "straps"/"glue" there is a QUALIFIER PHRASE ("incl.", "including", "w/",
// "with" + the word) noting what the price bundles in, never the head noun.
// A genuine fitting product ("Expansion fitting, conduit", "Coupling - EMT
// Set Screw Steel", "Conduit body (LB/T)") never carries that qualifier-
// phrase shape — "fitting"/"coupling"/"body" is the very first word, not a
// trailing note — so it's unaffected. Stripping the qualifier phrase before
// classifying restores every match this over-broad guard (99d9453) took
// away, without giving back the false match it was added to prevent.
const RACEWAY_QUALIFIER_WORD = '(?:fittings?|couplings?|straps?|clips?|clamps?|glue)';
const RACEWAY_QUALIFIER_RE = new RegExp(
  `\\b(?:incl|including|w/|with)\\s+${RACEWAY_QUALIFIER_WORD}(?:\\s*[/,]\\s*${RACEWAY_QUALIFIER_WORD})*\\b`,
  'g'
);

/** racewayKind, but computed from RAW normalized text (post-normalize(), pre-
 *  tokenize) so the qualifier-phrase strip above can see and remove multi-
 *  word / slash-joined phrases a Set<string> token bag has already lost the
 *  adjacency to detect ("couplings/straps" tokenizes as ONE token; "w/" and
 *  "fittings" are two SEPARATE tokens with no record they were adjacent). */
function racewayKindFromNormalizedText(normText: string): string | null {
  const stripped = normText.replace(RACEWAY_QUALIFIER_RE, ' ');
  const tokenSet = new Set(stripped.split(' ').filter(Boolean));
  return racewayKind(tokenSet, materialTagsOf(tokenSet));
}

// "Schedule 40"/"Schedule 80" is a real, common conduit-material qualifier —
// its number is NOT a size or rating and must never trip the conflict guard
// below (real seed regression: "4\" PVC" was failing to alias-match its own
// PVC-400 item, whose full name is "4\" PVC Sch 40, underground...", because
// the bare "40" from "Sch 40" looked like an unmatched conflicting spec).
function scheduleDigits(normalizedText: string): Set<string> {
  const out = new Set<string>();
  const re = /\bsch(?:edule)?\s+(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizedText))) out.add(m[1]);
  return out;
}

/** A rating/size token ("400a", "800a", "3/4", "2x4"...) that `nTokens` carries
 *  but `descTokens` does NOT is a conflicting spec, not a missing qualifier —
 *  down-weighting alone isn't enough to stop two otherwise near-identical
 *  names ("400A ... service entrance assembly" vs "800A ... service entrance
 *  assembly") from out-scoring each other on shared trade words. Applied to
 *  every match tier (B3) — exact matches trivially pass since descNorm===n
 *  implies identical tokens. `ignoreDigits` excludes numbers that are part of
 *  a "Schedule NN" callout, not a size/rating. */
function hasConflictingSpec(nTokens: Set<string>, descTokens: Set<string>, ignoreDigits: Set<string>): boolean {
  for (const t of nTokens) if (/\d/.test(t) && !descTokens.has(t) && !ignoreDigits.has(t)) return true;
  return false;
}

function tokenSubsetMatch(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

interface Scored {
  candidate: LibraryCandidate;
  baseScore: number; // before category/unit bonuses — informational only
  confidence: MapConfidence;
  rankScore: number; // baseScore + bonuses — used to rank WITHIN a confidence tier only
}

function scoreCandidate(
  descNorm: string,
  descTokens: Set<string>,
  altNorm: string,
  altTokens: Set<string>,
  line: NormalizedTakeoffLine,
  candidate: LibraryCandidate,
  tokenWeight: (t: string) => number,
): Scored {
  const nameNorm = normalize(candidate.name);
  let baseScore = 0;
  let confidence: MapConfidence = 'none';

  // Merged description tokens (primary + secondary field) widen alias/fuzzy
  // recall (B3 item/spec field-choice fix) without weakening exact match,
  // which is checked against the primary and secondary texts individually.
  const mergedTokens = altTokens.size > 0 ? new Set([...descTokens, ...altTokens]) : descTokens;

  const names = [nameNorm, ...candidate.aliases.map(normalize)];
  for (const n of names) {
    if (!n) continue;
    if (n === descNorm || (altNorm && n === altNorm)) {
      baseScore = 1;
      confidence = 'exact';
      break;
    }
  }
  const descMaterialTags = materialTagsOf(mergedTokens);
  const descConductorTags = conductorTagsOf(mergedTokens);
  // Review round 2 / R2-S1 — computed from raw normalized TEXT (merging
  // descNorm+altNorm the same way mergedTokens merges their token sets), not
  // from the already-tokenized mergedTokens: the qualifier-phrase strip
  // needs the adjacency a Set<string> has already discarded (see
  // racewayKindFromNormalizedText's own comment).
  const descRacewayKind = racewayKindFromNormalizedText(altNorm ? `${descNorm} ${altNorm}` : descNorm);
  if (confidence !== 'exact') {
    for (const n of names) {
      if (!n) continue;
      const nTokens = tokens(n);
      if (nTokens.size === 0) continue;
      if (hasConflictingSpec(nTokens, mergedTokens, scheduleDigits(n))) continue;
      const nMaterialTags = materialTagsOf(nTokens);
      if (materialConflict(descMaterialTags, nMaterialTags)) continue;
      if (materialConflict(descConductorTags, conductorTagsOf(nTokens))) continue;
      // Review round 2 / B3 — "3/4 EMT" (kind: conduit) must never alias-
      // match "3/4 Connector - EMT Set Screw Steel" (kind: connector) even
      // though neither materialConflict above fires (both are tagged "emt").
      const nRacewayKindAlias = racewayKindFromNormalizedText(n);
      if (racewayKindConflict(descRacewayKind, nRacewayKindAlias)) continue;
      // N-R2-4 — same fitting kind on both sides isn't enough; they must
      // also share a raceway material tag (see fittingKindNeedsMaterialMatch).
      if (fittingKindNeedsMaterialMatch(descRacewayKind) && descRacewayKind === nRacewayKindAlias
        && !sharesMaterialTag(descMaterialTags, nMaterialTags)) continue;
      // R2-SF1 — a candidate that NAMES a raceway/wire type (EMT/PVC/RMC/MC/
      // FMC/LFMC/THHN) can't earn alias-tier confidence off a description
      // that names NO type at all — "3/4\" conduit" sharing only the
      // generic words "conduit"+size with "liquidtight flexible metal
      // conduit" is exactly the false alias match the review flagged. A
      // description that DOES name a type is unaffected (materialConflict
      // above already guards disagreement; this guards under-specification).
      if (nMaterialTags.size > 0 && descMaterialTags.size === 0) continue;
      // Token-boundary containment, not substring — a raw substring check lets
      // "4 emt" match inside "3/4 emt" (the "4" falls right after the "/"),
      // which is exactly the false alias match the review flagged.
      if (tokenSubsetMatch(nTokens, mergedTokens) || tokenSubsetMatch(mergedTokens, nTokens)) {
        baseScore = Math.max(baseScore, 0.85);
        confidence = 'alias';
      }
    }
  }
  if (confidence === 'none') {
    let best = 0;
    for (const n of names) {
      if (!n) continue;
      const nTokens = tokens(n);
      if (hasConflictingSpec(nTokens, mergedTokens, scheduleDigits(n))) continue;
      const nMaterialTags = materialTagsOf(nTokens);
      if (materialConflict(descMaterialTags, nMaterialTags)) continue;
      if (materialConflict(descConductorTags, conductorTagsOf(nTokens))) continue;
      const nRacewayKindFuzzy = racewayKindFromNormalizedText(n);
      if (racewayKindConflict(descRacewayKind, nRacewayKindFuzzy)) continue; // review round 2 / B3, same rationale as the alias tier above
      if (fittingKindNeedsMaterialMatch(descRacewayKind) && descRacewayKind === nRacewayKindFuzzy
        && !sharesMaterialTag(descMaterialTags, nMaterialTags)) continue; // N-R2-4, same rationale as the alias tier above
      if (nMaterialTags.size > 0 && descMaterialTags.size === 0) continue; // R2-SF1, same rationale as the alias tier above
      best = Math.max(best, overlapScore(mergedTokens, nTokens, tokenWeight));
    }
    baseScore = best;
    confidence = best >= FUZZY_THRESHOLD ? 'fuzzy' : 'none';
  }

  let rankScore = baseScore;
  // N4/B4: canonicalize the takeoff line's category before comparing — Agent
  // 2's own categorization prompt emits a shorter, slash-free spelling for
  // three of these ("Exterior Site Lighting" vs the seed's canonical
  // "Exterior / Site Lighting") that would otherwise never earn the bonus.
  if (candidate.category.toLowerCase() === canonicalizeTakeoffCategory(line.category).toLowerCase()) rankScore += CATEGORY_BONUS;
  if (candidate.unit === line.unit) rankScore += UNIT_BONUS;

  return { candidate, baseScore, confidence, rankScore };
}

const TIER_RANK: Record<MapConfidence, number> = { exact: 3, alias: 2, fuzzy: 1, none: 0 };

/** Deterministic tie-break WITHIN one confidence tier, same rankScore: an
 *  assembly beats a bare item (unchanged); failing that, a curated row
 *  (seed/manual/calibrated) beats a raw, unreconciled Accubid-imported row —
 *  review round 2 / B3: library.ts's own `ORDER BY category, name` used to
 *  let raw import order decide this (an "3/4 Connector..." ACB row sorting
 *  before the seed "3/4 EMT" item was the exact tie B3 reproduced). Neither
 *  rule fires, keep whichever the caller already had (the earlier candidate
 *  in iteration order — unchanged, deterministic default). */
function preferCandidate(a: LibraryCandidate, b: LibraryCandidate): boolean {
  if (a.kind === 'assembly' && b.kind !== 'assembly') return true;
  if (a.kind !== 'assembly' && b.kind === 'assembly') return false;
  const aAccubid = a.source === 'accubid';
  const bAccubid = b.source === 'accubid';
  if (!aAccubid && bAccubid) return true;
  if (aAccubid && !bAccubid) return false;
  return false;
}

/** Remodel + footage round (B3) — a demolition line only ever resolves to a
 *  demolition item (the seed's 'Demolition' category, or an Accubid-imported
 *  "Demolition - ..." row, whatever category the import gave it), and a
 *  new-work line never resolves to one: removing a 2x4 fluorescent is 0.31 h
 *  and $0, installing a 2x4 troffer is neither. */
function isDemolitionText(category: string, text: string): boolean {
  const t = text ?? '';
  const c = category ?? '';
  // Re-check NSF-1 — relocating, reinstalling or replacing is INSTALL work
  // (Builder A: relocated = install), and "Demonstration kitchen" is a room.
  if (NOT_DEMOLITION_RE.test(t) || NOT_DEMOLITION_RE.test(c)) return false;
  return DEMOLITION_CATEGORY_RE.test(c) || DEMOLITION_TEXT_RE.test(t);
}
function isDemolitionCandidate(category: string, name: string): boolean {
  return /^\s*demolition\b/i.test(category ?? '') || /^\s*demolition\b/i.test(name ?? '');
}
// Fix round SF-1 / re-check NSF-1 — the category may say Demo / Demolition /
// Removals anywhere; the TEXT must START with demo / demolish / remove (or
// say "existing … to be removed"), so "…, replace removed device" is not a
// demolition line.
const NOT_DEMOLITION_RE = /relocat|re-?install|\breplac|remove\s*(?:and|&)\s*reinstall|demonstration/i;
const DEMOLITION_CATEGORY_RE = /\bdemo(?:lition|lish(?:ed)?)?\b|\bremov(?:e|al|als)\b/i;
const DEMOLITION_TEXT_RE = /^\s*(?:demo(?:lition|lish(?:ed)?)?|remov(?:e|al|ed))\b|\bexisting\b.*\bto be removed\b/i;

export type DemolitionClass = 'jbox' | 'receptacle' | 'switch-3way' | 'switch' | 'exit-em' | 'hid' | 'fixture'
  // Price accuracy round C5 — the classes that had no unit.
  | 'equipment' | 'control' | 'site-pole' | 'exterior' | 'device';
/** Re-check should-fix — a demolition line only ever maps to a demolition
 *  unit of the SAME device class; no class → no match (the line stays
 *  unresolved for the estimator), never a fuzzy cross-class match. */
export function demolitionClass(text: string): DemolitionClass | null {
  // Final review SF-B — "light switch" is a switch; "switch height" is a
  // mounting height; "complete with lamps" is still one fixture; lump-sum
  // wording only counts when it LEADS the line ("Demo all …", "Remove all
  // …", "LS", "lot") — "all 18 on A2.0" after one class is that class.
  if (isLumpSumText(text ?? '')) return null;
  const t = (text ?? '')
    .replace(/\blight ?switch(es)?\b/gi, 'switch')
    .replace(/\bswitch (?:height|level|side|leg)\b/gi, ' ')
    .replace(/\bcomplete with\b/gi, 'with');
  const classes: DemolitionClass[] = [];
  // Fix round S3 — a phone / data outlet is a device (other), never a
  // receptacle; "exterior" / "canopy" are locations, never a class by
  // themselves; a receptacle "on timer" is a receptacle.
  const lowVoltageOutlet = /telephone|\bphone\b|\bdata\b|\btel\b/i.test(t);
  if (/junction|\bj-?box\b/i.test(t)) classes.push('jbox');
  if (!lowVoltageOutlet && /recept|outlet|duplex|\bgfci?\b/i.test(t)) classes.push('receptacle');
  // C5 — a disconnect / safety switch / equipment connection is equipment,
  // and a sensor / timer / time switch a lighting control — never a switch.
  const equipment = /disconnect|safety switch|equipment connection/i.test(t);
  const control = !classes.length && /occupancy|vacancy|\bsensors?\b|time ?clock|time ?switch|timer|photo ?cells?|lighting control/i.test(t);
  if (equipment) classes.push('equipment');
  else if (control) classes.push('control');
  else if (/switch/i.test(t)) classes.push(/3-?way|three.?way/i.test(t) ? 'switch-3way' : 'switch');
  // One luminaire family (site pole > exit-em > HID > exterior > fixture),
  // counted once — only when no device / box / equipment class was found
  // ("exterior light switch" is a switch). "Switch 1 pole" is not a pole light.
  if (!classes.length && !lowVoltageOutlet) {
    if (/site pole|pole light|light pole|pole[- ]mounted|area light/i.test(t)) classes.push('site-pole');
    else if (/\bexit\b|emergency|egress|bug ?eye/i.test(t)) classes.push('exit-em');
    else if (/\bhid\b|high ?bay|metal halide/i.test(t)) classes.push('hid');
    else if (/wall ?pack|canopy (?:light|fixture|luminaire)|flood ?light|building.mounted|exterior (?:fixture|light|luminaire|lighting)/i.test(t)) classes.push('exterior');
    else if (/fluor|troffer|fixture|luminaire|\blight\b|lighting|pendant|downlight|\bcan\b|strip|wrap|lamp/i.test(t)) classes.push('fixture');
  }
  // Anything else that is a device (a phone / data outlet, "device (other)").
  if (!classes.length && (lowVoltageOutlet || /\bdevices?\b/i.test(t))) classes.push('device');
  return classes.length === 1 ? classes[0] : null;
}

function isLumpSumText(t: string): boolean {
  return /^\s*(?:(?:demo(?:lition|lish)?|remov(?:e|al))\s*[—:–-]?\s*(?:of\s+)?(?:the\s+)?)?(?:all|entire|lump.?sum|ls|lot)\b/i.test(t);
}

/** A demolition line that names more than one device class, or reads as a
 *  lot ("all existing …"): it needs a breakdown before it can be priced. */
export function isLumpSumDemolition(category: string, text: string): boolean {
  if (!isDemolitionText(category, text)) return false;
  return isLumpSumText(text) || demolitionClass(text) == null;
}

const familyCache = new WeakMap<LibraryCandidate, EquipmentFamily | null>();
export function candidateFamily(c: LibraryCandidate): EquipmentFamily | null {
  if (familyCache.has(c)) return familyCache.get(c)!;
  const f = isDemolitionCandidate(c.category, c.name) ? 'demolition' : equipmentFamily(c.name, c.category, c.unit);
  familyCache.set(c, f);
  return f;
}

/** C1 — the family a takeoff line belongs to: its primary text first, then
 *  the other field, then its category. */
export function lineFamily(line: Pick<NormalizedTakeoffLine, 'description' | 'altText' | 'category' | 'unit'>): EquipmentFamily | null {
  // The takeoff row's own item text (altText, when it is words, not an
  // id) names the thing; the spec field is often a note ("Wired via CMR-9
  // sensor"), so the item text is read first.
  for (const t of [line.altText, line.description]) {
    if (!t) continue;
    const f = equipmentFamily(t, line.category, line.unit, { categoryFallback: false });
    if (f) return f;
  }
  return equipmentFamily('', line.category, line.unit);
}

/** Fix round 3 — the family a line's own words name (a head noun in its
 *  item text or spec), or null when only its category could say. */
export function confidentLineFamily(line: Pick<NormalizedTakeoffLine, 'description' | 'altText' | 'category' | 'unit'>): EquipmentFamily | null {
  for (const t of [line.altText, line.description]) {
    if (!t) continue;
    const f = equipmentFamily(t, line.category, line.unit, { categoryFallback: false });
    if (f) return f;
  }
  return null;
}

/** Fix round 3 safety net — which families a takeoff category can hold
 *  (Branch Power ↔ devices / boxes / connections / wire; Interior Lighting
 *  ↔ fixtures / controls; Low Voltage ↔ low voltage …). */
export const CATEGORY_FAMILIES: Record<string, EquipmentFamily[]> = {
  'Service & Distribution': ['gear', 'transformer', 'disconnect', 'wire', 'conduit', 'equipment_connection'],
  'Interior Lighting': ['fixture', 'control'],
  'Exterior / Site Lighting': ['fixture', 'control'],
  'Lighting Controls': ['control', 'device'],
  // Fix round 4 — Agent 2 files panels and their timers / lighting-control
  // panels under Branch Power too (36th "PANEL B — sub panel", Kissimmee "ALC
  // — lighting control panel", 36th "TC — VP24 time switch").
  'Branch Power': ['device', 'box', 'equipment_connection', 'disconnect', 'wire', 'conduit', 'fitting', 'gear', 'control'],
  'Site / Underground / Allowances': ['site', 'conduit', 'wire', 'box'],
  'Low Voltage Infrastructure (Conduit & Boxes Only)': ['low_voltage', 'box', 'conduit'],
  'Grounding': ['grounding', 'wire'],
  'Demolition': ['demolition'],
};

export function categoryAllowsFamily(category: string, family: EquipmentFamily): boolean {
  // A demolition line is demolition whatever category Agent 2 filed it under.
  if (family === 'demolition') return true;
  const fams = CATEGORY_FAMILIES[canonicalizeTakeoffCategory(category ?? '')];
  return !!fams && fams.includes(family);
}

/** Fix round 3 — the STRUCTURAL safety net under every text rule: a fuzzy
 *  match prices on its own only when the line's family is known from its
 *  words, the library row is that same family, and the line's category can
 *  hold that family. Anything else is held for the estimator ("check
 *  match"), never priced silently. Returns the hold reason, or null. */
export function fuzzySafetyHold(line: NormalizedTakeoffLine, candidate: LibraryCandidate): string | null {
  // A "NEEDS FOOTAGE — …" run prices from its own spec (footageSpecPricing).
  if (/^\s*needs footage\b/i.test(line.description)) return null;
  const fam = confidentLineFamily(line);
  const candFam = candidateFamily(candidate);
  if (!fam) return `Check match: the line's own words don't say what it is — fuzzy match to ${candidate.name} held until confirmed`;
  if (candFam !== fam) return `Check match: the line reads as ${fam.replace(/_/g, ' ')}, ${candidate.name} is ${candFam ? candFam.replace(/_/g, ' ') : 'unclassified'} — held until confirmed`;
  if (!categoryAllowsFamily(line.category, fam)) return `Check match: a ${fam.replace(/_/g, ' ')} under "${line.category}" — fuzzy match to ${candidate.name} held until confirmed`;
  return null;
}

/** Fix round 4 (N8 / N9) — the same net on the ALIAS tier: an alias match
 *  prices on its own only when the line is classifiable from its own words
 *  (and says more than one bare word), the library row is that same family,
 *  and the category can hold it. Exact description matches are untouched. */
export function aliasSafetyHold(line: NormalizedTakeoffLine, candidate: LibraryCandidate): string | null {
  if (/^\s*needs footage\b/i.test(line.description)) return null;
  // A size / gauge counts as a word ("3/4\" EMT", "#12 THHN" say what they are).
  const words = (t: string | null | undefined) => normalize(t ?? '').split(' ').filter(w => /[a-z]{2,}|\d/.test(w));
  const own = [line.description, line.altText].filter((t): t is string => !!t && !/^count pending/i.test(t));
  if (own.every(t => words(t).length <= 1)) return `Check match: "${line.altText || line.description}" is a single word — alias match to ${candidate.name} held until confirmed`;
  const fam = confidentLineFamily(line);
  const candFam = candidateFamily(candidate);
  if (!fam) return `Check match: the line's own words don't say what it is — alias match to ${candidate.name} held until confirmed`;
  if (candFam !== fam) return `Check match: the line reads as ${fam.replace(/_/g, ' ')}, ${candidate.name} is ${candFam ? candFam.replace(/_/g, ' ') : 'unclassified'} — held until confirmed`;
  if (!categoryAllowsFamily(line.category, fam)) return `Check match: a ${fam.replace(/_/g, ' ')} under "${line.category}" — alias match to ${candidate.name} held until confirmed`;
  return null;
}

function confirmReasonFor(candidate: LibraryCandidate): string | null {
  const fam = candidateFamily(candidate);
  if (fam && GEAR_FAMILIES.has(fam)) return `Fuzzy match into ${fam === 'transformer' ? 'a transformer' : 'gear'} (${candidate.name}) — confirm it before it prices`;
  if (unitFamily(candidate.unit) !== 'EA') return null;
  if (candidate.materialCost != null && candidate.materialCost > FUZZY_CONFIRM_MATERIAL) {
    return `Fuzzy match to ${candidate.name} at $${candidate.materialCost.toFixed(2)} material each — confirm it before it prices`;
  }
  if (candidate.laborHours != null && candidate.laborHours > FUZZY_CONFIRM_HOURS) {
    return `Fuzzy match to ${candidate.name} at ${candidate.laborHours} h each — confirm it before it prices`;
  }
  return null;
}

function mapTakeoffLineWithFreq(line: NormalizedTakeoffLine, library: LibraryCandidate[], freq: TokenFreqs): MappedLine {
  // C1 — a panel's circuit list is never an item.
  if (isCircuitListRow(line) && !isDemolitionText(line.category, line.description)) {
    const asm = library.find(c => isUnitCompatible(line.unit, c.unit) && !isDemolitionCandidate(c.category, c.name)
      && [c.name, ...c.aliases].some(n => /\bbranch circuits?\b/i.test(n) && !/allowance|conduit|wire|\bemt\b/i.test(n)));
    return finishMapped(line, asm ? { candidate: asm, baseScore: 0.85, confidence: 'alias', rankScore: 0.85 } : null,
      null, asm ? null : CIRCUIT_LIST_NOTE);
  }
  // Fix round 3 N4 — plugmold / multi-outlet / receptacle strip: a
  // plugmold unit when the library has one, else unresolved — never an LED
  // strip, never a duplex receptacle circuit.
  const PLUGMOLD_RE = /plug-?mold|multi-?outlet|(?:receptacle|outlet) strips?/i;
  if (unitFamily(line.unit) === 'EA' && !isDemolitionText(line.category, line.description)
    && [line.description, line.altText ?? ''].some(t => PLUGMOLD_RE.test(t))) {
    const unit = library.find(c => isUnitCompatible(line.unit, c.unit) && !isDemolitionCandidate(c.category, c.name)
      && [c.name, ...c.aliases].some(n => PLUGMOLD_RE.test(n)));
    return finishMapped(line, unit ? { candidate: unit, baseScore: 0.85, confidence: 'alias', rankScore: 0.85 } : null, null,
      unit ? null : 'Plugmold / multi-outlet strip — no plugmold unit in the library; price it by hand or pick a unit');
  }
  // C1 — an HVAC / motor connection maps only to an equipment-connection
  // unit at its stated amperage (and poles, when both say), else stays
  // unresolved — never a transformer, a j-box or a kitchen connection.
  if (isEquipmentConnectionRow(line)) {
    // The library's own exact name (or an equipment-connection alias) for
    // this row still wins — a "Motor termination … #6" row imported from
    // Chris's BOM is its own unit.
    const normal = mapNormalLine(line, library, freq);
    const normalCandidate = normal.matchedId ? library.find(c => c.id === normal.matchedId && c.kind === normal.matchedKind) : undefined;
    if (normal.matchConfidence === 'exact' || (normal.matchConfidence === 'alias' && normalCandidate
      && (candidateFamily(normalCandidate) === 'equipment_connection' || candidateFamily(normalCandidate) === 'disconnect'))) return normal;
    const amp = statedAmperage(`${line.description} ${line.altText ?? ''}`);
    const pick = amp ? library.find(c => {
      if (!isUnitCompatible(line.unit, c.unit) || candidateFamily(c) !== 'equipment_connection') return false;
      const ca = candidateAmperage(c);
      return !!ca && ca.amps === amp.amps && (ca.poles == null || amp.poles == null || ca.poles === amp.poles);
    }) : undefined;
    if (pick) return finishMapped(line, { candidate: pick, baseScore: 0.85, confidence: 'alias', rankScore: 0.85 }, null, null);
    const ampText = amp ? `${amp.amps}A${amp.poles ? `/${amp.poles}P` : ''}` : 'no amperage stated';
    return finishMapped(line, null, null,
      `Equipment connection (${ampText}) — no equipment-connection unit ${amp ? 'at that amperage ' : ''}in the library; price it by hand or pick a unit`);
  }
  return mapNormalLine(line, library, freq);
}

function mapNormalLine(line: NormalizedTakeoffLine, library: LibraryCandidate[], freqs: TokenFreqs): MappedLine {
  const lineIsDemolition = isDemolitionText(line.category, line.description);
  const lineFam = lineIsDemolition ? 'demolition' : lineFamily(line);
  const lineDemoClass = lineIsDemolition ? demolitionClass(`${line.description} ${line.altText ?? ''}`) : null;
  const descNorm = normalize(line.description);
  const descTokens = tokens(line.description);
  const altNorm = line.altText ? normalize(line.altText) : '';
  const altTokens = line.altText ? tokens(line.altText) : new Set<string>();
  const freq = lineIsDemolition ? freqs.demolition : freqs.general;
  const lineText = `${line.description} ${line.altText ?? ''}`;
  // Fix round 4 N8 — the timer rules apply only when the line itself reads
  // as a control ("a receptacle on a time clock" is a receptacle).
  const lineIsControl = !lineIsDemolition && confidentLineFamily(line) === 'control';
  const timerLine = lineIsControl && /\btimers?\b|time ?switch|time ?clock|astronomic|\bvp24\b/i.test(lineText);
  const countdownTimer = /countdown|\bfans?\b|exhaust|\bminutes?\b|\bmin\b|spring.?wound|in-?wall timer|bath(?:room)? timer/i.test(lineText) && /\btimers?\b/i.test(lineText);
  const tokenWeight = (t: string) => 1 / (1 + (freq.get(t) ?? 0));

  let best: Scored | null = null;
  for (const candidate of library) {
    // B1: never match across an EA/linear-unit boundary, no matter how well
    // the text scores — a "3/4 EMT, 1200 LF" line must never resolve to an
    // each-priced device just because the words overlap.
    if (!isUnitCompatible(line.unit, candidate.unit)) continue;
    const candidateIsDemo = isDemolitionCandidate(candidate.category, candidate.name);
    if (candidateIsDemo !== lineIsDemolition) continue;
    if (lineIsDemolition && (lineDemoClass == null || demolitionClass(candidate.name) !== lineDemoClass)) continue;
    const scored = scoreCandidate(descNorm, descTokens, altNorm, altTokens, line, candidate, tokenWeight);
    if (scored.confidence === 'none') continue;
    if (scored.confidence !== 'exact' && isExactOnlyCandidate(candidate)) continue;
    // Fix round 3 N7 — a timer / time switch / astronomic control (a VP24 …)
    // is never a plain wall switch; a countdown or fan timer is never the
    // 24-hour time switch.
    if (scored.confidence !== 'exact' && timerLine && candidateFamily(candidate) === 'device') continue;
    if (scored.confidence !== 'exact' && (countdownTimer || !lineIsControl) && /time ?switch|time ?clock/i.test(candidate.name)) continue;
    // C1 — a fuzzy match never crosses equipment families.
    if (scored.confidence === 'fuzzy' && familiesConflict(lineFam, candidateFamily(candidate))) continue;
    if (!best) { best = scored; continue; }
    const curTier = TIER_RANK[scored.confidence];
    const bestTier = TIER_RANK[best.confidence];
    // Confidence tier always wins first — a fuzzy match can never outrank a
    // true alias/exact match just because it happens to share this line's
    // category+unit (B3: "category bonus lets fuzzy outrank alias"). rankScore
    // (which includes those bonuses) only breaks ties WITHIN the same tier.
    if (curTier > bestTier) { best = scored; continue; }
    if (curTier < bestTier) continue;
    if (scored.rankScore > best.rankScore) { best = scored; continue; }
    if (scored.rankScore === best.rankScore && preferCandidate(scored.candidate, best.candidate)) {
      best = scored;
    }
  }

  // A demolition line whose class has a demo unit but no text match still
  // gets that class's unit (the class IS the match); a seed row wins a tie.
  if (!best && lineIsDemolition && lineDemoClass) {
    const same = library.filter(c => isUnitCompatible(line.unit, c.unit) && isDemolitionCandidate(c.category, c.name) && demolitionClass(c.name) === lineDemoClass);
    const pick = same.find(c => c.source !== 'accubid') ?? same[0];
    if (pick) best = { candidate: pick, baseScore: 0.85, confidence: 'alias', rankScore: 0.85 };
  }

  const hold = !best ? null
    : best.confidence === 'fuzzy' ? (confirmReasonFor(best.candidate) ?? fuzzySafetyHold(line, best.candidate))
    : best.confidence === 'alias' ? aliasSafetyHold(line, best.candidate)
    : null;
  return finishMapped(line, best, hold, null);
}

function finishMapped(line: NormalizedTakeoffLine, best: Scored | null, confirmReason: string | null, note: string | null): MappedLine {
  const isVerifyQty = typeof line.qty === 'string' && line.qty.trim() !== '' && Number.isNaN(Number(line.qty));
  const numericQty = typeof line.qty === 'number' ? line.qty : Number(line.qty);
  const qty = isVerifyQty || !Number.isFinite(numericQty) ? 0 : numericQty;

  return {
    category: line.category,
    description: line.description,
    takeoffItemId: line.takeoffItemId ?? null,
    qty,
    unit: line.unit,
    isVerifyQty,
    sourceConfidence: isVerifyQty ? 'VERIFY' : (line.sourceConfidence ?? null),
    matchConfidence: best?.confidence ?? 'none',
    matchedKind: best?.candidate.kind ?? null,
    matchedId: best?.candidate.id ?? null,
    matchedCode: best?.candidate.code ?? null,
    matchedUnit: best?.candidate.unit ?? null,
    confirmReason: best ? confirmReason : null,
    note,
  };
}

/** Match one normalized takeoff line against the library. Deterministic: ties
 *  prefer an assembly over a bare item, then the earlier candidate in `library`.
 *  Builds the token-frequency weighting fresh from `library` — for matching many
 *  lines against the same library, prefer mapTakeoffLines(), which builds it once. */
export function mapTakeoffLine(line: NormalizedTakeoffLine, library: LibraryCandidate[]): MappedLine {
  return mapTakeoffLineWithFreq(line, library, buildTokenFreqs(library));
}

export function mapTakeoffLines(lines: NormalizedTakeoffLine[], library: LibraryCandidate[]): MappedLine[] {
  const freq = buildTokenFreqs(library);
  return lines.map(l => mapTakeoffLineWithFreq(l, library, freq));
}

// ── Adapters for the two real takeoff shapes ────────────────────────────────

export interface TakeoffItemLike {
  item: string;
  description?: string;
  unit: string;
  qty: number | string;
  conf?: string | null;
}
export interface TakeoffCategoryLike {
  name: string;
  items: TakeoffItemLike[];
}

/** bidstd TakeoffCategory[]/TakeoffItem shape (backend/src/bidstd/bidData.ts).
 *  `it.item` is Agent 4's short takeoff item id ("5.1") — carried through as
 *  takeoffItemId, never used as the match text unless description is blank. */
export function fromTakeoffCategories(categories: TakeoffCategoryLike[]): NormalizedTakeoffLine[] {
  const out: NormalizedTakeoffLine[] = [];
  for (const cat of categories) {
    for (const it of cat.items ?? []) {
      out.push({
        category: cat.name,
        description: (it.description && it.description.trim()) || it.item,
        takeoffItemId: it.item ?? null,
        qty: it.qty,
        unit: normalizeUnit(it.unit), // B2: canonicalize aliases (ea/each, ft/lf) here, once, for every downstream consumer
        sourceConfidence: normalizeSourceConfidence(it.conf),
      });
    }
  }
  return out;
}

export interface LegacyTakeoffRow {
  category: string;
  /** Agent 4's short takeoff item id ("5.1") — matches Agent 4's own
   *  `it.item` convention (Agent 4 QCs and restructures Agent 2's output,
   *  preserving its numbering), NOT the descriptive text. */
  item: string;
  /** The descriptive text to match against the library. Optional because an
   *  older/hand-built fixture may only have `item` (some existing tests
   *  predate this field and pass a description directly as `item`) — falls
   *  back to `item` when absent so those callers keep working. */
  spec?: string | null;
  qty: number | string;
  unit: string;
  confidence?: string | null;
}

// A bare takeoff-item id ("5.1", "12") carries no matching signal — only treat
// `item` as a useful secondary description (B3's item-vs-spec fix) when it
// looks like actual text, not Agent 4's numbering.
const SHORT_ID_RE = /^\d+(\.\d+)?$/;

/** The legacy Agent 2/4 line shape read by the frontend's buildLineItemsFromTakeoff. */
export function fromLegacyTakeoff(rows: LegacyTakeoffRow[]): NormalizedTakeoffLine[] {
  return rows.map(r => {
    const spec = r.spec && r.spec.trim();
    const description = spec || r.item;
    const itemTrimmed = (r.item ?? '').trim();
    // B3: real Agent 2/4 rows split the descriptive noun unpredictably across
    // item/spec — e.g. item "Duplex receptacle" / spec "20A,125V,NEMA 5-20R,
    // spec grade" carries the noun in `item`, not `spec`. Surface it as
    // altText so the mapper's alias/fuzzy tiers can see it too, without
    // touching which text counts as the "primary" description above.
    const altText = itemTrimmed && itemTrimmed !== description && !SHORT_ID_RE.test(itemTrimmed)
      ? itemTrimmed
      : null;
    return {
      category: r.category,
      description,
      takeoffItemId: r.item ?? null,
      qty: r.qty,
      unit: normalizeUnit(r.unit), // B2: canonicalize aliases (ea/each, ft/lf) here, once, for every downstream consumer
      sourceConfidence: normalizeSourceConfidence(r.confidence),
      altText,
    };
  });
}

function normalizeSourceConfidence(v: string | null | undefined): SourceConfidence | null {
  const up = (v ?? '').toUpperCase();
  return up === 'FIRM' || up === 'APPROX' || up === 'VERIFY' ? (up as SourceConfidence) : null;
}
