// Level 2 learning, Task 9 — what a symbol MEANS, independent of its tag
// letter ("A" or "H" mean different things on different sets). Pure.
//
// An example from another plan set is offered to the counter only for a
// target whose meaning agrees: same category, same (non-null) device class,
// and similar wording (token Jaccard ≥ 0.5; ≥ 0.8 when the example's visual
// cluster is "conflicted") or a shared catalog / series token. The tag
// letter never takes part.
import { fp } from '../textFingerprint';
import { catalogOf } from '../evidence/families';

export type DeviceClass =
  | 'receptacle.duplex' | 'receptacle.gfci' | 'receptacle.quad' | 'receptacle.simplex' | 'receptacle.floor' | 'receptacle.weatherproof'
  | 'switch.single' | 'switch.3way' | 'switch.4way' | 'switch.dimmer' | 'switch.occupancy'
  | 'fixture.troffer' | 'fixture.highbay' | 'fixture.strip' | 'fixture.downlight' | 'fixture.wallpack' | 'fixture.exit' | 'fixture.emergency' | 'fixture.pole' | 'fixture.linear'
  | 'equipment.disconnect' | 'equipment.panel' | 'equipment.jbox' | 'equipment.motor' | 'equipment.fan' | 'equipment.thermostat'
  | 'tag.powerpole' | 'tag.keynote';

/** The closed keyword table, most specific first. */
const TABLE: Array<[DeviceClass, RegExp]> = [
  ['tag.powerpole', /\bpower\s*poles?\b/],
  ['tag.keynote', /\bkey\s*notes?\b/],
  ['receptacle.gfci', /\bgf[ci]{1,2}\b|\bground\s*fault\b/],
  ['receptacle.weatherproof', /\bweather\s*(?:proof|protected)\b|\bwp\b/],
  ['receptacle.floor', /\bfloor\b.*\b(?:receptacle|box|outlet)\b|\b(?:receptacle|box|outlet)\b.*\bfloor\b/],
  ['receptacle.quad', /\bquad(?:plex)?\b|\bfourplex\b/],
  ['receptacle.simplex', /\bsimplex\b|\bsingle\s+receptacle\b/],
  ['receptacle.duplex', /\bduplex\b|\breceptacles?\b|\boutlets?\b/],
  ['equipment.disconnect', /\bdisconnect\b|\bfused\s+switch\b|\bsafety\s+switch\b|\bdiscon\b/],
  ['switch.occupancy', /\boccupancy\b|\bvacancy\b|\bmotion\s*sensor\b/],
  ['switch.dimmer', /\bdimmer\b/],
  ['switch.3way', /\b3[\s-]?way\b|\bthree[\s-]way\b/],
  ['switch.4way', /\b4[\s-]?way\b|\bfour[\s-]way\b/],
  ['switch.single', /\bsingle[\s-]pole\s+switch\b|\btoggle\s+switch\b|\bswitch\b(?!\s*gear)/],
  ['fixture.exit', /\bexit\b/],
  ['fixture.emergency', /\bemergency\b|\bbattery\b|\begress\b/],
  ['fixture.pole', /\bpole[\s-]*mounted\b|\barea\s+light\b|\bsite\s+light\b|\bpole\s+light\b|\bdsx\d?\b/],
  ['fixture.wallpack', /\bwall\s*pack\b|\bwallpack\b|\bdsxw\d?\b/],
  ['fixture.highbay', /\bhigh[\s-]?bay\b|\blow[\s-]?bay\b/],
  ['fixture.troffer', /\btroffer\b|\b2\s*x\s*[24]\b.*\b(?:led|fixture|recessed)\b|\brecessed\b.*\b2\s*x\s*[24]\b/],
  ['fixture.downlight', /\bdown\s*light\b|\bcan\s+light\b|\brecess(?:ed)?\s+can\b|\bpot\s*light\b/],
  ['fixture.strip', /\bstrip\b|\bwrap\b/],
  ['fixture.linear', /\blinear\b|\bpendant\b|\bslot\b/],
  ['equipment.panel', /\bpanel(?:board)?\b|\bswitchboard\b|\bload\s*center\b/],
  ['equipment.jbox', /\bj[\s-]?box\b|\bjunction\s+box\b/],
  ['equipment.motor', /\bmotor\b/],
  ['equipment.fan', /\bfan\b/],
  ['equipment.thermostat', /\bthermostat\b|\btstat\b/],
];

