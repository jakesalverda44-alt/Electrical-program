// Takeoff accuracy, Task 8 — account_rules persistence, validation, and the
// per-run snapshot. Pure rules live in ./accountRules.ts.
import { pool } from '../db/pool';
import {
  PARTIES, TERM_KEYS, TERM_PATTERNS, TERM_LABELS, matchAccountRule, resolveAccountTerms, applyScopeAnswers, type ScopeAnswer,
  type AccountRule, type AccountTermsSnapshot, type RuleTerm, type TermKey, type RequiredBullet, type ResolvedTerm, type Party,
} from './accountRules';
import type { ReviewItem, ScopeQuestionInput } from '../ai/reviewItems';

function rowToRule(r: Record<string, unknown>): AccountRule {
  return {
    id: r.id as string,
    name: r.name as string,
    isDefault: !!r.is_default,
    matchAliases: (r.match_aliases as string[]) ?? [],
    projectTypes: (r.project_types as string[]) ?? [],
    priority: Number(r.priority ?? 100),
    terms: (r.terms as AccountRule['terms']) ?? {},
    requiredScopeBullets: (r.required_scope_bullets as RequiredBullet[]) ?? [],
    forbiddenPhrases: (r.forbidden_phrases as string[]) ?? [],
    noMdpUnlessOnDrawings: !!r.no_mdp_unless_on_drawings,
    notes: (r.notes as string) ?? '',
    active: r.active !== false,
    autoDeductAlternate: (r.auto_deduct_alternate as AccountRule['autoDeductAlternate']) ?? null,
  };
}

export async function listAccountRules(): Promise<AccountRule[]> {
  const { rows } = await pool.query('SELECT * FROM account_rules ORDER BY is_default DESC, priority, name');
  return rows.map(rowToRule);
}

export async function getAccountRule(id: string): Promise<AccountRule | null> {
  const { rows } = await pool.query('SELECT * FROM account_rules WHERE id = $1', [id]);
  return rows[0] ? rowToRule(rows[0]) : null;
}

// ── Validation (admin edits) ────────────────────────────────────────────────

export type RuleValidation = { ok: true; rule: Omit<AccountRule, 'id' | 'isDefault'> } | { ok: false; error: string };

function strList(v: unknown, max = 50): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean);
  return out.length > max ? null : out;
}

export function validateRuleInput(body: Record<string, unknown>, opts: { isDefault: boolean }): RuleValidation {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return { ok: false, error: 'Name is required (80 characters max).' };
  const matchAliases = strList(body.matchAliases);
  const projectTypes = strList(body.projectTypes);
  const forbiddenPhrases = strList(body.forbiddenPhrases);
  if (!matchAliases || !projectTypes || !forbiddenPhrases) return { ok: false, error: 'Aliases, project types and forbidden phrases must be lists of text.' };
  if (opts.isDefault && (matchAliases.length || projectTypes.length)) {
    return { ok: false, error: 'The Default rule applies when nothing else matches — it cannot have aliases or project types.' };
  }
  if (!opts.isDefault && !matchAliases.length && !projectTypes.length) {
    return { ok: false, error: 'Give the rule at least one alias (brand / owner name) or project type to match on.' };
  }
  const priority = body.priority == null ? 100 : Number(body.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) return { ok: false, error: 'Priority must be a whole number 0-10000.' };

  const terms: Partial<Record<TermKey, RuleTerm>> = {};
  const rawTerms = (body.terms && typeof body.terms === 'object') ? body.terms as Record<string, unknown> : {};
  for (const [k, v] of Object.entries(rawTerms)) {
    if (!TERM_KEYS.includes(k as TermKey)) return { ok: false, error: `Unknown term "${k}".` };
    if (v == null) continue;
    const t = v as Record<string, unknown>;
    if (t.mode === 'ask') { terms[k as TermKey] = { mode: 'ask' }; continue; }
    if (t.mode !== 'fixed') return { ok: false, error: `${TERM_LABELS[k as TermKey]}: mode must be "fixed" or "ask".` };
    if (!PARTIES.includes(t.furnishBy as Party) || !PARTIES.includes(t.installBy as Party)) {
      return { ok: false, error: `${TERM_LABELS[k as TermKey]}: furnish-by and install-by must each be one of ${PARTIES.join(', ')}.` };
    }
    const vendor = typeof t.vendor === 'string' ? t.vendor.trim().slice(0, 120) : '';
    const contact = typeof t.contact === 'string' ? t.contact.trim().slice(0, 200) : '';
    terms[k as TermKey] = { mode: 'fixed', furnishBy: t.furnishBy as Party, installBy: t.installBy as Party, ...(vendor ? { vendor } : {}), ...(contact ? { contact } : {}) };
  }

  const bulletsRaw = Array.isArray(body.requiredScopeBullets) ? body.requiredScopeBullets : [];
  const requiredScopeBullets: RequiredBullet[] = [];
  for (const b of bulletsRaw) {
    const r = b as Record<string, unknown>;
    const section = String(r?.section ?? '').toUpperCase();
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(section) || !text) return { ok: false, error: 'Each required bullet needs a section A-F and text.' };
    requiredScopeBullets.push({ section: section as RequiredBullet['section'], text: text.slice(0, 300) });
  }

  return {
    ok: true,
    rule: {
      name, matchAliases, projectTypes, priority, terms, requiredScopeBullets, forbiddenPhrases,
      noMdpUnlessOnDrawings: !!body.noMdpUnlessOnDrawings,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '',
      active: body.active !== false,
    },
  };
}

