// Takeoff accuracy, Task 8 — account rules (Decision 8). Pure: no I/O.
//
// A rule says, for one national account / brand (matched by case-insensitive
// aliases against the bid's brand, the bid name and the owner/GC names the
// drawings print) and optionally a project type, who furnishes and who
// installs each kind of material, plus required scope bullets and forbidden
// phrases. The Default rule applies when nothing else matches (lighting ECFECI
// through Southern Lighting Source — moved here out of the prompt text).
//
// Each furnish/install TERM is either
//   * fixed  — the rule states the answer ("Owner via Graybar"), or
//   * ask    — the answer comes from the drawings, else from the estimator.
// Explicit furnish/install statements on the drawings (Agent 1's
// furnishStatements, with sheet + verbatim quote) always win for an `ask`
// term, and are NEVER silently overridden by a `fixed` value: a contradiction
// becomes a scope question for the estimator. An unanswered `ask` term with no
// drawing statement is a scope question too. Scope questions sit in the Task 7
// Needs-review list and block the proposal until answered.
//
// The resolved terms are rendered into the Agent 2 / Agent 4 prompts AND
// enforced deterministically on Agent 4's output (Section C lighting bullet,
// takeoff furnish_by, ECFECI tags, MDP language, items another party
// furnishes and installs, required bullets) — with every change logged —
// and verifyBid blocks the rule's forbidden phrases.
import type { Agent4Output, Agent4Section } from '../ai/agent4Message';
import { tradeAssignmentOf, GC_MEANS_APT_RULE } from './tradeAssignment';

export type Party = 'APT' | 'GC' | 'Owner' | 'Vendor' | 'Others';
export const PARTIES: Party[] = ['APT', 'GC', 'Owner', 'Vendor', 'Others'];

export type TermKey = 'lighting' | 'panels' | 'disconnects' | 'power_poles' | 'other_equipment';
export const TERM_KEYS: TermKey[] = ['lighting', 'panels', 'disconnects', 'power_poles', 'other_equipment'];

export const TERM_LABELS: Record<TermKey, string> = {
  lighting: 'Lighting fixtures',
  panels: 'Panelboards',
  disconnects: 'Disconnects / safety switches',
  power_poles: 'Power poles',
  other_equipment: 'Other equipment',
};

/** What a term covers, for matching drawing statements, scope bullets and
 *  takeoff lines to it. */
export const TERM_PATTERNS: Record<TermKey, RegExp> = {
  lighting: /\b(light(ing)?\s+fixtures?|fixtures?|luminaires?|lighting\s+package)\b/i,
  panels: /\b(panel\s*boards?|panels?|load\s*centers?)\b(?!\s*schedule)/i,
  disconnects: /\b(disconnects?|safety\s+switch(es)?)\b/i,
  power_poles: /\bpower\s*poles?\b/i,
  other_equipment: /\bequipment\b/i,
};

/** N9 — look-alikes that are NOT the term: "plumbing fixtures" are not
 *  lighting fixtures, a "fire alarm panel" is not a panelboard. */
const TERM_EXCLUDE: Partial<Record<TermKey, RegExp>> = {
  lighting: /\b(plumbing|sanitary|toilet|lavatory|water\s+closet|urinal|sink)\b[^.;]*\bfixtures?\b|\bfixtures?\b[^.;]*\b(plumbing|toilet|lavator)/i,
  panels: /\b(fire\s+alarm|facp|annunciator|security|access\s+control|solar|pv|control|access|data|patch|telephone|nurse\s+call)\s+panels?\b/i,
  disconnects: /\bdisconnect(ed|ing)?\s+(from|the\s+existing|existing)\b/i,
};

/** Text is about the term (its pattern, minus the N9 look-alikes). */
export function mentionsTerm(term: TermKey, text: string): boolean {
  if (!TERM_PATTERNS[term].test(text)) return false;
  const ex = TERM_EXCLUDE[term];
  if (!ex || !ex.test(text)) return true;
  // The look-alike is there — only count it if the term also appears on its own.
  const stripped = text.replace(new RegExp(ex.source, 'gi'), ' ');
  return TERM_PATTERNS[term].test(stripped);
}

export interface FixedTerm {
  mode: 'fixed';
  furnishBy: Party;
  installBy: Party;
  vendor?: string;
  contact?: string;
}
export interface AskTerm { mode: 'ask' }
export type RuleTerm = FixedTerm | AskTerm;

export interface RequiredBullet { section: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; text: string }

export interface AccountRule {
  id: string;
  name: string;
  isDefault: boolean;
  matchAliases: string[];
  projectTypes: string[];
  priority: number;
  terms: Partial<Record<TermKey, RuleTerm>>;
  requiredScopeBullets: RequiredBullet[];
  forbiddenPhrases: string[];
  /** Only mention an MDP when the drawings show one. */
  noMdpUnlessOnDrawings: boolean;
  notes: string;
  active: boolean;
  /** Next round Part B (coordinator follow-up) — an optional automatic
   *  deduct/add alternate this rule prices for the bid (the 7-Eleven Graybar
   *  package: "furnished by others instead" deducts the material + material
   *  markup + tax of the terms listed in termKeys). Computed from the bid's
   *  own recap by estimating/autoDeductAlternate.ts, never hand-typed. */
  autoDeductAlternate?: AutoDeductAlternateConfig | null;
}

export interface AutoDeductAlternateConfig {
  enabled: boolean;
  /** Which of this rule's terms the deduct is priced against (their
   *  material $, matched to bid lines by category/description — see
   *  estimating/autoDeductAlternate.ts). */
  termKeys: TermKey[];
  /** Whether the deducted amount also backs out tax on those items. */
  taxable?: boolean;
  /** May contain the literal token %AMOUNT% (replaced with the formatted
   *  dollar amount when the alternate is generated). */
  label: string;
}

export interface FurnishStatement { item: string; furnishBy: string; installBy: string; sourceSheet: string; quote: string }

export interface ResolvedTerm {
  term: TermKey;
  furnishBy: Party;
  installBy: Party;
  vendor?: string;
  contact?: string;
  source: 'rule' | 'drawings' | 'estimator';
  /** Drawing citation when source is 'drawings' (or for a conflict). */
  citation?: { sheet: string; quote: string };
}

export interface TermQuestion {
  term: TermKey;
  kind: 'ask' | 'conflict';
  label: string;
  question: string;
  options: string[];
  notes: string[];
  /** B7 — an `ask` term is asked in two halves: who FURNISHES and who
   *  INSTALLS (APT / GC / Owner / Vendor each). A half the drawings state is
   *  not asked (it is in `known`). */
  half?: 'furnish' | 'install';
  known?: { furnishBy?: Party; installBy?: Party; citation?: { sheet: string; quote: string } };
  /** B7/S7 — conflict options carry their structured parties (same order as
   *  options); nothing re-parses the display text. */
  optionParties?: Array<{ furnishBy: Party; installBy: Party }>;
  /** Next round A6 — the pre-filled answer ("by G.C." on the drawings -> APT). */
  suggested?: Party;
}

