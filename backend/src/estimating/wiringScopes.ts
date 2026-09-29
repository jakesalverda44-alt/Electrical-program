// Fix round BL-2/3/4 — one source of truth per wiring scope.
//
// Four scopes: branch (branch conduit + wire), mc (fixture whips — separate
// material Chris carries alongside the branch run), feeder (feeders /
// HVAC / service), site (site lighting / poles / underground). Each scope's
// footage comes from exactly ONE source, in this order:
//   1. the estimator — an LF line in that scope they added by hand, typed a
//      qty on (qty_overridden), or confirmed from markups. Re-check NB-2: its
//      footage is SUBTRACTED from the scope's ratio allowance (max 0), never
//      zeroing it outright; a typed line that can't be priced (no item) takes
//      nothing off.
//   2. Agent 2 — allowance rows with footage, or LF takeoff[] rows, in that
//      scope. They expand into a COMPLETE conduit + wire set through the same
//      spec parser the NEEDS FOOTAGE pricing uses, all-or-nothing (an Agent 2
//      MC row is a complete fixture-whip set by itself). A set that can't be
//      read completely never counts: the ratio carries the scope and the
//      lines say so — the wire is never dropped.
//   3. the ratio / geometry allowance (footageAllowance.ts).
// Pure: footageAllowanceDb.ts supplies the bid's current lines and a
// resolver that checks every part maps to a library item.
import { GeneratedTakeoffRow, TakeoffRowLike, FootageSettings, BRANCH_CATEGORY, FEEDER_CATEGORY, parseConductorRun } from './footageAllowance';
import { runSpecParts, NEEDS_FOOTAGE_PREFIX } from './footageSpecPricing';

/** 'mc' = fixture whips (MC): separate material from branch EMT + wire —
 *  Chris carries both, so branch footage never replaces the MC allowance. */
export type WiringScope = 'branch' | 'mc' | 'feeder' | 'site';

function conduitInches(text: string): number | null {
  const m = text.match(/(\d+)-(\d+)\/(\d+)\s*"|(\d+)\/(\d+)\s*"|(\d+(?:\.\d+)?)\s*"/);
  if (!m) return null;
  if (m[1]) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[6]);
}

// Re-check NB-2 / NSF-2 — a line joins a wiring scope only if it names POWER
// wiring material (raceway: EMT/PVC/MC/RMC/IMC/conduit; conductor: THHN or a
// #size conductor) or says branch / feeder outright, and never when it is a
// low-voltage, signal, control, grounding or bonding run.
const NON_POWER_RE = /telecom|\btel\b|\bdata\b|\bcat ?[3-7]e?\b|cctv|camera|security|intercom|speaker|paging|\baudio\b|\ba\/v\b|\bav\b|visual|\btv\b|\bcatv\b|television|doorbell|nurse ?call|\bbas\b|\bbms\b|\bems\b|building automation|thermostat|0-10 ?v|dimming control|fire alarm|\bfa\b|low.?voltage|\bcontrols?\b|telephone|\bphone\b|satellite|pull ?(?:wire|string)|alarm|\bempty\b|\bgrounding\b|\bground rod\b|electrode|\bgec\b|\bbond(?:ing)?\b|bare copper|water (?:pipe|main)|building steel|trench|\bbore\b|#\s*(?:1[68]|2[024])\b|\b(?:1[68]|2[024])\/\d\b/i;
const RACEWAY_RE = /\bemt\b|\bpvc\b|\bmc\b|mc cable|\brmc\b|\bimc\b|\brigid\b|conduit|\bflex\b|\blfmc\b|\bfmc\b/i;
const CONDUCTOR_RE = /\bthhn\b|\bthwn\b|\bxhhw\b|\d\s*#\s*(?:\d\/0|\d{1,2})|#\s*(?:\d\/0|\d{1,2})\s*(?:awg|thhn|thwn|cu\b|al\b|copper|conductor|g\b)|\bawg\b|\bkcmil\b|\bconductors?\b|\bwire\b/i;
const BRANCH_WORDS_RE = /\bbranch\b|\bcircuits?\b|home ?runs?/i;
const FEEDER_WORDS_RE = /feeder|\bservice (?:entrance|conductors?|feeder)|\bhvac\b|\bahu\b|\brtu\b|compressor|condens|\bmdp\b|transformer|\bxfmr\b|panel ?board|sub ?panel/i;