export async function saveAccountRule(id: string | null, rule: Omit<AccountRule, 'id' | 'isDefault'>): Promise<AccountRule> {
  const params = [rule.name, rule.matchAliases, rule.projectTypes, rule.priority, JSON.stringify(rule.terms),
    JSON.stringify(rule.requiredScopeBullets), rule.forbiddenPhrases, rule.noMdpUnlessOnDrawings, rule.notes, rule.active];
  if (id) {
    const { rows } = await pool.query(
      `UPDATE account_rules SET name=$1, match_aliases=$2, project_types=$3, priority=$4, terms=$5::jsonb,
         required_scope_bullets=$6::jsonb, forbidden_phrases=$7, no_mdp_unless_on_drawings=$8, notes=$9, active=$10, updated_at=now()
       WHERE id=$11 RETURNING *`, [...params, id]);
    return rowToRule(rows[0]);
  }
  const { rows } = await pool.query(
    `INSERT INTO account_rules (name, match_aliases, project_types, priority, terms, required_scope_bullets, forbidden_phrases, no_mdp_unless_on_drawings, notes, active)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) RETURNING *`, params);
  return rowToRule(rows[0]);
}

// ── Per-run snapshot ────────────────────────────────────────────────────────

/** True when the drawing analysis shows an MDP / main distribution panel. */
export function mdpOnDrawings(agent1: Record<string, unknown>): boolean {
  const names = [
    ...(Array.isArray(agent1.panels) ? agent1.panels : []).map(p => String((p as Record<string, unknown>)?.name ?? '')),
    ...(Array.isArray(agent1.equipment) ? agent1.equipment : []).map(e => `${(e as Record<string, unknown>)?.tag ?? ''} ${(e as Record<string, unknown>)?.description ?? ''}`),
  ];
  return names.some(n => /\bMDP\b|main\s+distribution/i.test(n));
}

/** What the drawing analysis says about a term, for a scope question's notes
 *  ("AI count: 8 × Power pole (E-2)"). */
export function aiNotesFor(agent1: Record<string, unknown>) {
  return (term: TermKey): string[] => {
    const re = TERM_PATTERNS[term];
    const notes: string[] = [];
    for (const q of Array.isArray(agent1.quantities) ? agent1.quantities : []) {
      const r = q as Record<string, unknown>;
      if (re.test(`${r?.item ?? ''} ${r?.spec ?? ''}`) && (term === 'power_poles' || !TERM_PATTERNS.power_poles.test(String(r?.item ?? '')))) {
        notes.push(`AI count: ${r.qty ?? '?'} × ${r.item}${r.sourceSheet ? ` (${r.sourceSheet})` : ''}`);
      }
    }
    for (const n of Array.isArray(agent1.scopeNotes) ? agent1.scopeNotes : []) {
      if (typeof n === 'string' && re.test(n)) notes.push(`Drawing note: ${n}`);
    }
    return notes.slice(0, 6);
  };
}

export async function buildAccountTermsSnapshot(
  bid: { brand?: string | null; name?: string | null; project_type?: string | null; owner_name?: string | null },
  agent1: Record<string, unknown>,
): Promise<AccountTermsSnapshot> {
  const rules = await listAccountRules();
  const project = (agent1.project ?? {}) as Record<string, unknown>;
  // Fix round 1 / S8 — never the bid's own GC name (project.gcName is the
  // bid's GC after the hygiene step): drawing text only.
  const { rule, matchedBy, warning } = matchAccountRule(rules, {
    brand: bid.brand, bidName: bid.name, projectType: bid.project_type,
    // Review N4 — the owner on the bid card (job profile) counts too.
    owner: [bid.owner_name ?? '', String(project.owner ?? '')].filter(x => x.trim()).join(' '), drawingsProject: String(project.name ?? ''), gcExtracted: String(project.gc_extracted ?? ''),
  });
  const snap = resolveAccountTerms(rule, matchedBy, agent1.furnishStatements, mdpOnDrawings(agent1), aiNotesFor(agent1));
  if (warning) snap.warning = warning;
  if (bid.brand?.trim() && (!rule || rule.isDefault)) {
    snap.warning = `The bid's brand "${bid.brand.trim()}" matched no account rule — the Default terms apply. Add the brand to a rule's aliases in Settings → Account Rules if it has its own terms.`;
  }
  return snap;
}

export function scopeQuestionsFor(snap: AccountTermsSnapshot | null): ScopeQuestionInput[] {
  // B7 — an `ask` term's furnish and install halves are separate items
  // (scope:<term>:furnish / scope:<term>:install); a conflict carries its
  // options' structured parties.
  return (snap?.questions ?? []).map(q => ({
    term: q.half ? `${q.term}:${q.half}` : q.term,
    label: q.label, question: q.question, options: q.options, notes: q.notes,
    ...(q.optionParties ? { optionParties: q.optionParties } : {}),
    ...(q.suggested ? { suggested: q.suggested } : {}),
  }));
}

/** The terms in force right now: the snapshot plus the estimator's answers. */
export function effectiveAccountTerms(
  snap: AccountTermsSnapshot | null,
  reviewItems: ReviewItem[] | null,
): ResolvedTerm[] {
  if (!snap) return [];
  const answers: Record<string, ScopeAnswer> = {};
  for (const i of reviewItems ?? []) {
    if (i.kind === 'scope_question' && i.resolution?.answer) {
      answers[i.id] = { answer: i.resolution.answer, furnishBy: i.resolution.furnishBy, installBy: i.resolution.installBy };
    }
  }
  return applyScopeAnswers(snap, answers);
}
