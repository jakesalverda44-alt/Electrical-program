// Gap-closing T0 — the SCRIPTED answers scenario per job (scripted-answers-2026-09-30.json) and the account
// terms the run would carry (account-rules-2026-09-30.json, the migration-114 AutoZone / Default rules, resolved
// against Agent 1's furnishStatements exactly as buildAccountTermsSnapshot does). Every table labels it SCRIPTED.
import fs from 'fs';
import path from 'path';
import { matchAccountRule, resolveAccountTerms, type AccountRule, type AccountTermsSnapshot, type ScopeAnswer } from '../../../bidstd/accountRules';
import { mdpOnDrawings } from '../../../bidstd/accountRulesDb';
import type { ScriptedAnswer, ReplayPricingOptions } from '../../../eval/replayEval';
import type { Live0930 } from './live0930';
import { textSheets0930, scriptedLocate, scriptedPins } from './feeders0930';

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')) as T;
interface JobScript { account: { brand: string | null }; scopeAnswers: Record<string, string | ScopeAnswer>; quoteFixturePackage: Record<string, boolean>; quoteFixturePackageQuote?: string; answers: ScriptedAnswer[] }
export const SCRIPTED_ANSWERS = read<{ _note: string; kissimmee: JobScript; '36th': JobScript }>('scripted-answers-2026-09-30.json');
export const SCRIPTED_ACCOUNT_RULES = read<{ _note: string; rules: AccountRule[] }>('account-rules-2026-09-30.json').rules;

export type GapJob = 'kissimmee' | '36th';

/** The account-terms snapshot (SCRIPTED rules × the export's furnish statements). */
export function scriptedAccountTerms(job: GapJob, live: Live0930): AccountTermsSnapshot {
  const a1 = (live.agent1 ?? {}) as Record<string, unknown>;
  const { rule, matchedBy } = matchAccountRule(SCRIPTED_ACCOUNT_RULES, { brand: SCRIPTED_ANSWERS[job].account.brand, bidName: live.bid.name });
  return resolveAccountTerms(rule, matchedBy, a1.furnishStatements, mdpOnDrawings(a1));
}

/** The replay options of the SCRIPTED answers scenario (gate scenario): the replayed count projected, stage due
 *  (fresh), the SCRIPTED feeder locate / pins on Kissimmee, plus the answers. */
export function scriptedAnswersOptions(job: GapJob, live: Live0930, countResult: unknown): ReplayPricingOptions {
  const s = SCRIPTED_ANSWERS[job];
  return {
    rows: 'projected', countResult: countResult as never, stage: 'due', ignoreCostLineSeeds: true, detail: true,
    feeders: job === 'kissimmee' ? { textSheets: textSheets0930(), locate: scriptedLocate(), pins: scriptedPins(p => p.page === 15) } : { textSheets: [] },
    accountTerms: scriptedAccountTerms(job, live), scopeAnswers: s.scopeAnswers, quoteFixturePackage: s.quoteFixturePackage, answers: s.answers,
  };
}