export function namesPowerWiring(text: string): boolean {
  const t = text ?? '';
  return !NON_POWER_RE.test(t) && (RACEWAY_RE.test(t) || CONDUCTOR_RE.test(t) || BRANCH_WORDS_RE.test(t) || FEEDER_WORDS_RE.test(t));
}

/** Which wiring scope a line's text belongs to, or null (not power wiring:
 *  low voltage / signal / control / grounding / bonding, or no wiring
 *  material named at all — "Single pole switch" is a device). */
export function scopeOfText(text: string): WiringScope | null {
  const t = text ?? '';
  if (!namesPowerWiring(t)) return null;
  if (/\bmc\b|mc cable|\b12\/[23]\b|fixture whip/i.test(t)) return 'mc';
  if (/\bsite\b|\bpoles?\b|underground|parking|area light|bollard/i.test(t) && !/power poles?|single.?pole|double.?pole|[1-4].?pole/i.test(t)) return 'site';
  if (FEEDER_WORDS_RE.test(t)) return 'feeder';
  if (BRANCH_WORDS_RE.test(t)) return 'branch';
  if (/#\s*(?:\d\/0|[1-8])\b|\bkcmil\b/i.test(t)) return 'feeder';
  const spec = parseConductorRun(t);
  if (spec?.conductors.some(c => !c.ground && (/\/0|kcmil/.test(c.size) || Number(c.size) <= 8))) return 'feeder';
  const inches = conduitInches(t);
  if (inches != null && inches > 1 && RACEWAY_RE.test(t)) return 'feeder';
  return 'branch';
}

export interface ExistingLineLike {
  category: string;
  description: string;
  unit: string;
  qty: number;
  source: 'takeoff' | 'manual';
  qty_overridden?: boolean;
  qty_source?: string | null;
  takeoff_key?: string | null;
  excluded?: boolean;
  /** The estimator picked the library item by hand (match_source='manual'). */
  match_source?: string | null;
  /** The matched library item's name, when the line has one. */
  item_name?: string | null;
}

/** The generated ratio lines (never a "source 1" themselves). */
export const RATIO_ITEMS = {
  emt: 'Branch conduit allowance — EMT',
  wire12: 'Branch wire allowance — #12 THHN',
  wire10: 'Branch wire allowance — #10 THHN',
  mc: 'Fixture whip allowance — 12/2 MC',
  pvc: 'Site lighting conduit allowance — PVC',
} as const;
const RATIO_ITEM_SET = new Set<string>(Object.values(RATIO_ITEMS));

function keyItem(key: string | null | undefined): string {
  const k = key ?? '';
  const i = k.indexOf('||');
  return (i >= 0 ? k.slice(i + 2) : k).replace(/::\d+$/, '');
}
function isLinear(unit: string): boolean {
  const u = String(unit ?? '').trim().toUpperCase();
  return u === 'LF' || u === 'FT' || u === 'FEET' || u === 'C' || u === 'M';
}
function isUserLine(l: ExistingLineLike): boolean {
  if (l.excluded || !(Number(l.qty) > 0) || !isLinear(l.unit)) return false;
  if (l.category === BRANCH_CATEGORY && RATIO_ITEM_SET.has(keyItem(l.takeoff_key))) return false;
  return l.source === 'manual' || !!l.qty_overridden || l.qty_source === 'markup';
}

type Part = { description: string; perFtOfRun: number };
export type PartsResolver = (parts: Part[]) => boolean;

function partLabel(p: Part): string {
  return /THHN/.test(p.description) ? `${p.description.replace(' THHN/THWN copper conductor', '')} wire ×${p.perFtOfRun}` : 'conduit';
}

export interface ScopeDecision { source: 1 | 2 | 3; detail: string; notes: string[] }

export interface ComposeInput {
  takeoff: TakeoffRowLike[];
  allowances: Array<{ item: string; footage?: number | string | null; unit?: string | null; notes?: string | null; category?: string | null }>;
  ratioRows: GeneratedTakeoffRow[];
  existing: ExistingLineLike[];
  resolveParts: PartsResolver;
  settings: FootageSettings;
  conductors: number;
  allowanceCategory: string;
}

export interface ComposeResult {
  /** Agent 2's takeoff[] rows, with a complete combined run expanded into its parts and rows in a source-1 scope set to 0. */
  takeoff: Array<TakeoffRowLike & { evidence?: string | null }>;
  /** B1 allowance rows + the ratio rows, after the one-source rule. */
  generated: GeneratedTakeoffRow[];
  scopes: Record<WiringScope, ScopeDecision>;
}

interface Contribution { conduitFt: number; wireFt: number; mcFt: number }

/** Re-check NB-2 / NSF-4 — what one of the estimator's LF lines adds to its
 *  scope, in conduit-ft, conductor-ft and MC-ft; 'unresolved' for a typed
 *  NEEDS FOOTAGE line that has no complete, resolvable spec and no item
 *  picked (it can't be priced, so it must not reduce the allowance). */
function contributionOf(l: ExistingLineLike, resolveParts: PartsResolver): Contribution | 'unresolved' {
  const qty = Number(l.qty);
  const picked = l.match_source === 'manual' && l.item_name ? l.item_name : null;
  const c: Contribution = { conduitFt: 0, wireFt: 0, mcFt: 0 };
  if (!picked && l.description.startsWith(NEEDS_FOOTAGE_PREFIX)) {
    const parts = runSpecParts(l.description);
    if (!parts || !resolveParts(parts)) return 'unresolved';
    for (const p of parts) { if (/THHN/.test(p.description)) c.wireFt += qty * p.perFtOfRun; else c.conduitFt += qty * p.perFtOfRun; }
    return c;
  }
  const t = picked ?? l.description;
  if (/\bmc\b|mc cable|\b12\/[23]\b/i.test(t)) { c.mcFt = qty; return c; }
  const parts = runSpecParts(t, { requirePrefix: false });
  if (parts && parts.length > 1 && resolveParts(parts)) {
    for (const p of parts) { if (/THHN/.test(p.description)) c.wireFt += qty * p.perFtOfRun; else c.conduitFt += qty * p.perFtOfRun; }
    return c;
  }
  if (RACEWAY_RE.test(t)) c.conduitFt = qty;
  else if (CONDUCTOR_RE.test(t)) c.wireFt = qty;
  return c;
}

export function composeWiringRows(input: ComposeInput): ComposeResult {
  const scopes: WiringScope[] = ['branch', 'mc', 'feeder', 'site'];
  const emptyRec = <T>(f: () => T): Record<WiringScope, T> => ({ branch: f(), mc: f(), feeder: f(), site: f() });
  // 1 — the estimator's own footage in each scope: SUBTRACTED from the
  // scope's allowance (never zeroing it outright), so a 20 ft extra run
  // takes 20 ft off, not the whole allowance.
  const user = emptyRec<string[]>(() => []);
  const userFt = emptyRec<Contribution>(() => ({ conduitFt: 0, wireFt: 0, mcFt: 0 }));
  const unresolvedTyped = emptyRec<string[]>(() => []);
  for (const l of input.existing) {
    if (!isUserLine(l)) continue;
    const scope = scopeOfText(`${l.description} ${keyItem(l.takeoff_key)}`);
    if (!scope) continue;
    const contrib = contributionOf(l, input.resolveParts);
    if (contrib === 'unresolved') { unresolvedTyped[scope].push(`${l.description.replace(NEEDS_FOOTAGE_PREFIX, '')} ${Number(l.qty)} ft`); continue; }
    user[scope].push(`${l.description} ${Number(l.qty)} ${l.unit}`);
    userFt[scope].conduitFt += contrib.conduitFt;
    userFt[scope].wireFt += contrib.wireFt;
    userFt[scope].mcFt += contrib.mcFt;
  }
  const userKeys = new Set(input.existing.filter(isUserLine).map(l => keyItem(l.takeoff_key)));

  // 2 — Agent 2's footage.
  const agentComplete = emptyRec<string[]>(() => []);
  const agentIncomplete = emptyRec<string[]>(() => []);

  const generated: GeneratedTakeoffRow[] = [];
  for (const a of input.allowances) {
    const ft = Number(a.footage);
    const hasFootage = Number.isFinite(ft) && ft > 0;
    const scope = scopeOfText(a.item);
    const note = (a.notes ?? '').trim();
    const category = (a.category ?? '').trim() || input.allowanceCategory;
    const singleItem = `Allowance — ${a.item}`;
    const parts = runSpecParts(a.item, { requirePrefix: false });
    const resolvable = !!parts && input.resolveParts(parts);
    const userOnSingle = userKeys.has(singleItem);
    const userOnParts = [...userKeys].some(k => k.startsWith(`${singleItem} — `));
    const useParts = resolvable && (userOnParts || (!userOnSingle && hasFootage));
    if (useParts) {
      if (scope && hasFootage) agentComplete[scope].push(`${a.item} ${ft} ft`);
      for (const p of parts!) {
        generated.push({
          category, item: `${singleItem} — ${partLabel(p)}`, spec: p.description,
          qty: !hasFootage ? 0 : Math.round(ft * p.perFtOfRun * 100) / 100, unit: 'LF', confidence: 'APPROX',
          evidence: `Agent 2 allowance, ESTIMATED: ${ft} ft of run × ${p.perFtOfRun} (${a.item})${note ? ` — ${note}` : ''}. Complete conduit + wire set, every part matched in the library.`,
        });
      }
      continue;
    }
    if (hasFootage && scope) {
      // Can't be read as a complete set — never a partial (conduit-only) price.
      agentIncomplete[scope].push(`${a.item} ${ft} ft`);
      generated.push({
        category, item: singleItem, spec: `${NEEDS_FOOTAGE_PREFIX}${a.item}`, qty: 0, unit: 'LF', confidence: 'APPROX',
        evidence: `Agent 2 read ${ft} ft off the plans, but its conduit/wire spec couldn't be matched completely in the library — the ratio allowance carries this scope instead. Type the footage here and pick the library item if Agent 2's number is right; it is then taken off the ratio.${note ? ` Agent 2: ${note}` : ''}`,
      });
      continue;
    }
    generated.push({
      category, item: singleItem,
      spec: hasFootage ? a.item : `${NEEDS_FOOTAGE_PREFIX}${a.item}`,
      qty: hasFootage ? ft : 0, unit: 'LF', confidence: 'APPROX',
      evidence: hasFootage ? `Agent 2 allowance, ESTIMATED: ${ft} ${String(a.unit ?? 'LF').toUpperCase()}${note ? ` — ${note}` : ''}`
        : `Agent 2 allowance with no footage on the plans — measure it or type a qty (not priced until then)${runSpecParts(`${NEEDS_FOOTAGE_PREFIX}${a.item}`) ? '; the conduit and the wire (run × conductors) price automatically from the typed run length' : '; pick the library item after typing a footage'}${scope ? `. A footage typed here is taken off the ${scope} ratio allowance` : ''}${note ? `. Agent 2: ${note}` : ''}`,
    });
  }

  const takeoff: ComposeResult['takeoff'] = [];
  const agentPlain = emptyRec<{ conduit: boolean; wire: boolean; rows: string[] }>(() => ({ conduit: false, wire: false, rows: [] }));
  for (const r of input.takeoff) {
    const qty = typeof r.qty === 'number' ? r.qty : Number(r.qty);
    const text = `${r.item ?? ''} ${r.spec ?? ''}`;
    const scope = isLinear(r.unit) && Number.isFinite(qty) && qty > 0 ? scopeOfText(text) : null;
    if (!scope) { takeoff.push(r); continue; }
    const parts = runSpecParts(text, { requirePrefix: false });
    if (parts && parts.length > 1 && input.resolveParts(parts)) {
      agentComplete[scope].push(`${r.item} ${qty} ${r.unit}`);
      for (const p of parts) {
        takeoff.push({
          category: r.category, item: `${r.item} — ${partLabel(p)}`, spec: p.description, unit: 'LF',
          qty: Math.round(qty * p.perFtOfRun * 100) / 100,
          evidence: `Agent 2 takeoff run ${qty} ${r.unit} (${r.item}) × ${p.perFtOfRun} — complete conduit + wire set.`,
        });
      }
      continue;
    }
    const plain = agentPlain[scope];
    if (RACEWAY_RE.test(text)) plain.conduit = true;
    if (CONDUCTOR_RE.test(text) || /\bmc\b/i.test(text)) plain.wire = true;
    plain.rows.push(`${r.item} ${qty} ${r.unit}`);
    takeoff.push(r);
  }
  for (const scope of scopes) {
    const p = agentPlain[scope];
    // An MC row is conduit and wire in one: complete by itself.
    if ((p.conduit && p.wire) || (scope === 'mc' && p.rows.length)) agentComplete[scope].push(...p.rows);
    else if (p.rows.length) agentIncomplete[scope].push(...p.rows);
  }

  const decisions = {} as Record<WiringScope, ScopeDecision>;
  for (const scope of scopes) {
    const notes: string[] = [];
    if (agentIncomplete[scope].length && !agentComplete[scope].length) notes.push(`Agent 2 also lists ${agentIncomplete[scope].join('; ')} — not a complete conduit + wire set, so the ratio carries this scope; check for double counting.`);
    if (unresolvedTyped[scope].length) notes.push(`You typed ${unresolvedTyped[scope].join('; ')} on a line with no library item — pick the library item; the allowance is unchanged until then.`);
    if (agentComplete[scope].length && user[scope].length) notes.push(`You also entered ${user[scope].join('; ')} in this scope — check it isn't the same run as Agent 2's.`);
    decisions[scope] = agentComplete[scope].length ? { source: 2, detail: agentComplete[scope].join('; '), notes }
      : user[scope].length ? { source: 1, detail: user[scope].join('; '), notes }
      : { source: 3, detail: '', notes };
  }

  // 3 — the ratio rows.
  const emtLine = input.existing.find(l => l.category === BRANCH_CATEGORY && keyItem(l.takeoff_key) === RATIO_ITEMS.emt);
  const measuredEmt = emtLine && !emtLine.excluded && Number(emtLine.qty) > 0 && (emtLine.qty_source === 'markup' || emtLine.qty_overridden) ? Number(emtLine.qty) : null;
  const s = input.settings;
  const f0 = (n: number) => Math.round(n);
  const branchWireRatio = input.ratioRows.filter(r => r.item === RATIO_ITEMS.wire12 || r.item === RATIO_ITEMS.wire10).reduce((t, r) => t + Number(r.qty), 0);
  for (const row of input.ratioRows) {
    if (row.category === FEEDER_CATEGORY) {
      const d = decisions.feeder;
      generated.push(d.source !== 2 ? row : { ...row, evidence: `${row.evidence} NOTE: Agent 2 carries feeder footage (${d.detail}) — enter a qty here only if this is a different run.` });
      continue;
    }
    const scope: WiringScope = row.item === RATIO_ITEMS.pvc ? 'site' : row.item === RATIO_ITEMS.mc ? 'mc' : 'branch';
    const d = decisions[scope];
    const noteText = d.notes.length ? ` NOTE: ${d.notes.join(' ')}` : '';
    if (d.source === 2) {
      generated.push({ ...row, qty: 0, evidence: `Replaced by Agent 2's footage read off the plans (${d.detail}) — set to 0 so it is never counted twice.${noteText} The allowance would be: ${row.evidence}` });
      continue;
    }
    let next = row;
    const isWire = row.item === RATIO_ITEMS.wire12 || row.item === RATIO_ITEMS.wire10;
    const share = row.item === RATIO_ITEMS.wire10 ? s.wire10Share : 1 - s.wire10Share;
    // SF-3 — a measured / entered EMT run carries the wire with it.
    let wireBase = branchWireRatio;
    if (scope === 'branch' && measuredEmt != null) wireBase = measuredEmt * s.wirePerConduitFt * (input.conductors / s.baseConductors);
    if (scope === 'branch' && measuredEmt != null && isWire) {
      next = { ...row, qty: f0(wireBase * share), evidence: `Derived from your measured/entered EMT run: ${measuredEmt} ft × ${Math.round(s.wirePerConduitFt * (input.conductors / s.baseConductors) * 100) / 100} conductor-ft per conduit-ft × ${Math.round(share * 100)}% = ${f0(wireBase * share)} ft.` };
    }
    // NB-2 — the estimator's own footage in the scope comes off the allowance.
    const u = userFt[scope];
    const take = row.item === RATIO_ITEMS.mc ? u.mcFt : isWire ? u.wireFt * share : u.conduitFt;
    if (take > 0) {
      const before = Number(next.qty);
      const after = Math.max(0, f0(before - take));
      next = { ...next, qty: after, evidence: `Reduced by your entered/measured footage in this scope (${user[scope].slice(0, 3).join('; ')}${user[scope].length > 3 ? '; …' : ''}): ${before} − ${f0(take)} = ${after} ft. The allowance was: ${next.evidence}` };
    }
    if (noteText) next = { ...next, evidence: `${next.evidence}${noteText}` };
    generated.push(next);
  }
  return { takeoff, generated, scopes: decisions };
}
