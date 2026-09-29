// Fix round BL-2/3/4 — one source of truth per wiring scope.
//
// Four scopes: branch (branch conduit + wire), mc (fixture whips — separate
// material Chris carries alongside the branch run), feeder (feeders /
// HVAC / service), site (site lighting / poles / underground). Each scope's
// footage comes from exactly ONE source, in this order:
//   1. the estimator — an LF line in that scope they added by hand, typed a
//      qty on (qty_overridden), or confirmed from markups. The allowance for
//      the scope is then suppressed: "replaced by your entered/measured
//      footage".
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

/** Which wiring scope a line's text belongs to, or null (low voltage, empty
 *  or control conduit, grounding, trenching — not branch/feeder/site wiring). */
export function scopeOfText(text: string): WiringScope | null {
  const t = text ?? '';
  if (/\bempty\b|\bcontrol\b|low voltage|\bdata\b|telephone|\bphone\b|security|satellite|pull ?(?:wire|string)|alarm|\bcatv\b|fire alarm|\bgrounding\b|ground rod|electrode|\bbond(?:ing)?\b|bare copper|trench|\bbore\b/i.test(t)) return null;
  if (/\bsite\b|\bpoles?\b|underground|parking|area light|bollard/i.test(t) && !/power poles?/i.test(t)) return 'site';
  if (/feeder|\bhvac\b|\bservice\b|\bahu\b|\brtu\b|compressor|condens|\bmdp\b|transformer|\bxfmr\b|panel ?board|sub ?panel/i.test(t)) return 'feeder';
  if (/#\s*(?:\d\/0|[1-8])\b|\bkcmil\b/i.test(t)) return 'feeder';
  const spec = parseConductorRun(t);
  if (spec?.conductors.some(c => !c.ground && (/\/0|kcmil/.test(c.size) || Number(c.size) <= 8))) return 'feeder';
  const inches = conduitInches(t);
  if (inches != null && inches > 1 && /emt|pvc|conduit|rmc|imc|rigid|"\s*c\b/i.test(t)) return 'feeder';
  if (/\bmc\b|mc cable|\b12\/[23]\b|fixture whip/i.test(t)) return 'mc';
  if (/branch|circuit|home ?run|#\s*1[024]\b|\bthhn\b|\bthwn\b|\bemt\b|conduit|\bwire\b/i.test(t)) return 'branch';
  return null;
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

export interface ScopeDecision { source: 1 | 2 | 3; detail: string }

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

export function composeWiringRows(input: ComposeInput): ComposeResult {
  const scopes: WiringScope[] = ['branch', 'mc', 'feeder', 'site'];
  // 1 — the estimator's own footage.
  const user: Record<WiringScope, string[]> = { branch: [], mc: [], feeder: [], site: [] };
  for (const l of input.existing) {
    if (!isUserLine(l)) continue;
    const scope = scopeOfText(`${l.description} ${keyItem(l.takeoff_key)}`);
    if (scope) user[scope].push(`${l.description} ${Number(l.qty)} ${l.unit}`);
  }
  const userKeys = new Set(input.existing.filter(isUserLine).map(l => keyItem(l.takeoff_key)));
  const replacedByUser = (scope: WiringScope) => `Replaced by your entered/measured footage in this scope (${user[scope].slice(0, 3).join('; ')}${user[scope].length > 3 ? '; …' : ''}) — set to 0 so it is never counted twice.`;

  // 2 — Agent 2's footage.
  const agentComplete: Record<WiringScope, string[]> = { branch: [], mc: [], feeder: [], site: [] };
  const agentIncomplete: Record<WiringScope, string[]> = { branch: [], mc: [], feeder: [], site: [] };

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
    const zero = scope != null && user[scope].length > 0;
    if (useParts) {
      if (scope && hasFootage && !zero) agentComplete[scope].push(`${a.item} ${ft} ft`);
      for (const p of parts!) {
        generated.push({
          category, item: `${singleItem} — ${partLabel(p)}`, spec: p.description,
          qty: zero || !hasFootage ? 0 : Math.round(ft * p.perFtOfRun * 100) / 100, unit: 'LF', confidence: 'APPROX',
          evidence: zero ? replacedByUser(scope!)
            : `Agent 2 allowance, ESTIMATED: ${ft} ft of run × ${p.perFtOfRun} (${a.item})${note ? ` — ${note}` : ''}. Complete conduit + wire set, every part matched in the library.`,
        });
      }
      continue;
    }
    if (hasFootage && scope && !zero) {
      // Can't be read as a complete set — never a partial (conduit-only) price.
      agentIncomplete[scope].push(`${a.item} ${ft} ft`);
      generated.push({
        category, item: singleItem, spec: `${NEEDS_FOOTAGE_PREFIX}${a.item}`, qty: 0, unit: 'LF', confidence: 'APPROX',
        evidence: `Agent 2 read ${ft} ft off the plans, but its conduit/wire spec couldn't be matched completely in the library — the ratio allowance carries this scope instead. Type the footage here (and pick the match) if Agent 2's number is right; the ratio lines then go to 0.${note ? ` Agent 2: ${note}` : ''}`,
      });
      continue;
    }
    generated.push({
      category, item: singleItem,
      spec: hasFootage ? a.item : `${NEEDS_FOOTAGE_PREFIX}${a.item}`,
      qty: hasFootage && !zero ? ft : 0, unit: 'LF', confidence: 'APPROX',
      evidence: zero && hasFootage ? replacedByUser(scope!)
        : hasFootage ? `Agent 2 allowance, ESTIMATED: ${ft} ${String(a.unit ?? 'LF').toUpperCase()}${note ? ` — ${note}` : ''}`
        : `Agent 2 allowance with no footage on the plans — measure it or type a qty (not priced until then)${runSpecParts(`${NEEDS_FOOTAGE_PREFIX}${a.item}`) ? '; the conduit and the wire (run × conductors) price automatically from the typed run length' : ''}${scope ? `. Typing a footage here makes it the ${scope} footage — the ${scope} ratio allowance then goes to 0` : ''}${note ? `. Agent 2: ${note}` : ''}`,
    });
  }

  const takeoff: ComposeResult['takeoff'] = [];
  const agentPlain: Record<WiringScope, { conduit: boolean; wire: boolean; rows: string[] }> = {
    branch: { conduit: false, wire: false, rows: [] }, mc: { conduit: false, wire: false, rows: [] }, feeder: { conduit: false, wire: false, rows: [] }, site: { conduit: false, wire: false, rows: [] },
  };
  for (const r of input.takeoff) {
    const qty = typeof r.qty === 'number' ? r.qty : Number(r.qty);
    const text = `${r.item ?? ''} ${r.spec ?? ''}`;
    const scope = isLinear(r.unit) && Number.isFinite(qty) && qty > 0 ? scopeOfText(text) : null;
    if (!scope) { takeoff.push(r); continue; }
    const zero = user[scope].length > 0;
    const parts = runSpecParts(text, { requirePrefix: false });
    if (parts && parts.length > 1 && input.resolveParts(parts)) {
      if (!zero) agentComplete[scope].push(`${r.item} ${qty} ${r.unit}`);
      for (const p of parts) {
        takeoff.push({
          category: r.category, item: `${r.item} — ${partLabel(p)}`, spec: p.description, unit: 'LF',
          qty: zero ? 0 : Math.round(qty * p.perFtOfRun * 100) / 100,
          evidence: zero ? replacedByUser(scope) : `Agent 2 takeoff run ${qty} ${r.unit} (${r.item}) × ${p.perFtOfRun} — complete conduit + wire set.`,
        });
      }
      continue;
    }
    const plain = agentPlain[scope];
    if (/emt|pvc|conduit|rmc|imc|rigid/i.test(text)) plain.conduit = true;
    if (/thhn|thwn|\bwire\b|conductor|#\s*\d|\bmc\b/i.test(text)) plain.wire = true;
    plain.rows.push(`${r.item} ${qty} ${r.unit}`);
    takeoff.push(zero ? { ...r, qty: 0, evidence: replacedByUser(scope) } : r);
  }
  for (const scope of scopes) {
    const p = agentPlain[scope];
    if (user[scope].length) continue;
    // An MC row is conduit and wire in one: complete by itself.
    if ((p.conduit && p.wire) || (scope === 'mc' && p.rows.length)) agentComplete[scope].push(...p.rows);
    else if (p.rows.length) agentIncomplete[scope].push(...p.rows);
  }

  const decisions = {} as Record<WiringScope, ScopeDecision>;
  for (const scope of scopes) {
    decisions[scope] = user[scope].length ? { source: 1, detail: user[scope].join('; ') }
      : agentComplete[scope].length ? { source: 2, detail: agentComplete[scope].join('; ') }
      : { source: 3, detail: agentIncomplete[scope].length ? `Agent 2 also lists ${agentIncomplete[scope].join('; ')} — not a complete conduit + wire set, so the ratio carries this scope; check for double counting.` : '' };
  }

  // 3 — the ratio rows, after the one-source rule.
  const emtLine = input.existing.find(l => l.category === BRANCH_CATEGORY && keyItem(l.takeoff_key) === RATIO_ITEMS.emt);
  const measuredEmt = emtLine && !emtLine.excluded && Number(emtLine.qty) > 0 && (emtLine.qty_source === 'markup' || emtLine.qty_overridden) ? Number(emtLine.qty) : null;
  const s = input.settings;
  for (const row of input.ratioRows) {
    if (row.category === FEEDER_CATEGORY) {
      const d = decisions.feeder;
      generated.push(d.source === 3 ? row : { ...row, evidence: `${row.evidence} NOTE: the feeder scope already has footage (${d.source === 1 ? 'yours' : "Agent 2's"}: ${d.detail}) — enter a qty here only if this is a different run.` });
      continue;
    }
    const scope: WiringScope = row.item === RATIO_ITEMS.pvc ? 'site' : row.item === RATIO_ITEMS.mc ? 'mc' : 'branch';
    const d = decisions[scope];
    if (d.source === 1) { generated.push({ ...row, qty: 0, evidence: `${replacedByUser(scope)} The allowance would be: ${row.evidence}` }); continue; }
    if (d.source === 2) {
      generated.push({ ...row, qty: 0, evidence: `Replaced by Agent 2's footage read off the plans (${d.detail}) — set to 0 so it is never counted twice. The allowance would be: ${row.evidence}` });
      continue;
    }
    let next = row;
    // SF-3 — a measured / entered EMT run carries the wire with it.
    if (scope === 'branch' && measuredEmt != null && (row.item === RATIO_ITEMS.wire12 || row.item === RATIO_ITEMS.wire10)) {
      const total = measuredEmt * s.wirePerConduitFt * (input.conductors / s.baseConductors);
      const share = row.item === RATIO_ITEMS.wire10 ? s.wire10Share : 1 - s.wire10Share;
      next = { ...row, qty: Math.round(total * share), evidence: `Derived from your measured/entered EMT run: ${measuredEmt} ft × ${Math.round(s.wirePerConduitFt * (input.conductors / s.baseConductors) * 100) / 100} conductor-ft per conduit-ft × ${Math.round(share * 100)}% = ${Math.round(total * share)} ft.` };
    }
    if (d.detail) next = { ...next, evidence: `${next.evidence} NOTE: ${d.detail}` };
    generated.push(next);
  }
  return { takeoff, generated, scopes: decisions };
}
