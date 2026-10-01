// Takeoff accuracy, Task 2 — the type list the counting stage (Agent 1C)
// counts, built from Agent 1's output (Decision 2). Pure: no I/O, no AI.
//
// Sources, in priority order (a type already taken from an earlier source is
// never redefined by a later one — the conflict is recorded instead):
//   1. fixtureSchedule[]  — luminaire/fixture schedule rows
//   2. symbolLegend[]     — device & symbol legend (E0.x / legend blocks)
//   3. equipment[]        — equipment/connection schedule (car washes,
//                           C-stores: dryers, blowers, pumps, disconnects)
//   4. panelCircuits[]    — FALLBACK ONLY, when 1-3 yielded nothing at all:
//                           panel-schedule circuit descriptions. Weak (a
//                           circuit description is not a drawn symbol) and
//                           reported as such.
// Every project type (car wash, self-storage, office, ...) flows through the
// same function — nothing here is national-account specific.

import { tradeAssignmentOf, type TradeAssignment } from '../bidstd/tradeAssignment';

export type TargetCategory =
  | 'interior_lighting'
  | 'exterior_building'
  | 'site_lighting'
  | 'device'
  | 'lighting_control'
  | 'equipment'
  | 'panel_circuit';

export type TargetSource = 'fixture_schedule' | 'legend' | 'equipment_schedule' | 'panel_circuits';

export interface CountTarget {
  /** The type tag as it reads on the drawings ("A", "S1", "GFI"). */
  type: string;
  /** Normalized identity used for matching and de-dup ("A", "S1", "GFI"). */
  key: string;
  description: string;
  /** How the symbol is drawn / what is printed next to it, for the counter. */
  symbolHint: string;
  /** Input watts per fixture, when the schedule states it. */
  wattage: number | null;
  category: TargetCategory;
  source: TargetSource;
  sourceSheet: string;
  /** Pole-mounted site types only: heads per pole from the schedule. */
  headsPerPole: number | null;
  emergency: boolean;
  /** Next round A6 — who furnishes / installs it, when its schedule or
   *  legend text says ("G.C. furnished/installed" = APT; "installed by HVAC,
   *  wired by EC" = another trade, APT connects). Absent = APT F&I. */
  assignment?: TradeAssignment;
  /** Evidence round 2.2 — a HOST marker (a power-pole tag, a detail
   *  callout): counted as the multiplier of a typical package, never a
   *  takeoff line or a zero-count review item of its own. */
  role?: 'host' | 'locate';
  /** Accuracy round B3 — a host SHARED by several legend types: the tags
   *  its legend uses ("1".."6"); the counter reports the number printed in
   *  each host's symbol, which binds that host to its type. */
  hostTags?: string[];
  /** Accuracy round C3 — a LOCATE-ONLY target (role 'locate'): the feeder
   *  node it stands for ("PANEL A", "DISCON A", "METER", "RTU-1"). */
  node?: string;
  /** Real-run fix 2 — another name for (part of) these canonical entities:
   *  never counted, never a line or a zero item of its own; kept on the
   *  list (status 'merged') with the reason, as evidence. */
  mergedInto?: string[];
  mergeKind?: 'synonym' | 'class' | 'combined' | 'tag_legend';
  /** Review fix B2 — a GENERIC name that could be any of these entities:
   *  counted on its own and decided by its marks; never owns a schedule row. */
  uncertainOf?: string[];
  mergeReason?: string;
  /** Real-run fix 2 — on a canonical entity: the keys of its other names. */
  aliases?: string[];
}

export interface TargetBuildResult {
  targets: CountTarget[];
  /** Human-readable notes: duplicate definitions, rows skipped for having no
   *  usable type, the weak panel-circuit fallback being used. */
  notes: string[];
}

