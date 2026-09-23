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
}

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

export interface MatchInput { brand?: string | null; bidName?: string | null; owner?: string | null; gcExtracted?: string | null; projectType?: string | null }

/** The one rule for this bid: rules whose aliases match win (a rule that ALSO
 *  matches the project type outranks one that doesn't), then project-type-only
 *  rules, then the Default. Ties: lower priority number, then name. */
export function matchAccountRule(rules: AccountRule[], input: MatchInput): { rule: AccountRule | null; matchedBy: string } {
  const texts: Array<[string, string]> = [
    ['brand', input.brand ?? ''], ['owner', input.owner ?? ''], ['bid name', input.bidName ?? ''], ['drawings', input.gcExtracted ?? ''],
  ];
  const pt = (input.projectType ?? '').trim();
  const active = rules.filter(r => r.active);
  const scored: Array<{ r: AccountRule; score: number; by: string }> = [];
  for (const r of active) {
    if (r.isDefault) continue;
    const typeOk = r.projectTypes.length === 0 || (pt !== '' && r.projectTypes.includes(pt));
    if (!typeOk) continue;
    const hit = r.matchAliases.map(a => texts.find(([, t]) => t && aliasMatches(a, t)) ? { a, where: texts.find(([, t]) => t && aliasMatches(a, t))![0] } : null).find(Boolean);
    if (r.matchAliases.length) {
      if (!hit) continue;
      scored.push({ r, score: r.projectTypes.length ? 3 : 2, by: `"${hit.a}" in the ${hit.where}` });
    } else if (r.projectTypes.length) {
      scored.push({ r, score: 1, by: `project type ${pt}` });
    }
  }
  scored.sort((x, y) => y.score - x.score || x.r.priority - y.r.priority || x.r.name.localeCompare(y.r.name));
  if (scored.length) return { rule: scored[0].r, matchedBy: scored[0].by };
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
  return statements.filter(s => TERM_PATTERNS[term].test(`${s.item} ${s.quote}`)
    // "power poles" also matches /equipment/-free patterns; keep poles out of panels/lighting
    && (term === 'power_poles' || !TERM_PATTERNS.power_poles.test(`${s.item}`)));
}

/** Parties a statement assigns, reading the quote when a field is blank
 *  ("FURNISHED, INSTALLED AND HARD-WIRED BY GC" -> GC/GC). */
