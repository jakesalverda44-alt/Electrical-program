// Price accuracy round D1 — a printed new / existing rule applies only to the
// kinds of item it names. Pure: no I/O, no AI.
//
// 36th Street's E1.0 prints "SHADED SYMBOL DENOTES NEW RECEPTICLE". That is
// a rule about receptacles. Applied to every symbol on the sheet, it raised
// nine "could not be told new or existing" questions on disconnects,
// switches, panels, AHU / COMP units and the phone outlet — symbols the
// rule says nothing about. Now:
//   * a rule naming receptacles covers the receptacle types only;
//   * "fixtures" / "luminaires" / "lighting" covers the light fixtures;
//   * "switches" covers switches; "sensors" / "controls" the control devices;
//   * "devices" covers receptacles, switches, controls and other devices;
//   * "equipment" / "disconnects" / "panels" covers the equipment;
//   * a rule that names no kind ("(E) = EXISTING", "BOLD LINES INDICATE NEW
//     WORK", the estimator's answer) covers everything.
// A type no rule on its sheet covers behaves as on a new build: every mark
// is new, and no status question is asked about it.
import type { CountTarget } from '../countTargets';
import { demoClassOf } from './demolition';
import type { StatusConvention } from './status';

export type ScopeClass = 'receptacle' | 'switch' | 'control' | 'device' | 'fixture' | 'equipment';
export type ConventionScope = Set<ScopeClass> | 'all';

const WORDS: Array<{ re: RegExp; classes: ScopeClass[] }> = [
  { re: /\b(RECEP\w*|RECEPT\w*|RECPTS?|OUTLETS?|DUPLEX(?:ES)?|GFCIS?|GFIS?|PLUGS?)\b/i, classes: ['receptacle'] },
  { re: /\bSWITCH(?:ES)?\b/i, classes: ['switch'] },
  { re: /\b(SENSORS?|CONTROLS?|TIMERS?|TIME\s*CLOCKS?|PHOTO\s*CELLS?)\b/i, classes: ['control'] },
  { re: /\b(DEVICES?)\b/i, classes: ['receptacle', 'switch', 'control', 'device'] },
  { re: /\b(FIXTURES?|LUMINAIRES?|LIGHTING|LIGHTS|LAMPS?)\b/i, classes: ['fixture'] },
  { re: /\b(EQUIPMENT|DISCONNECTS?|PANELS?|PANELBOARDS?|MOTORS?|J-?BOX(?:ES)?|JUNCTION\s+BOX(?:ES)?)\b/i, classes: ['equipment'] },
];

/** The kinds of item a printed rule names ('all' = it names none). The
 *  printed words decide (the quote), never the model's paraphrase; the
 *  estimator's chosen convention and a combined DEMOLITION + NEW WORK
 *  title name no kind: they cover everything. */
export function conventionScope(c: Pick<StatusConvention, 'quote' | 'source'>): ConventionScope {
  if (c.source === 'estimator' || c.source === 'title') return 'all';
  const text = c.quote;
  const out = new Set<ScopeClass>();
  for (const w of WORDS) if (w.re.test(text)) for (const k of w.classes) out.add(k);
  return out.size ? out : 'all';
}

/** The kind of item a count type is. */
export function typeScopeClass(t: Pick<CountTarget, 'key' | 'type' | 'description' | 'symbolHint' | 'category' | 'emergency'>): ScopeClass {
  switch (demoClassOf(t).key) {
    case 'DEMO-RECEPTACLE': return 'receptacle';
    case 'DEMO-SWITCH': case 'DEMO-SWITCH3': return 'switch';
    case 'DEMO-CONTROL': return 'control';
    case 'DEMO-DEVICE': return 'device';
    case 'DEMO-FIXTURE': case 'DEMO-HIGHBAY': case 'DEMO-EXIT': case 'DEMO-EXTERIOR': case 'DEMO-SITE-POLE': return 'fixture';
    default: return 'equipment';
  }
}

/** The union of the rules' scopes. */
export function unionScope(rules: Array<Pick<StatusConvention, 'quote' | 'source'>>): ConventionScope {
  const out = new Set<ScopeClass>();
  for (const r of rules) {
    const s = conventionScope(r);
    if (s === 'all') return 'all';
    for (const k of s) out.add(k);
  }
  return out;
}

/** Is a count type covered by the rules of its sheet? No rule = not covered. */
export function inScope(scope: ConventionScope | null, t: Parameters<typeof typeScopeClass>[0] | undefined): boolean {
  if (!scope) return false;
  if (scope === 'all') return true;
  if (!t) return false;
  return scope.has(typeScopeClass(t));
}

export function describeScope(scope: ConventionScope): string {
  return scope === 'all' ? 'every item' : [...scope].join(', ');
}
