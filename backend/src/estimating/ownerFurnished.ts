// Gap-closing T2 — owner-furnished material → labor only (gap #1; generalizes P fix round B5).
// Pure. Per term (lighting, panels, disconnects, power poles) the FURNISH half is collected from every source
// that names it:
//   * the account rule (a fixed term's furnishBy);
//   * every drawing / spec statement about the term (parseStatementParties: "by G.C." on electrical drawings is
//     APT scope, Decision 4);
//   * the estimator's scope answer — wins outright when present.
// Every source says Owner / Vendor → the term's lines carry LABOR ONLY (library material $0, quoted on the line).
// The sources disagree → the lines stay PRICED with a visible "furnish disputed" flag (never a hold, never $0).
// Nothing says Owner → no effect. A rule whose automatic deduct alternate covers the term is never zeroed (it is
// priced in and deducted as the alternate). Lines match a term by description (autoDeductAlternate's matcher,
// raceway / wire / feeder text never) or, for lighting, as a fixture line (isFixtureLine).
import { mentionsTerm, parseStatementParties, TERM_PATTERNS, type AccountTermsSnapshot, type Party, type ResolvedTerm, type TermKey, type AutoDeductAlternateConfig } from '../bidstd/accountRules';
import { lineMatchesAutoDeduct, NEVER_DEDUCT_RACEWAY_RE } from './autoDeductAlternate';

export const FURNISH_TERMS = ['lighting', 'panels', 'disconnects', 'power_poles'] as const;
export type FurnishTerm = typeof FURNISH_TERMS[number];

export interface FurnishSource { kind: 'rule' | 'drawings' | 'estimator'; party: Party; sheet?: string; quote?: string }
export interface FurnishDecision {
  term: FurnishTerm;
  mode: 'labor_only' | 'disputed';
  sources: FurnishSource[];
  /** For a disputed disconnect term: every owner statement names FUSED switches, so only fused lines are disputed. */
  fusedOnly?: boolean;
  /** The line evidence ("Owner-furnished — labor only: E-4 'PANEL A AUTOZONE PROVIDED'"). */
  evidence: string;
}
export type OwnerFurnishedDecisions = Partial<Record<FurnishTerm, FurnishDecision>>;

const isOwnerSide = (p: Party) => p === 'Owner' || p === 'Vendor';
const short = (q: string) => (q.length > 110 ? `${q.slice(0, 107)}…` : q);

function statementsFor(term: TermKey, snap: AccountTermsSnapshot) {
  // The same filter accountRules.statementsFor uses: about the term, and power-pole statements stay out of the
  // panels / lighting terms.
  return snap.statements.filter(s => mentionsTerm(term, `${s.item} ${s.quote}`) && (term === 'power_poles' || !TERM_PATTERNS.power_poles.test(`${s.item}`)));
}