export const ASK_PARTIES: Party[] = ['APT', 'GC', 'Owner', 'Vendor'];

export interface AccountTermsSnapshot {
  ruleId: string | null;
  ruleName: string;
  matchedBy: string;
  /** The rule's terms as they were when this run was analysed (a later edit
   *  of the rule never changes what an earlier run's answers mean). */
  ruleTerms: Partial<Record<TermKey, RuleTerm>>;
  /** Terms settled at analysis time (rule or drawings). */
  resolved: ResolvedTerm[];
  /** Terms waiting on the estimator (a scope question per entry). */
  questions: TermQuestion[];
  /** Drawing statements the rule's fixed values agreed with / were checked against. */
  statements: FurnishStatement[];
  requiredScopeBullets: RequiredBullet[];
  forbiddenPhrases: string[];
  noMdpUnlessOnDrawings: boolean;
  mdpOnDrawings: boolean;
  /** S8 — shown in the Takeoff step: e.g. a brand is set but only the
   *  Default rule matched. */
  warning?: string;
}

// ── Matching ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Alias as a whole-word run inside `text` (punctuation-insensitive:
 *  "7-Eleven" matches "7 eleven", "AutoZone #10077" matches "autozone"). */
export function aliasMatches(alias: string, text: string): boolean {
  const a = norm(alias);
  const t = ` ${norm(text)} `;
  return !!a && t.includes(` ${a} `);
}

/** S8 — the bid's own GC name is NEVER a match input (a GC called "Auto
 *  Zone Construction Group" must not make a Dunkin' job AutoZone). Drawing
 *  text only: the owner and project name the drawings print (and what they
 *  print in the contractor slot, moved to gc_extracted by the GC hygiene). */
export interface MatchInput { brand?: string | null; bidName?: string | null; owner?: string | null; drawingsProject?: string | null; gcExtracted?: string | null; projectType?: string | null }

/** The one rule for this bid: rules whose aliases match win (a rule that ALSO
 *  matches the project type outranks one that doesn't), then project-type-only
 *  rules, then the Default. Ties: lower priority number, then name. */
export function matchAccountRule(rules: AccountRule[], input: MatchInput): { rule: AccountRule | null; matchedBy: string; warning?: string } {
  const texts: Array<[string, string]> = [
    ['brand', input.brand ?? ''], ['owner', input.owner ?? ''], ['bid name', input.bidName ?? ''],
    ['drawings', `${input.drawingsProject ?? ''} ${input.gcExtracted ?? ''}`.trim()],
  ];
  const pt = (input.projectType ?? '').trim();
  const active = rules.filter(r => r.active);
  const scored: Array<{ r: AccountRule; score: number; by: string; where: string }> = [];
  for (const r of active) {
    if (r.isDefault) continue;
    const typeOk = r.projectTypes.length === 0 || (pt !== '' && r.projectTypes.includes(pt));
    if (!typeOk) continue;
    // The strongest place an alias matched: the brand field first (R2-B3).
    let hit: { a: string; where: string } | null = null;
    for (const [where, t] of texts) {
      const a = t ? r.matchAliases.find(al => aliasMatches(al, t)) : undefined;
      if (a) { hit = { a, where }; break; }
    }
    if (r.matchAliases.length) {
      if (!hit) continue;
      // R2-B3 — a match on the brand field always outranks a name/drawings one.
      const base = hit.where === 'brand' ? 10 : 2;
      scored.push({ r, score: base + (r.projectTypes.length ? 1 : 0), by: `"${hit.a}" in the ${hit.where}`, where: hit.where });
    } else if (r.projectTypes.length) {
      scored.push({ r, score: 1, by: `project type ${pt}`, where: 'project type' });
    }
  }
  scored.sort((x, y) => y.score - x.score || x.r.priority - y.r.priority || x.r.name.localeCompare(y.r.name));
  if (scored.length) {
    const top = scored[0];
    const others = scored.slice(1).filter(x => x.r.matchAliases.length).map(x => `${x.r.name} (${x.by})`);
    const warning = others.length
      ? `More than one account rule matched: ${top.r.name} (${top.by}) was used; also matched ${others.join(', ')}. Check the brand field.`
      : top.where !== 'brand' && top.where !== 'project type'
        ? `The ${top.r.name} rule matched only from the ${top.where} (${top.by}), not the brand field — confirm this is a ${top.r.name} job.`
        : undefined;
    return { rule: top.r, matchedBy: top.by, ...(warning ? { warning } : {}) };
  }
  const def = active.find(r => r.isDefault) ?? null;
  return { rule: def, matchedBy: def ? 'default (no account rule matched)' : 'no rule' };
}

// ── Parties ─────────────────────────────────────────────────────────────────

/** A party as printed on the drawings -> our vocabulary; null when unclear. */
export function normalizeParty(raw: string): Party | null {
  const s = raw.toLowerCase();
  if (!s.trim()) return null;
  if (/\b(e\.?c\.?|electrical\s+contractor|electrician|apt|accurate\s+power|div(ision)?\s*26)\b/.test(s)) return 'APT';
  if (/\b(g\.?c\.?|general\s+contractor)\b/.test(s)) return 'GC';
  if (/\b(owner|tenant|landlord|autozone|7[\s-]?eleven|client)\b/.test(s)) return 'Owner';
  if (/\b(vendor|manufacturer|supplier)\b/.test(s)) return 'Vendor';
  if (/\bothers?\b/.test(s)) return 'Others';
  return null;
}

function partyPhrase(p: Party): string {
  return p === 'APT' ? 'APT' : p === 'Others' ? 'others' : p === 'Vendor' ? 'the equipment vendor' : p === 'GC' ? 'the GC' : 'the Owner';
}

export function describeTerm(t: Pick<ResolvedTerm, 'term' | 'furnishBy' | 'installBy' | 'vendor' | 'contact'>): string {
  const what = TERM_LABELS[t.term];
  const via = t.vendor ? ` through the ${t.vendor}${t.contact ? ` (${t.contact})` : ''}` : '';
  if (t.furnishBy === t.installBy) return `${what}: furnished and installed by ${partyPhrase(t.furnishBy)}${via}.`;
  return `${what}: furnished by ${partyPhrase(t.furnishBy)}${via}; installed by ${partyPhrase(t.installBy)}.`;
}

// ── Resolution ──────────────────────────────────────────────────────────────

