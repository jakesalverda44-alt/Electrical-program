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