const LOCATION_TO_CATEGORY: Record<string, TargetCategory> = {
  interior: 'interior_lighting',
  exterior_building: 'exterior_building',
  exterior: 'exterior_building',
  site: 'site_lighting',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** "Type A" / "type  a " / "A" -> "A"; "S-1" stays "S-1"; collapses spaces. */
export function normalizeTypeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^type\s+/i, '')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** "32W", "32 W", "32.5", 32 -> 32 / 32.5; anything else (incl. 0) -> null. */
export function parseWatts(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const m = /(\d+(?:\.\d+)?)/.exec(str(v));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(str(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Category for a fixture-schedule row: the explicit `location` wins; without
 *  one, the description/mounting text decides (pole/area/parking -> site;
 *  wall pack/canopy/soffit/exterior -> building-mounted exterior; else
 *  interior). */
export function fixtureCategory(row: Record<string, unknown>): TargetCategory {
  const loc = str(row.location).toLowerCase().replace(/[\s-]+/g, '_');
  if (LOCATION_TO_CATEGORY[loc]) return LOCATION_TO_CATEGORY[loc];
  const text = `${str(row.description)} ${str(row.mounting)}`.toLowerCase();
  if (/\bpole\b|area light|parking lot|site light|shoebox/.test(text)) return 'site_lighting';
  if (/wall ?pack|canopy|soffit|exterior|outdoor|building mounted/.test(text)) return 'exterior_building';
  return 'interior_lighting';
}

const LEGEND_CATEGORIES = new Set<TargetCategory>(['device', 'lighting_control', 'equipment']);

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
}

export function buildCountTargets(agent1: Record<string, unknown> | null | undefined): TargetBuildResult {
  const targets: CountTarget[] = [];
  const notes: string[] = [];
  const byKey = new Map<string, CountTarget>();
  if (!agent1) return { targets, notes: ['No drawing analysis to build a type list from.'] };

  const add = (t: CountTarget) => {
    if (!t.key) return;
    if (t.assignment === undefined) {
      const a = tradeAssignmentOf(t.description);
      if (a) t.assignment = a;
    }
    const existing = byKey.get(t.key);
    if (existing) {
      // Same type seen twice (a schedule split across two sheets, a batch
      // merge concatenating the same schedule twice, or a legend reusing a
      // fixture tag). Keep the first definition; fill a missing wattage or
      // heads-per-pole from the duplicate rather than dropping real data.
      if (existing.wattage == null && t.wattage != null) existing.wattage = t.wattage;
      if (existing.headsPerPole == null && t.headsPerPole != null) existing.headsPerPole = t.headsPerPole;
      if (existing.source !== t.source || existing.description.toLowerCase() !== t.description.toLowerCase()) {
        notes.push(`Type ${t.type} is defined twice (${existing.source}: "${existing.description}"; ${t.source}: "${t.description}") — kept the ${existing.source} definition.`);
      }
      return;
    }
    byKey.set(t.key, t);
    targets.push(t);
  };

  // 1. Fixture schedule.
  for (const row of arr(agent1.fixtureSchedule)) {
    const type = str(row.type);
    const key = normalizeTypeKey(type);
    if (!key) {
      if (str(row.description)) notes.push(`Fixture schedule row "${str(row.description)}" has no type tag — not counted.`);
      continue;
    }
    const category = fixtureCategory(row);
    add({
      type,
      key,
      description: str(row.description),
      symbolHint: str(row.symbol),
      wattage: parseWatts(row.wattage),
      category,
      source: 'fixture_schedule',
      sourceSheet: str(row.sourceSheet),
      headsPerPole: category === 'site_lighting' ? positiveInt(row.headsPerPole) : null,
      emergency: row.emergency === true || /\bexit\b|emergency|\bem\b|battery/i.test(str(row.description)),
    });
  }

  // 2. Device & symbol legend.
  for (const row of arr(agent1.symbolLegend)) {
    const symbol = str(row.symbol);
    const description = str(row.description);
    // A short printed label ("GFI", "OS", "$3") identifies the symbol; a
    // long shape description ("circle with two lines") does not, so the
    // legend description becomes the identity instead.
    const label = symbol && symbol.length <= 8 ? symbol : '';
    const type = label || description;
    const key = normalizeTypeKey(type);
    if (!key) continue;
    const cat = str(row.category).toLowerCase() as TargetCategory;
    add({
      type,
      key,
      description,
      symbolHint: symbol,
      wattage: null,
      category: LEGEND_CATEGORIES.has(cat) ? cat : 'device',
      source: 'legend',
      sourceSheet: str(row.sourceSheet),
      headsPerPole: null,
      emergency: false,
    });
  }

  // 3. Equipment / connection schedule.
  for (const row of arr(agent1.equipment)) {
    const tag = str(row.tag);
    const key = normalizeTypeKey(tag);
    if (!key) continue;
    add({
      type: tag,
      key,
      description: str(row.description),
      symbolHint: `equipment tag "${tag}"`,
      wattage: null,
      category: 'equipment',
      source: 'equipment_schedule',
      sourceSheet: str(row.sourceSheet),
      headsPerPole: null,
      emergency: false,
    });
  }

  // 4. Panel-circuit fallback — only when nothing better exists.
  if (targets.length === 0) {
    for (const row of arr(agent1.panelCircuits)) {
      const description = str(row.description);
      const key = normalizeTypeKey(description);
      if (!key) continue;
      add({
        type: description,
        key,
        description,
        symbolHint: `devices/fixtures on circuits described as "${description}"`,
        wattage: null,
        category: 'panel_circuit',
        source: 'panel_circuits',
        sourceSheet: str(row.sourceSheet),
        headsPerPole: null,
        emergency: false,
      });
    }
    if (targets.length) {
      notes.push('No fixture schedule, legend or equipment schedule was found — the type list falls back to panel-circuit descriptions, which are not drawn symbols. Treat these counts as a starting point only.');
    }
  }

  if (targets.length === 0) notes.push('No fixture schedule, legend, equipment schedule or lighting circuits were found — nothing to count.');
  return { targets, notes };
}

/** True for categories whose rows live in the proposal's fixture categories
 *  (Interior Lighting / Exterior Site Lighting). */
export function isFixtureCategory(c: TargetCategory): boolean {
  return c === 'interior_lighting' || c === 'exterior_building' || c === 'site_lighting';
}

// ── Accuracy round C3 — LOCATE-ONLY targets (feeder endpoints) ───────────────
// The feeder estimate (P's feederGraph / feederEndpoints) needs WHERE each
// feeder node is: panels, disconnects, the meter, the wireway, the utility
// transformer, the equipment a feeder-size circuit serves. Most are not count
// targets (Kissimmee: Panels A/B and DISCON A/B are panels[] rows; RTU-1/2 are
// schedule-owned), so the counter is asked to place ONE mark at each — in the
// same tiles and calls, never as a count. R's own node-name normalizer (P's
// feederGraph.feederNodes() can replace it once both land).

/** Locate targets per counter sheet call (the prompt budget). */
export const MAX_LOCATE_TARGETS = 20;
export const LOCATE_PREFIX = '@';
export function isLocateKey(k: string): boolean { return k.startsWith(LOCATE_PREFIX); }

/** Pure: a feeder node's normalized name — "Panel A" / "A" (a panel name) ->
 *  "PANEL A"; "DISCON A (200A fused switch)" / "Disc. A" -> "DISCON A";
 *  "Meter base" / "MB" -> "METER"; "Wireway" / "gutter" -> "WIREWAY";
 *  "utility transformer" / "XFMR" -> "XFMR"; "RTU-1" / "COMP #1" -> "RTU-1" /
 *  "COMP-1"; MDP / MSB as is. null = not a node. `asPanel`: a panels[] name
 *  (a bare "A" is Panel A). */
export function normalizeFeederNode(raw: string, opts: { asPanel?: boolean } = {}): string | null {
  const s = ` ${raw.toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim()} `;
  if (!s.trim()) return null;
  if (/\b(TRANSFORMER|XFMR|XFR)\b/.test(s)) return 'XFMR';
  if (/\bMETER\b|^ MB $|\bCT CABINET\b/.test(s)) return 'METER';
  if (/\bWIRE ?WAY\b|\bGUTTER\b|^ WW $/.test(s)) return 'WIREWAY';
  if (/\bMDP\b|\bMAIN DISTRIBUTION\b/.test(s)) return 'MDP';
  if (/\bMSB\b|\bMAIN SWITCHBOARD\b/.test(s)) return 'MSB';
  const disc = /\bDISC(?:ON(?:NECT)?)?\.?(?: SWITCH)?(?:\s+|\s*[-#]\s*)([A-Z0-9]{1,3})\b/.exec(s);
  if (disc && !/^(SW|SWITCH)$/.test(disc[1])) return `DISCON ${disc[1]}`;
  const pnl = /\b(?:PANEL(?:BOARD)?|PNL)(?:\s+|\s*[-#]\s*)([A-Z0-9][A-Z0-9-]{0,5})\b/.exec(s);
  if (pnl && !/^(SCHEDULE|BOARD|S)$/.test(pnl[1])) return `PANEL ${pnl[1]}`;
  const bare = s.trim();
  if (opts.asPanel && /^[A-Z0-9][A-Z0-9-]{0,5}$/.test(bare)) return `PANEL ${bare}`;
  const tag = /^([A-Z]{2,5})\s*[-#]?\s*(\d{1,2})$/.exec(bare);
  if (tag) return `${tag[1]}-${tag[2]}`;
  return null;
}

const FEEDER_SPEC = /\b\d+\s*#\s*\d+(?:\/0)?\b|#\s*\d\/0\b|\b\d{3}\s*KCMIL\b|\(\d\)\s*\d\s*#/i;

/** Pure (C3): the locate-only targets for the feeder nodes Agent 1 found —
 *  panels[] (names and fed-from), the service (meter, utility transformer;
 *  never an existing one) and equipment[] rows with a feeder-size conductor
 *  spec. At most MAX_LOCATE_TARGETS, in that order. */
export function buildLocateTargets(agent1: Record<string, unknown> | null | undefined): CountTarget[] {
  if (!agent1) return [];
  const out = new Map<string, string>();
  const add = (node: string | null, hint: string) => {
    if (!node || out.has(node) || out.size >= MAX_LOCATE_TARGETS) return;
    out.set(node, hint.replace(/\s+/g, ' ').trim().slice(0, 140));
  };
  for (const p of arr(agent1.panels)) {
    const name = str(p.name);
    const amps = Number(p.amps) > 0 ? `${Number(p.amps)}A ` : '';
    add(normalizeFeederNode(name, { asPanel: true }), `${name} — ${amps}${str(p.voltage)} ${/DISC/i.test(name) ? 'disconnect' : 'panelboard'}${str(p.location) ? ` (${str(p.location)})` : ''}`);
  }
  for (const p of arr(agent1.panels)) {
    const fed = str(p.fedFrom);
    if (!fed || /\bexist/i.test(fed)) continue;
    for (const seg of fed.split(/\s*(?:\/|,|;|\band\b|\bvia\b)\s*/i)) add(normalizeFeederNode(seg), `${seg} — feeds ${str(p.name)}`);
  }
  const svc = agent1.service && typeof agent1.service === 'object' ? agent1.service as Record<string, unknown> : null;
  if (svc && !/\bexist/i.test(`${str(svc.voltage)} ${str(svc.transformerKVA)}`)) {
    add('METER', `the service meter / meter base (${str(svc.voltage)}${Number(svc.mainAmps) > 0 ? `, ${Number(svc.mainAmps)}A` : ''})`);
    add('XFMR', `the utility (pad-mount) transformer${str(svc.utilityCompany) ? `, ${str(svc.utilityCompany)}` : ''}`);
  }
  for (const e of arr(agent1.equipment)) {
    const tag = str(e.tag);
    const desc = str(e.description);
    if (!FEEDER_SPEC.test(desc) || /\bexist/i.test(desc)) continue;
    add(normalizeFeederNode(tag) ?? normalizeFeederNode(desc), `${tag} — ${desc}`);
  }
  return [...out].map(([node, hint]) => ({
    type: `${LOCATE_PREFIX}${node}`, key: `${LOCATE_PREFIX}${node}`, description: hint, symbolHint: '',
    wattage: null, category: 'equipment' as const, source: 'equipment_schedule' as const, sourceSheet: '',
    headsPerPole: null, emergency: false, role: 'locate' as const, node,
  }));
}