function statementsFor(term: TermKey, statements: FurnishStatement[]): FurnishStatement[] {
  return statements.filter(s => mentionsTerm(term, `${s.item} ${s.quote}`)
    // "power poles" also matches /equipment/-free patterns; keep poles out of panels/lighting
    && (term === 'power_poles' || !TERM_PATTERNS.power_poles.test(`${s.item}`)));
}

const PARTY_WORDS = String.raw`(?:the\s+)?([a-z0-9.&'\- ]+?)`;
/** S7 — furnish and install parsed SEPARATELY from a drawing statement:
 *  "FURNISHED BY GC, INSTALLED AND WIRED BY EC" -> GC / APT;
 *  "FURNISHED AND INSTALLED BY OWNER", "F&I BY GC" -> both;
 *  "BY EQUIPMENT VENDOR", "BY OTHERS" -> both (multi-word parties);
 *  a half the statement doesn't give stays null (never copied from the other). */
export function parseStatementParties(furnishByRaw: string, installByRaw: string, quoteRaw: string): StatementParties {
  const raw = parseStatementPartiesRaw(furnishByRaw, installByRaw, quoteRaw);
  // Next round A6 (Decision 4) — on electrical drawings "by G.C." is APT
  // scope: the GC subcontracts the electrical to APT. Read as APT, and
  // remember it came from a GC note (an `ask` term is still asked, with APT
  // pre-filled).
  const viaGc = { furnish: raw.furnish === 'GC', install: raw.install === 'GC' };
  return {
    furnish: raw.furnish === 'GC' ? 'APT' : raw.furnish,
    install: raw.install === 'GC' ? 'APT' : raw.install,
    ...(viaGc.furnish || viaGc.install ? { viaGc } : {}),
  };
}

export interface StatementParties { furnish: Party | null; install: Party | null; viaGc?: { furnish: boolean; install: boolean } }

/** The parties exactly as printed (GC stays GC). parseStatementParties is
 *  the DRAWINGS reader (GC read as APT, Decision 4); statedParties checks
 *  our own scope text against the resolved terms and uses this one — an
 *  estimator's "GC" answer is a real GC. */
export function parseStatementPartiesRaw(furnishByRaw: string, installByRaw: string, quoteRaw: string): { furnish: Party | null; install: Party | null } {
  let furnish = normalizeParty(furnishByRaw);
  let install = normalizeParty(installByRaw);
  const q = ` ${quoteRaw.toLowerCase().replace(/\s+/g, ' ')} `;
  const end = String.raw`(?=[.;,)]|\s+and\s+(?:install|furnish|wir)|\s+(?:to|for|per|at|on|in)\s|$| $)`;
  const both = new RegExp(String.raw`(?:furnish(?:ed)?(?:,)?\s+(?:and|&)\s+install(?:ed)?|f\s*&\s*i|f\/i|provided\s+and\s+installed|supplied\s+and\s+installed)(?:[a-z ,&-]*?)\s+by\s+${PARTY_WORDS}${end}`).exec(q);
  if (both) {
    const p = normalizeParty(both[1]);
    if (p) { furnish ??= p; install ??= p; }
  }
  const f = new RegExp(String.raw`(?:furnish(?:ed)?|supplied|provided)\s+by\s+${PARTY_WORDS}${end}`).exec(q);
  if (f && !furnish) furnish = normalizeParty(f[1]);
  const i = new RegExp(String.raw`install(?:ed)?(?:\s+(?:and|&)\s+(?:hard[- ]?)?wired)?\s+by\s+${PARTY_WORDS}${end}`).exec(q);
  if (i && !install) install = normalizeParty(i[1]);
  if (!furnish && !install) {
    // "BY OTHERS", "(BY EQUIPMENT VENDOR)", "N.I.C. — BY OWNER": a bare "by X" covers both.
    const bare = new RegExp(String.raw`\bby\s+${PARTY_WORDS}${end}`).exec(q);
    const p = bare ? normalizeParty(bare[1]) : null;
    if (p && !/\b(furnish|install|supplied|provided)\b/.test(q.slice(0, bare!.index))) { furnish = p; install = p; }
  }
  if (!furnish && !install) {
    // "G.C. FURNISHED/INSTALLED", "OWNER FURNISHED, EC INSTALLED" — the
    // party before the verb (tradeAssignment's reader; a GC half stays GC
    // here — parseStatementParties reads it as APT and remembers it).
    const a = tradeAssignmentOf(quoteRaw);
    const map = (x: string | null, gc: boolean): Party | null => gc ? 'GC'
      : x === 'APT' ? 'APT' : x === 'Owner' ? 'Owner' : x === 'Vendor' ? 'Vendor' : x === 'Others' || x === 'OtherTrade' ? 'Others' : null;
    if (a) { furnish = map(a.furnish, a.gcHalves.furnish); install = map(a.install, a.gcHalves.install); }
  }
  return { furnish, install };
}

function statementParties(s: FurnishStatement): StatementParties {
  return parseStatementParties(s.furnishBy, s.installBy, s.quote);
}