export function decideOwnerFurnished(
  snap: AccountTermsSnapshot | null,
  opts: { estimatorTerms?: ResolvedTerm[]; autoDeductAlternate?: AutoDeductAlternateConfig | null } = {},
): OwnerFurnishedDecisions {
  const out: OwnerFurnishedDecisions = {};
  if (!snap) return out;
  for (const term of FURNISH_TERMS) {
    if (opts.autoDeductAlternate?.enabled && opts.autoDeductAlternate.termKeys.includes(term)) continue;
    const answer = (opts.estimatorTerms ?? []).find(t => t.term === term && t.source === 'estimator');
    if (answer) {
      if (!isOwnerSide(answer.furnishBy)) continue;
      out[term] = { term, mode: 'labor_only', sources: [{ kind: 'estimator', party: answer.furnishBy }], evidence: `Owner-furnished — labor only: your scope answer (furnished by ${answer.furnishBy}).` };
      continue;
    }
    const sources: FurnishSource[] = [];
    const rt = snap.ruleTerms[term];
    if (rt && rt.mode === 'fixed') sources.push({ kind: 'rule', party: rt.furnishBy, quote: `${snap.ruleName} account rule` });
    for (const s of statementsFor(term, snap)) {
      const p = parseStatementParties(s.furnishBy, s.installBy, s.quote).furnish;
      if (p) sources.push({ kind: 'drawings', party: p, sheet: s.sourceSheet, quote: s.quote });
    }
    if (!sources.length || !sources.some(s => isOwnerSide(s.party))) continue;
    const drawingOwner = sources.filter(s => s.kind === 'drawings' && isOwnerSide(s.party));
    const cite = (drawingOwner[0] ?? sources[0]);
    const citeText = cite.kind === 'drawings' ? `${cite.sheet || 'drawings'} "${short(cite.quote ?? '')}"` : String(cite.quote);
    if (sources.every(s => isOwnerSide(s.party))) {
      out[term] = { term, mode: 'labor_only', sources, evidence: `Owner-furnished — labor only: ${citeText}${sources.length > 1 ? ` (+${sources.length - 1} more source${sources.length > 2 ? 's' : ''} agree)` : ''}.` };
      continue;
    }
    const against = sources.find(s => !isOwnerSide(s.party))!;
    const againstText = against.kind === 'drawings' ? `${against.sheet || 'drawings'} "${short(against.quote ?? '')}"` : `${against.quote} (${against.party})`;
    const fusedOnly = term === 'disconnects' && drawingOwner.length > 0 && drawingOwner.every(s => /\bfus(?:ed|ible)\b/i.test(s.quote ?? ''));
    out[term] = { term, mode: 'disputed', sources, ...(fusedOnly ? { fusedOnly } : {}),
      evidence: `Furnish disputed — ${citeText} says the owner furnishes it; ${againstText} says APT. Priced until you answer scope:${term}.` };
  }
  return out;
}

export interface FurnishLineLike { category: string; description: string; matchedName?: string | null }

const PANELBOARD_RE = /\bpanel\s*boards?\b|\bload\s*centers?\b|\b\d{2,4}\s*a\s+(?:mlo|mcb)\b/i;

/** The term a line belongs to (first match: power poles, panels, disconnects, lighting). The line's own words and
 *  its matched library row's name must agree it IS the thing (a "panel" word alone — "thermostats above panels" —
 *  is not a panelboard). */
export function furnishTermOfLine(line: FurnishLineLike, fixtureLine: boolean): FurnishTerm | null {
  const d = line.description ?? '';
  const both = `${d} ${line.matchedName ?? ''}`;
  if (NEVER_DEDUCT_RACEWAY_RE.test(d)) return null;
  if (mentionsTerm('power_poles', d) && (!line.matchedName || mentionsTerm('power_poles', line.matchedName))) return 'power_poles';
  if (lineMatchesAutoDeduct(line, ['panels']) && PANELBOARD_RE.test(both)) return 'panels';
  if ((lineMatchesAutoDeduct(line, ['disconnects']) || /\bfus(?:ed|ible)\s+(?:safety\s+)?switch/i.test(d))
    && (!line.matchedName || /disconnect|safety switch|fus(?:ed|ible) switch/i.test(line.matchedName))) return 'disconnects';
  if (fixtureLine || (lineMatchesAutoDeduct(line, ['lighting']) && (!line.matchedName || lineMatchesAutoDeduct({ category: line.category, description: line.matchedName }, ['lighting'])))) return 'lighting';
  return null;
}

/** The decision that applies to one line, or null. */
export function furnishDecisionForLine(decisions: OwnerFurnishedDecisions, line: FurnishLineLike, fixtureLine: boolean): FurnishDecision | null {
  const term = furnishTermOfLine(line, fixtureLine);
  const d = term ? decisions[term] : undefined;
  if (!d) return null;
  if (d.fusedOnly && !/\bfus(?:ed|ible)\b/i.test(`${line.description} ${line.matchedName ?? ''}`)) return null;
  return d;
}