const FIXTURE_CATS = new Set(['interior_lighting', 'exterior_building', 'site_lighting']);
const LIGHTING_ONLY: DeviceClass[] = ['fixture.troffer', 'fixture.highbay', 'fixture.strip', 'fixture.downlight', 'fixture.wallpack', 'fixture.exit', 'fixture.emergency', 'fixture.pole', 'fixture.linear'];

export function deviceClassOf(text: string, category: string | null | undefined): DeviceClass | null {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  const fixture = FIXTURE_CATS.has(String(category ?? ''));
  for (const [cls, re] of TABLE) {
    if (!re.test(t)) continue;
    // A light fixture is never a receptacle / switch / equipment class, and a
    // device is never a light-fixture class (except the power-pole tag).
    if (fixture && !LIGHTING_ONLY.includes(cls)) continue;
    if (!fixture && LIGHTING_ONLY.includes(cls)) continue;
    return cls;
  }
  return null;
}

export interface Meaning {
  label: string;
  description: string;
  category: string;
  deviceClass: DeviceClass | null;
  meaningFp: string;
  statusMeaning?: 'new' | 'existing';
}

export function meaningOf(t: { type?: string; label?: string; description?: string; text?: string; category?: string | null }): Meaning {
  const description = String(t.description ?? t.text ?? '').trim();
  const category = String(t.category ?? '');
  return { label: String(t.type ?? t.label ?? ''), description, category, deviceClass: deviceClassOf(description, category), meaningFp: fp(description) };
}

/** Wording that says nothing about WHICH device ("led", "light", "w/"). */
const GENERIC = new Set(['led', 'light', 'lights', 'lighting', 'fixture', 'fixtures', 'type', 'new', 'existing', 'mounted', 'input', 'mfr', 'unknown', 'see', 'only', 'per', 'ea']);
export function significantTokens(description: string): Set<string> {
  return new Set(fp(description).split(' ').filter(w => w && !GENERIC.has(w)));
}

/** Catalog / series tokens ("DSX1", "2GTL4" from "2GTL4LP840"). */
export function seriesTokens(description: string): Set<string> {
  const out = new Set<string>();
  const c = catalogOf(description);
  if (c) out.add(c.series.toUpperCase());
  for (const tok of String(description ?? '').toUpperCase().split(/[^A-Z0-9]+/)) {
    if (tok.length < 5 || !/\d/.test(tok) || (tok.match(/[A-Z]/g) ?? []).length < 2) continue;
    if (/^\d+(?:W|VA|KVA|K|V|A|FT|IN|MH|AFF)$/.test(tok) || /^\d+X\d+$/.test(tok)) continue;
    out.add(tok.slice(0, 5));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const JACCARD_MIN = 0.5;
export const JACCARD_STRICT = 0.8;

export function meaningMatches(target: Meaning, example: Pick<Meaning, 'category' | 'deviceClass' | 'description'>, opts: { strict?: boolean } = {}): boolean {
  if (!target.deviceClass || target.deviceClass !== example.deviceClass) return false;
  if (target.category !== example.category) return false;
  const series = [...seriesTokens(target.description)].some(s => seriesTokens(example.description).has(s));
  if (series) return true;
  return jaccard(significantTokens(target.description), significantTokens(example.description)) >= (opts.strict ? JACCARD_STRICT : JACCARD_MIN);
}