function statementParties(s: FurnishStatement): { furnish: Party | null; install: Party | null } {
  let furnish = normalizeParty(s.furnishBy);
  let install = normalizeParty(s.installBy);
  const q = s.quote.toLowerCase();
  const byParty = /\bby\s+([a-z0-9 .\-]+?)(?:[.;,]|$)/.exec(q);
  const quoted = byParty ? normalizeParty(byParty[1]) : null;
  if (!furnish && /furnish/.test(q) && quoted) furnish = quoted;
  if (!install && /install/.test(q) && quoted) install = quoted;
  return { furnish, install };
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
      const best = found.find(x => x.furnish && x.install) ?? found[0];
      if (best) {
        resolved.push({
          term,
          furnishBy: best.furnish ?? best.install!,
          installBy: best.install ?? best.furnish!,
          source: 'drawings',
          citation: { sheet: best.s.sourceSheet, quote: best.s.quote },
        });
      } else {
        questions.push({
          term, kind: 'ask', label,
          question: `Who furnishes and installs the ${label.toLowerCase()}? (APT / GC / Owner)`,
          options: ['APT', 'GC', 'Owner'],
          notes: [
            'No furnish/install statement for this was found on the drawings.',
            ...aiNotesForTerm(term),
          ],
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

/** Apply the estimator's answers (review items `scope:<term>`) to the
 *  snapshot: every term the snapshot left as a question becomes resolved from
 *  its answer. Unanswered questions stay open (the gate keeps them blocked). */
export function applyScopeAnswers(
  snap: AccountTermsSnapshot,
  answers: Record<string, string>,
): ResolvedTerm[] {
  const out = [...snap.resolved];
  for (const q of snap.questions) {
    const a = answers[`scope:${q.term}`];
    if (!a) continue;
    if (q.kind === 'ask') {
      const p = normalizeParty(a);
      if (p) out.push({ term: q.term, furnishBy: p, installBy: p, source: 'estimator' });
      continue;
    }
    const rt = snap.ruleTerms[q.term];
    if (a.startsWith('Account rule') && rt && rt.mode === 'fixed') {
      out.push({ term: q.term, furnishBy: rt.furnishBy, installBy: rt.installBy, vendor: rt.vendor, contact: rt.contact, source: 'estimator' });
    } else if (a.startsWith('Drawings')) {
      const m = /furnished and installed by (the )?(\w+)|furnished by (the )?(\w+)[^;]*; installed by (the )?(\w+)/i.exec(a);
      const f = normalizeParty(m?.[2] ?? m?.[4] ?? '');
      const i = normalizeParty(m?.[2] ?? m?.[6] ?? '');
      if (f && i) out.push({ term: q.term, furnishBy: f, installBy: i, source: 'estimator' });
    }
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
  for (const q of snap.questions) lines.push(`- ${q.label}: NOT YET DECIDED — do not state who furnishes or installs them.`);
  if (snap.noMdpUnlessOnDrawings && !snap.mdpOnDrawings) lines.push('- There is NO MDP on the drawings: never write "MDP" or "main distribution panel".');
  for (const b of snap.requiredScopeBullets) lines.push(`- Required Section ${b.section} bullet: "${b.text}"`);
  const forbidden = effectiveForbiddenPhrases(snap, resolved);
  if (forbidden.length) lines.push(`- Never write: ${forbidden.map(f => `"${f}"`).join(', ')}.`);
  return lines.join('\n');
}

// ── Deterministic enforcement on Agent 4's output ───────────────────────────

export interface EnforcementResult {
  output: Agent4Output;
  corrections: string[];
}

function bulletText(b: string | { b: string; t: string }): string {
  return typeof b === 'string' ? b : `${b.b} ${b.t}`;
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

export function enforceAccountTerms(agent4: Agent4Output, snap: AccountTermsSnapshot | null, resolved: ResolvedTerm[]): EnforcementResult {
  const corrections: string[] = [];
  if (!snap) return { output: agent4, corrections };
  const out: Agent4Output = JSON.parse(JSON.stringify(agent4));
  const sections: Agent4Section[] = out.sections ?? [];
  const byTerm = new Map(resolved.map(r => [r.term, r]));

  // 1. Section C bullet 1 — the lighting procurement sentence.
  const lighting = byTerm.get('lighting');
  const cBullet = lightingSectionCBullet(lighting);
  if (cBullet) {
    let c = sections.find(s => SECTION_LETTER.exec(s.title)?.[1] === 'C');
    if (!c) { c = { title: 'C. Lighting & Controls', bullets: [] }; sections.push(c); }
    c.bullets = c.bullets ?? [];
    const idx = c.bullets.findIndex(b => LIGHTING_PROCUREMENT.test(bulletText(b)));
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

  // 2. Items another party furnishes AND installs are not APT scope: a scope
  //    bullet or takeoff line about them that doesn't name that party goes.
  for (const t of resolved) {
    if (t.furnishBy === 'APT' || t.installBy === 'APT' || t.term === 'lighting') continue;
    const re = TERM_PATTERNS[t.term];
    for (const s of sections) {
      const before = s.bullets ?? [];
      s.bullets = before.filter(b => !(re.test(bulletText(b)) && !partyMentioned(bulletText(b), t.furnishBy)));
      for (const b of before) if (!s.bullets.includes(b)) corrections.push(`Removed from ${s.title}: "${bulletText(b)}" — ${describeTerm(t)}`);
    }
    for (const cat of out.takeoff ?? []) {
      const before = cat.items ?? [];
      cat.items = before.filter(it => !(re.test(`${it.item ?? ''} ${it.description ?? ''}`) && !partyMentioned(`${it.description ?? ''} ${it.furnish_by ?? ''}`, t.furnishBy)));
      for (const it of before) if (!cat.items.includes(it)) corrections.push(`Removed takeoff line "${it.item}" (${cat.name}) — ${describeTerm(t)}`);
    }
    const excl = `${TERM_LABELS[t.term]} furnished and installed by ${partyPhrase(t.furnishBy)}.`;
    out.exclusions = out.exclusions ?? [];
    if (!out.exclusions.some(e => re.test(bulletText(e)))) {
      out.exclusions.push(excl);
      corrections.push(`Exclusion added: "${excl}"`);
    }
  }

  // 3. Takeoff furnish_by for every line a term covers; strip (ECFECI) from
  //    lines another party furnishes.
  for (const cat of out.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const text = `${it.item ?? ''} ${it.description ?? ''}`;
      const isFixtureLine = /lighting/i.test(cat.name) && !/control/i.test(cat.name);
      const term = isFixtureLine && byTerm.get('lighting') ? byTerm.get('lighting')
        : (['power_poles', 'disconnects', 'panels', 'other_equipment'] as TermKey[]).map(k => (TERM_PATTERNS[k].test(text) ? byTerm.get(k) : undefined)).find(Boolean);
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
        if (typeof b !== 'string' || !re.test(text) || !/ECFECI/.test(text)) return b;
        // Only when the bullet is about this term alone — a mixed gear bullet
        // ("panels [...] and disconnects (ECFECI)") is left for verifyBid.
        const otherTerms = TERM_KEYS.filter(k => k !== t.term && TERM_PATTERNS[k].test(text));
        if (otherTerms.length) return b;
        const fixed = text.replace(/\s*\(ECFECI\)/g, '');
        corrections.push(`Removed "(ECFECI)" from ${s.title}: "${text}" — ${TERM_LABELS[t.term].toLowerCase()} are not APT-furnished.`);
        return fixed;
      });
    }
  }

  // 4. No MDP language unless the drawings show an MDP.
  if (snap.noMdpUnlessOnDrawings && !snap.mdpOnDrawings) {
    for (const s of sections) {
      s.bullets = (s.bullets ?? []).map(b => {
        if (typeof b !== 'string' || !MDP_RE.test(b)) return b;
        const fixed = b.replace(/\s*(,\s*)?(and|&)\s+(the\s+)?(MDP|main distribution panel)\b/gi, '').replace(/\s*\/\s*MDP\b/g, '');
        if (fixed !== b) corrections.push(`MDP language removed (no MDP on the drawings): "${b}" -> "${fixed}"`);
        return fixed;
      });
    }
  }

  // 5. Required scope bullets.
  for (const rb of snap.requiredScopeBullets) {
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