export function resolveAccountTerms(
  rule: AccountRule | null,
  matchedBy: string,
  statementsRaw: unknown,
  mdpOnDrawings: boolean,
  aiNotesForTerm: (term: TermKey) => string[] = () => [],
): AccountTermsSnapshot {
  const statements: FurnishStatement[] = (Array.isArray(statementsRaw) ? statementsRaw : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      item: String(s.item ?? ''), furnishBy: String(s.furnishBy ?? ''), installBy: String(s.installBy ?? ''),
      sourceSheet: String(s.sourceSheet ?? ''), quote: String(s.quote ?? '').slice(0, 300),
    }))
    .filter(s => s.quote.trim() || s.item.trim());
  const resolved: ResolvedTerm[] = [];
  const questions: TermQuestion[] = [];

  for (const term of TERM_KEYS) {
    const rt = rule?.terms[term];
    if (!rt) continue;
    const found = statementsFor(term, statements)
      .map(s => ({ s, ...statementParties(s) }))
      .filter(x => x.furnish || x.install);
    const label = TERM_LABELS[term];
    if (rt.mode === 'ask') {
      // B7/S7 — an explicit drawing statement wins, half by half; any half
      // the drawings leave open is asked on its own (APT / GC / Owner / Vendor).
      const best = found.find(x => x.furnish && x.install) ?? found[0];
      const installSrc = best?.install ? best : found.find(x => x.install);
      // A6 — a half that came from a "by G.C." note is still asked (the
      // account rule says ask), with APT pre-filled; the rest is known.
      const gcFurnish = !!best?.viaGc?.furnish;
      const gcInstall = !!installSrc?.viaGc?.install;
      const furnishBy = gcFurnish ? null : best?.furnish ?? null;
      const installBy = gcInstall ? null : installSrc?.install ?? null;
      const citation = best ? { sheet: best.s.sourceSheet, quote: best.s.quote } : undefined;
      if (furnishBy && installBy) {
        resolved.push({ term, furnishBy, installBy, source: 'drawings', citation });
        continue;
      }
      const notes = [
        best ? `${best.s.sourceSheet || 'Drawings'}: "${best.s.quote}"` : 'No furnish/install statement for this was found on the drawings.',
        ...(gcFurnish || gcInstall ? ['The drawings say "by G.C." — on electrical drawings that is APT scope (the GC subcontracts the electrical to APT), so APT is pre-filled.'] : []),
        ...aiNotesForTerm(term),
      ];
      const known = { ...(furnishBy ? { furnishBy } : {}), ...(installBy ? { installBy } : {}), ...(citation ? { citation } : {}) };
      if (!furnishBy) {
        questions.push({
          term, kind: 'ask', half: 'furnish', label: `${label} — furnished by`,
          question: `Who FURNISHES the ${label.toLowerCase()}? (APT / GC / Owner / Vendor)`,
          options: [...ASK_PARTIES], notes, known, ...(gcFurnish ? { suggested: 'APT' as Party } : {}),
        });
      }
      if (!installBy) {
        questions.push({
          term, kind: 'ask', half: 'install', label: `${label} — installed by`,
          question: `Who INSTALLS the ${label.toLowerCase()}? (APT / GC / Owner / Vendor)`,
          options: [...ASK_PARTIES], notes, known, ...(gcInstall ? { suggested: 'APT' as Party } : {}),
        });
      }
      continue;
    }
    // fixed
    const conflict = found.find(x => (x.furnish && x.furnish !== rt.furnishBy) || (x.install && x.install !== rt.installBy));
    if (conflict) {
      const drawings: ResolvedTerm = {
        term, furnishBy: conflict.furnish ?? rt.furnishBy, installBy: conflict.install ?? rt.installBy, source: 'drawings',
      };
      questions.push({
        term, kind: 'conflict', label,
        question: `The drawings and the ${rule!.name} account rule disagree on the ${label.toLowerCase()}. Which applies?`,
        options: [
          `Drawings — ${describeTerm(drawings)}`,
          `Account rule — ${describeTerm({ term, ...rt })}`,
        ],
        optionParties: [
          { furnishBy: drawings.furnishBy, installBy: drawings.installBy },
          { furnishBy: rt.furnishBy, installBy: rt.installBy },
        ],
        notes: [
          `${conflict.s.sourceSheet || 'Drawings'}: "${conflict.s.quote}"`,
          `Account rule (${rule!.name}): ${describeTerm({ term, ...rt })}`,
          ...aiNotesForTerm(term),
        ],
      });
      continue;
    }
    const agreeing = found[0];
    resolved.push({
      term, furnishBy: rt.furnishBy, installBy: rt.installBy, vendor: rt.vendor, contact: rt.contact, source: 'rule',
      ...(agreeing ? { citation: { sheet: agreeing.s.sourceSheet, quote: agreeing.s.quote } } : {}),
    });
  }

  return {
    ruleId: rule?.id ?? null,
    ruleName: rule?.name ?? '(none)',
    matchedBy,
    ruleTerms: rule?.terms ?? {},
    resolved,
    questions,
    statements,
    requiredScopeBullets: rule?.requiredScopeBullets ?? [],
    forbiddenPhrases: rule?.forbiddenPhrases ?? [],
    noMdpUnlessOnDrawings: rule?.noMdpUnlessOnDrawings ?? false,
    mdpOnDrawings,
  };
}

/** One answered scope question, as the review item stores it (S7: with
 *  the structured parties of the chosen option — never re-parsed text). */
export interface ScopeAnswer { answer: string; furnishBy?: string; installBy?: string }

/** The review item id for a question. */
export function scopeQuestionId(q: Pick<TermQuestion, 'term' | 'half'>): string {
  return q.half ? `scope:${q.term}:${q.half}` : `scope:${q.term}`;
}

/** Apply the estimator's answers to the snapshot: a term becomes resolved
 *  once every one of its questions is answered (an `ask` term's furnish and
 *  install halves, or a conflict's choice). Unanswered questions stay open
 *  (the gate keeps them blocked). An answer that doesn't parse resolves
 *  nothing. */
export function applyScopeAnswers(
  snap: AccountTermsSnapshot,
  answersIn: Record<string, string | ScopeAnswer>,
): ResolvedTerm[] {
  const answers: Record<string, ScopeAnswer> = {};
  for (const [k, v] of Object.entries(answersIn)) answers[k] = typeof v === 'string' ? { answer: v } : v;
  const out = [...snap.resolved];
  const terms = [...new Set(snap.questions.map(q => q.term))];
  for (const term of terms) {
    const qs = snap.questions.filter(q => q.term === term);
    const conflict = qs.find(q => q.kind === 'conflict');
    if (conflict) {
      const a = answers[scopeQuestionId(conflict)];
      if (!a) continue;
      const idx = conflict.options.indexOf(a.answer);
      const parties = conflict.optionParties?.[idx];
      const rt = snap.ruleTerms[term];
      if (parties) {
        const fromRule = idx === 1 && rt && rt.mode === 'fixed';
        out.push({ term, furnishBy: parties.furnishBy, installBy: parties.installBy, source: 'estimator',
          ...(fromRule ? { vendor: rt.vendor, contact: rt.contact } : {}) });
      } else if (a.answer.startsWith('Account rule') && rt && rt.mode === 'fixed') {
        out.push({ term, furnishBy: rt.furnishBy, installBy: rt.installBy, vendor: rt.vendor, contact: rt.contact, source: 'estimator' });
      }
      continue;
    }
    // ask: halves. A legacy single question (`scope:<term>`, one party for
    // both) from a run before fix round 1 still resolves.
    const legacy = answers[`scope:${term}`];
    const known = qs[0]?.known ?? {};
    const pick = (half: 'furnish' | 'install'): Party | null => {
      const a = answers[`scope:${term}:${half}`];
      const fromAnswer: Party | null = !a ? null
        : (PARTIES as string[]).includes(a.answer) ? (a.answer as Party) : normalizeParty(a.answer);
      if (fromAnswer) return fromAnswer;
      const k = half === 'furnish' ? known.furnishBy : known.installBy;
      if (k) return k;
      return legacy && !qs.some(q => q.half) ? normalizeParty(legacy.answer) : null;
    };
    const f = pick('furnish');
    const i = pick('install');
    if (f && i) out.push({ term, furnishBy: f, installBy: i, source: 'estimator', ...(known.citation ? { citation: known.citation } : {}) });
  }
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export const DEFAULT_LIGHTING_BULLET = 'Complete lighting package (ECFECI) — procured through the Southern Lighting Source national account (770-242-4000). EC to receive, inventory, and install all fixtures per schedule.';

/** Section C bullet 1 for the lighting term. APT-furnished keeps the standard
 *  ECFECI sentence (vendor/contact from the rule). */
export function lightingSectionCBullet(t: ResolvedTerm | undefined): string | null {
  if (!t) return null;
  const via = t.vendor ? ` through the ${t.vendor}${t.contact ? ` (${t.contact})` : ''}` : '';
  if (t.furnishBy === 'APT') {
    return `Complete lighting package (ECFECI) — procured${via || ' by APT'}. EC to receive, inventory, and install all fixtures per schedule.`;
  }
  if (t.installBy === 'APT') {
    return `Lighting fixtures furnished by ${partyPhrase(t.furnishBy)}${via}. EC to receive, inventory, and install all fixtures per schedule.`;
  }
  return `Lighting fixtures furnished and installed by ${partyPhrase(t.furnishBy)}${via}; not in EC scope.`;
}

/** TERMS bullet 4 (boilerplate.ts) for the lighting term. */
export function lightingTermsBullet(t: ResolvedTerm | undefined): string | undefined {
  if (!t) return undefined;
  const via = t.vendor ? ` through the ${t.vendor}` : '';
  if (t.furnishBy === 'APT') return `Lighting package to be procured${via || ' by APT'}. EC to receive, inventory, and install.`;
  if (t.installBy === 'APT') return `Lighting fixtures furnished by ${partyPhrase(t.furnishBy)}${via}. EC to receive, inventory, and install.`;
  return `Lighting fixtures furnished and installed by ${partyPhrase(t.furnishBy)}${via}; not in EC scope.`;
}

export function furnishByLabel(t: ResolvedTerm): string {
  const via = t.vendor ? ` / ${t.vendor}` : '';
  if (t.furnishBy === 'APT') return 'APT (ECFECI)';
  const who = t.furnishBy === 'Owner' ? 'Owner' : t.furnishBy === 'GC' ? 'GC' : t.furnishBy === 'Vendor' ? 'Equipment vendor' : 'Others';
  return t.installBy === 'APT' ? `${who}${via} (EC installs)` : `${who}${via} (by others — not in EC scope)`;
}

/** Phrases verifyBid must block for this job: the rule's own list, plus the
 *  default supplier language whenever lighting is NOT APT-furnished. */
export function effectiveForbiddenPhrases(snap: AccountTermsSnapshot, resolved: ResolvedTerm[]): string[] {
  const out = new Set(snap.forbiddenPhrases.map(p => p.trim()).filter(Boolean));
  const lighting = resolved.find(r => r.term === 'lighting');
  if (lighting && lighting.furnishBy !== 'APT') {
    out.add('Southern Lighting Source');
    out.add('Complete lighting package (ECFECI)');
  }
  // The standard "Distribution gear (ECFECI): panels ..." sentence says APT
  // furnishes the panels — wrong when the rule says another party does.
  const panels = resolved.find(r => r.term === 'panels');
  if (panels && panels.furnishBy !== 'APT') out.add('Distribution gear (ECFECI)');
  const mdp = snap.noMdpUnlessOnDrawings && !snap.mdpOnDrawings;
  if (mdp) { out.add(' MDP'); out.add('main distribution panel'); }
  return [...out];
}

/** The block Agents 2 and 4 receive (user message), authoritative. */
export function renderAccountTermsBlock(snap: AccountTermsSnapshot | null, resolved: ResolvedTerm[]): string | null {
  if (!snap) return null;
  const lines: string[] = [
    `--- ACCOUNT TERMS (AUTHORITATIVE — overrides any furnish/install or supplier language elsewhere, including your instructions) ---`,
    `Account rule: ${snap.ruleName} (matched by ${snap.matchedBy}).`,
  ];
  for (const t of resolved) {
    const cite = t.citation ? ` [${t.source === 'drawings' ? 'per' : 'agrees with'} ${t.citation.sheet}: "${t.citation.quote}"]` : '';
    const tag = t.furnishBy === 'APT' ? ' Tag these (ECFECI).' : ' Never tag these (ECFECI).';
    lines.push(`- ${describeTerm(t)}${cite}${tag}`);
  }
  const lighting = resolved.find(r => r.term === 'lighting');
  const cBullet = lightingSectionCBullet(lighting);
  if (cBullet) lines.push(`- Section C bullet 1 must read exactly: "${cBullet}"`);
  // S6 — a question the estimator answered is decided: it appears above as
  // a resolved term, never also as "NOT YET DECIDED".
  const openTerms = [...new Set(snap.questions.map(q => q.term))].filter(t => !resolved.some(r => r.term === t));
  for (const t of openTerms) lines.push(`- ${TERM_LABELS[t]}: NOT YET DECIDED — do not state who furnishes or installs them.`);
  if (snap.noMdpUnlessOnDrawings && !snap.mdpOnDrawings) lines.push('- There is NO MDP on the drawings: never write "MDP" or "main distribution panel".');
  for (const b of snap.requiredScopeBullets) lines.push(`- Required Section ${b.section} bullet: "${b.text}"`);
  const forbidden = effectiveForbiddenPhrases(snap, resolved);
  if (forbidden.length) lines.push(`- Never write: ${forbidden.map(f => `"${f}"`).join(', ')}.`);
  // Next round A6 — Decision 4, for every account (the terms above win for
  // the terms they name).
  lines.push(`- ${GC_MEANS_APT_RULE}`);
  return lines.join('\n');
}

// ── Deterministic enforcement on Agent 4's output ───────────────────────────

export interface EnforcementResult {
  output: Agent4Output;
  corrections: string[];
}

function bulletText(b: string | { b: string; t: string }): string {
  return typeof b === 'string' ? b : `${b.b}${b.t}`;
}

/** Apply a text fix to a bullet, keeping a {b, t} bold-lead bullet's shape. */
function mapBullet<T extends string | { b: string; t: string }>(b: T, fn: (s: string) => string): T {
  return (typeof b === 'string' ? fn(b) : { b: fn(b.b), t: fn(b.t) }) as T;
}

const SECTION_LETTER = /^\s*([A-F])\./;
const LIGHTING_PROCUREMENT = /lighting package|lighting fixtures furnished|southern lighting|graybar|procured through|fixtures? (are )?(furnished|supplied|provided)/i;
const MDP_RE = /\bMDP\b|main distribution panel/i;

function partyMentioned(text: string, p: Party): boolean {
  const s = text.toLowerCase();
  if (p === 'GC') return /\b(g\.?c\.?|general contractor)\b/.test(s);
  if (p === 'Owner') return /\b(owner|autozone|7[\s-]?eleven|tenant)\b/.test(s);
  if (p === 'Vendor') return /\bvendor|manufacturer\b/.test(s);
  if (p === 'Others') return /\bothers?\b/.test(s);
  return /\b(apt|e\.?c\.?|electrical contractor)\b/.test(s);
}

const EC_WORK_WORDS = String.raw`(?:feeds?|feeders?|circuits?|circuiting|conduits?|raceways?|connections?|wiring|conductors?|homeruns?|stub[- ]?ups?|j-?box(?:es)?|junction\s+box(?:es)?|whips?|power)`;

/** EC work TO the item: "circuits and conduit to the power poles",
 *  "power pole feed", "connections at the power poles". */
export function isEcWorkToTerm(term: TermKey, text: string): boolean {
  const t = TERM_PATTERNS[term].source.replace(/^\\b|\\b$/g, '');
  const to = new RegExp(String.raw`\b${EC_WORK_WORDS}\b[^.;]{0,40}?\b(?:to|for|at|serving|feeding|into)\s+(?:the\s+|all\s+|each\s+)?(?:[a-z-]+\s+){0,2}${t}`, 'i');
  const after = new RegExp(String.raw`${t}\s+(?:[a-z-]+\s+)?(?:feeds?|feeders?|circuits?|connections?|whips?|wiring|conduits?|homeruns?|stub[- ]?ups?)\b`, 'i');
  return to.test(text) || after.test(text);
}

/** B7 — what to do with a bullet that mentions a term another party
 *  furnishes AND installs:
 *    keep   — it is EC work to the item (circuits/conduit/feeds/connections);
 *    strip  — the item is one element of a list: drop just that element;
 *    remove — a short bullet solely about the item;
 *    flag   — anything else (left unchanged, reported). */
export function stripTermFromBullet(term: TermKey, text: string): { action: 'keep' | 'remove' | 'flag' } | { action: 'strip'; text: string } {
  if (isEcWorkToTerm(term, text)) return { action: 'keep' };
  const t = TERM_PATTERNS[term].source.replace(/^\\b|\\b$/g, '');
  // S-R2-2 — a verb is never a list element ("Furnish and install power
  // poles and receptacles" must not become "Furnish and receptacles").
  const el = String.raw`(?:(?!(?:furnish|install|provide|supply|set|mount|and|or)\b)[A-Za-z-]+\s+){0,2}?${t}`;
  const tidy = (x: string) => x.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').replace(/,\s*,/g, ',').trim();
  const stillMentions = (x: string) => new RegExp(t, 'i').test(x);
  // First element: "Provide retail power poles, receptacles and baseflex."
  // ... or "Furnish and install power poles and receptacles per E-2." (the
  // word after "and" is another item, not a verb like "hard-wire").
  const first = new RegExp(String.raw`(\b(?:provide|furnish(?:\s+and\s+install)?|install|supply)\s+(?:all\s+)?)${el}\s*(?:,\s*|\s+and\s+(?!(?:hard[- ]?wire|wire|connect|set|mount|test|terminate|energize|install|furnish|provide)\b))`, 'i').exec(text);
  if (first) {
    let fixed = text.slice(0, first.index) + first[1] + text.slice(first.index + first[0].length);
    if ((fixed.match(/,/g) ?? []).length === 1 && /,\s*and\s+/i.test(fixed)) fixed = fixed.replace(/,\s*and\s+/i, ' and ');
    fixed = tidy(fixed);
    if (!stillMentions(fixed)) return { action: 'strip', text: fixed };
  }
  // Middle/last element: ", retail power poles," / ", and retail power poles" / " and retail power poles"
  const mid = new RegExp(String.raw`(,\s*(?:and\s+)?|\s+and\s+)${el}(?=\s*(?:,|\s+and\b|\s+(?:per|as|to|in|on)\b|\.|$))`, 'i').exec(text);
  if (mid) {
    const wasLast = !/^\s*,/.test(text.slice(mid.index + mid[0].length)) && /and/i.test(mid[1]);
    let fixed = text.slice(0, mid.index) + text.slice(mid.index + mid[0].length);
    if (wasLast) {
      // "A, B, and C" minus C -> "A and B"
      const lc = fixed.lastIndexOf(',');
      if (lc > 0 && !/\band\b/i.test(fixed.slice(lc))) fixed = `${fixed.slice(0, lc)} and${fixed.slice(lc + 1)}`;
    } else if ((fixed.match(/,/g) ?? []).length === 1 && /,\s*and\s+/i.test(fixed)) {
      // "A, B, and C" minus B -> "A and C"
      fixed = fixed.replace(/,\s*and\s+/i, ' and ');
    }
    fixed = tidy(fixed);
    if (!stillMentions(fixed)) return { action: 'strip', text: fixed };
  }
  const words = text.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length <= 10 ? { action: 'remove' } : { action: 'flag' };
}

/** Who a scope bullet / exclusion SAYS furnishes and installs a term:
 *  "Furnish and install power poles" -> APT/APT; "Install AutoZone-furnished
 *  power poles" -> Owner/APT; "Power poles by others" -> Others/Others;
 *  "furnished by GC, installed by EC" -> GC/APT. null when it states nothing
 *  about the item itself (circuits / conduit / feeds TO it are EC work). */
export function statedParties(term: TermKey, text: string): { furnish: Party | null; install: Party | null } | null {
  if (!mentionsTerm(term, text) || isEcWorkToTerm(term, text)) return null;
  const t = TERM_PATTERNS[term].source.replace(/^\\b|\\b$/g, '');
  const at = new RegExp(t, 'i').exec(text)!.index;
  const before = text.slice(0, at).toLowerCase();
  const explicit = parseStatementPartiesRaw('', '', text);
  let furnish = explicit.furnish;
  let install = explicit.install;
  const adj = /\b([a-z0-9]+(?:\s+[a-z0-9]+)?)-(furnished|supplied|provided)\b/i.exec(text.slice(Math.max(0, at - 40), at + 5));
  if (adj && !furnish) furnish = normalizeParty(adj[1]);
  if (/\b(furnish|supply|provide)(es|ed)?\s+(and|&)\s+install\b/.test(before)) { furnish ??= 'APT'; install ??= 'APT'; }
  else if (/\bprovide[sd]?\b/.test(before)) { furnish ??= 'APT'; install ??= 'APT'; }
  else if (/\b(furnish|supply)\b/.test(before) && !furnish) furnish = 'APT';
  if (/\b(install|set|mount)\b/.test(before) && !install) install = 'APT';
  if (!furnish && !install) return null;
  return { furnish, install };
}

/** The scope bullet that states a resolved term correctly (APT is in it), or
 *  null when another party furnishes AND installs (the exclusion says so). */
export function scopeStatementFor(t: ResolvedTerm): string | null {
  const what = TERM_LABELS[t.term].toLowerCase();
  if (t.furnishBy === 'APT' && t.installBy === 'APT') return `Furnish and install the ${what} per plans.`;
  if (t.installBy === 'APT') return `Install the ${what} furnished by ${partyPhrase(t.furnishBy)}.`;
  if (t.furnishBy === 'APT') return `Furnish the ${what}; installed by ${partyPhrase(t.installBy)}.`;
  return null;
}

export function enforceAccountTerms(agent4: Agent4Output, snap: AccountTermsSnapshot | null, resolved: ResolvedTerm[]): EnforcementResult {
  const corrections: string[] = [];
  if (!snap) return { output: agent4, corrections };
  const out: Agent4Output = JSON.parse(JSON.stringify(agent4));
  const sections: Agent4Section[] = out.sections ?? [];
  const byTerm = new Map(resolved.map(r => [r.term, r]));
  // An output with no scope sections at all is left without them (the
  // callers report "no scope data"); enforcement never invents a scope.
  const hasScope = sections.length > 0;

  // 1. Section C bullet 1 — the lighting procurement sentence. B6: edited IN
  //    PLACE (the procurement bullet, else the bullet about the fixtures,
  //    else bullet 1) — never appended past Section C's limit (3 bullets in
  //    the proposal, one of which is the code-built "Fixture types per
  //    schedule" bullet when fixture_types is set).
  const lighting = byTerm.get('lighting');
  const cBullet = lightingSectionCBullet(lighting);
  if (cBullet && hasScope) {
    let c = sections.find(s => SECTION_LETTER.exec(s.title)?.[1] === 'C');
    if (!c) { c = { title: 'C. Lighting & Controls', bullets: [] }; sections.push(c); }
    c.bullets = c.bullets ?? [];
    const limit = 3 - ((out.fixture_types ?? []).length ? 1 : 0);
    let idx = c.bullets.findIndex(b => LIGHTING_PROCUREMENT.test(bulletText(b)));
    if (idx < 0) {
      idx = c.bullets.findIndex(b => {
        const t = bulletText(b);
        return /\b(fixtures?|luminaires?|light(ing)?\s+package)\b/i.test(t) && !/^\s*fixture types per schedule/i.test(t)
          && !/\b(control|photocell|occupancy|sensor|contactor|time\s*clock|testing)\b/i.test(t);
      });
    }
    if (idx < 0 && c.bullets.length >= limit) idx = 0;
    if (idx >= 0) {
      if (bulletText(c.bullets[idx]) !== cBullet) {
        corrections.push(`Section C lighting bullet replaced with the ${snap.ruleName} terms: "${cBullet}" (was: "${bulletText(c.bullets[idx])}").`);
        c.bullets[idx] = cBullet;
      }
    } else {
      c.bullets.unshift(cBullet);
      corrections.push(`Section C lighting bullet added from the ${snap.ruleName} terms.`);
    }
  }

  // 2. Items another party furnishes AND installs are not APT scope. B7:
  //    only text that asserts furnishing/installing THE ITEM ITSELF changes —
  //    a bullet solely about it goes; the item is struck from a list bullet
  //    ("receptacles, retail power poles, and baseflex" keeps the rest);
  //    circuits, conduit, feeds and connections TO it are EC work and stay;
  //    anything else is left as is and flagged.
  for (const t of resolved) {
    if (t.furnishBy === 'APT' || t.installBy === 'APT' || t.term === 'lighting') continue;
    for (const s of sections) {
      const next: typeof s.bullets = [];
      for (const b of s.bullets ?? []) {
        const text = bulletText(b);
        if (!mentionsTerm(t.term, text) || partyMentioned(text, t.furnishBy)) { next.push(b); continue; }
        const r = stripTermFromBullet(t.term, text);
        if (r.action === 'keep') { next.push(b); continue; }
        if (r.action === 'remove') {
          corrections.push(`Removed from ${s.title}: "${text}" — ${describeTerm(t)}`);
          continue;
        }
        if (r.action === 'strip') {
          corrections.push(`${s.title}: "${text}" -> "${r.text}" — ${describeTerm(t)}`);
          next.push(typeof b === 'string' ? r.text : { b: '', t: r.text });
          continue;
        }
        corrections.push(`CHECK ${s.title}: "${text}" mentions the ${TERM_LABELS[t.term].toLowerCase()} — ${describeTerm(t)} Left unchanged; reword it if it says APT furnishes or installs them.`);
        next.push(b);
      }
      s.bullets = next;
    }
    for (const cat of out.takeoff ?? []) {
      const before = cat.items ?? [];
      cat.items = before.filter(it => {
        const text = `${it.item ?? ''} ${it.description ?? ''}`;
        if (!mentionsTerm(t.term, text) || partyMentioned(`${it.description ?? ''} ${it.furnish_by ?? ''}`, t.furnishBy)) return true;
        return isEcWorkToTerm(t.term, text); // "Power pole feed" stays; "Power poles 8 EA" goes
      });
      for (const it of before) if (!cat.items.includes(it)) corrections.push(`Removed takeoff line "${it.item}" (${cat.name}) — ${describeTerm(t)}`);
    }
    const excl = `${TERM_LABELS[t.term]} furnished and installed by ${partyPhrase(t.furnishBy)}.`;
    out.exclusions = out.exclusions ?? [];
    if (!out.exclusions.some(e => mentionsTerm(t.term, bulletText(e)))) {
      out.exclusions.push(excl);
      corrections.push(`Exclusion added: "${excl}"`);
    }
  }

  // 2b. Fix round 2 / S-R2-2, S-R2-3, N-R2-4 — after the answers are applied,
  //     every scope bullet and exclusion that STATES who furnishes or installs
  //     an answered term (power poles, or any term the estimator answered) is
  //     checked against the answer: a contradicting bullet solely about the
  //     item is rewritten to the right statement, a mixed bullet is split (the
  //     rest keeps its verb; the item gets its own correct bullet), a
  //     contradicting exclusion is removed, anything else is flagged.
  for (const t of resolved) {
    if (!(t.term === 'power_poles' || t.source === 'estimator') || t.term === 'lighting') continue;
    const right = scopeStatementFor(t);
    for (const s of sections) {
      const next: typeof s.bullets = [];
      for (const b of s.bullets ?? []) {
        const text = bulletText(b);
        const said = statedParties(t.term, text);
        const contradicts = said && ((said.furnish && said.furnish !== t.furnishBy) || (said.install && said.install !== t.installBy));
        if (!contradicts) { next.push(b); continue; }
        const r = stripTermFromBullet(t.term, text);
        const addRight = () => { if (right && !next.some(x => bulletText(x) === right)) next.push(right); };
        if (r.action === 'strip') {
          next.push(typeof b === 'string' ? r.text : { b: '', t: r.text });
          addRight();
          corrections.push(`${s.title}: "${text}" split — "${r.text}"${right ? ` and "${right}"` : ''} (${describeTerm(t)})`);
        } else if (r.action === 'remove') {
          addRight();
          corrections.push(`${s.title}: "${text}" ${right ? `rewritten to "${right}"` : 'removed'} — ${describeTerm(t)}`);
        } else {
          next.push(b);
          corrections.push(`CHECK ${s.title}: "${text}" contradicts the answer — ${describeTerm(t)} Reword it.`);
        }
      }
      s.bullets = next;
    }
    if (out.exclusions?.length) {
      const before = out.exclusions;
      out.exclusions = before.filter(e => {
        const text = bulletText(e);
        const said = statedParties(t.term, text);
        const contradicts = said && ((said.furnish && said.furnish !== t.furnishBy) || (said.install && said.install !== t.installBy));
        if (contradicts) corrections.push(`Exclusion removed: "${text}" contradicts the answer — ${describeTerm(t)}`);
        return !contradicts;
      });
    }
  }

  // 3. Takeoff furnish_by for every line a term covers; strip (ECFECI) from
  //    lines another party furnishes.
  for (const cat of out.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const text = `${it.item ?? ''} ${it.description ?? ''}`;
      // A power connection in a lighting category ("Sign power", "Building /
      // pylon sign power connection") is EC work, not a fixture.
      const isFixtureLine = /lighting/i.test(cat.name) && !/control/i.test(cat.name)
        && !/\b(power|connections?|circuits?|feeds?|feeders?|conduits?)\b/i.test(text);
      const term = isFixtureLine && byTerm.get('lighting') ? byTerm.get('lighting')
        : (['power_poles', 'disconnects', 'panels', 'other_equipment'] as TermKey[]).map(k => (mentionsTerm(k, text) && !(k !== 'power_poles' && TERM_PATTERNS.power_poles.test(text)) && !isEcWorkToTerm(k, text) ? byTerm.get(k) : undefined)).find(Boolean);
      if (!term) continue;
      const label = furnishByLabel(term);
      if (it.furnish_by !== label) {
        corrections.push(`Takeoff "${it.item}": furnish by set to "${label}"${it.furnish_by ? ` (was "${it.furnish_by}")` : ''}.`);
        it.furnish_by = label;
      }
      if (term.furnishBy !== 'APT' && /\(?ECFECI\)?/.test(`${it.description ?? ''}`)) {
        it.description = (it.description ?? '').replace(/\s*\(?ECFECI\)?/g, '').trim();
        corrections.push(`Takeoff "${it.item}": "(ECFECI)" removed — ${TERM_LABELS[term.term].toLowerCase()} are not APT-furnished.`);
      }
    }
  }
  //    ...and from scope bullets about those items.
  for (const t of resolved) {
    if (t.furnishBy === 'APT') continue;
    const re = t.term === 'lighting' ? /\b(fixtures?|luminaires?|lighting package)\b/i : TERM_PATTERNS[t.term];
    for (const s of sections) {
      s.bullets = (s.bullets ?? []).map(b => {
        const text = bulletText(b);
        if (!re.test(text) || !mentionsTerm(t.term, text) || !/ECFECI/.test(text)) return b;
        // Only when the bullet is about this term alone — a mixed gear bullet
        // ("panels [...] and disconnects (ECFECI)") is left for verifyBid.
        const otherTerms = TERM_KEYS.filter(k => k !== t.term && mentionsTerm(k, text));
        if (otherTerms.length) return b;
        corrections.push(`Removed "(ECFECI)" from ${s.title}: "${text}" — ${TERM_LABELS[t.term].toLowerCase()} are not APT-furnished.`);
        return mapBullet(b, x => x.replace(/\s*\(ECFECI\)/g, ''));
      });
    }
  }

  // 4. No MDP language unless the drawings show an MDP.
  if (snap.noMdpUnlessOnDrawings && !snap.mdpOnDrawings) {
    for (const s of sections) {
      s.bullets = (s.bullets ?? []).map(b => {
        if (!MDP_RE.test(bulletText(b))) return b;
        const fixed = mapBullet(b, x => x.replace(/\s*(,\s*)?(and|&)\s+(the\s+)?(MDP|main distribution panel)\b/gi, '').replace(/\s*\/\s*MDP\b/g, ''));
        if (bulletText(fixed) !== bulletText(b)) corrections.push(`MDP language removed (no MDP on the drawings): "${bulletText(b)}" -> "${bulletText(fixed)}"`);
        return fixed;
      });
    }
  }

  // 5. Required scope bullets.
  for (const rb of hasScope ? snap.requiredScopeBullets : []) {
    let s = sections.find(x => SECTION_LETTER.exec(x.title)?.[1] === rb.section);
    if (!s) { s = { title: `${rb.section}.`, bullets: [] }; sections.push(s); }
    s.bullets = s.bullets ?? [];
    if (!s.bullets.some(b => bulletText(b).trim().toLowerCase() === rb.text.trim().toLowerCase())) {
      s.bullets.push(rb.text);
      corrections.push(`Required Section ${rb.section} bullet added: "${rb.text}"`);
    }
  }

  out.sections = sections;
  return { output: out, corrections };
}

/** verifyBid options for this job's terms. Keeps the standard ECFECI
 *  placement checks wherever APT really furnishes, drops them where the rule
 *  makes the items owner/GC-furnished (an AutoZone proposal must NOT say
 *  lighting is ECFECI). */
export function verifyOptionsFor(snap: AccountTermsSnapshot | null, resolved: ResolvedTerm[]): {
  forbiddenPhrases: string[];
  ecfeci: { requireInSectionA: boolean; requireInSectionC: boolean; minCount: number };
} {
  if (!snap) return { forbiddenPhrases: [], ecfeci: { requireInSectionA: true, requireInSectionC: true, minCount: 3 } };
  const lighting = resolved.find(r => r.term === 'lighting');
  const panels = resolved.find(r => r.term === 'panels');
  const requireInSectionC = !lighting || lighting.furnishBy === 'APT';
  const requireInSectionA = !panels || panels.furnishBy === 'APT';
  const aptFurnished = resolved.filter(r => r.furnishBy === 'APT').length;
  const minCount = requireInSectionA && requireInSectionC ? 3 : (aptFurnished > 0 || requireInSectionA || requireInSectionC ? 1 : 0);
  return { forbiddenPhrases: effectiveForbiddenPhrases(snap, resolved), ecfeci: { requireInSectionA, requireInSectionC, minCount } };
}
