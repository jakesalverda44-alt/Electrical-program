// Fewer-questions round — the account a bid belongs to (Task 2's aliases,
// Task 6's remembered answers, Level 2 lesson scope): the matched account
// rule, only when it is NOT the Default rule (the Default rule is never an
// account).
import { getAccountRule } from './accountRulesDb';
import type { AccountTermsSnapshot } from './accountRules';

export interface AccountIdentity { ruleId: string; ruleName: string; aliases: string[] }

export async function accountIdentityOf(snap: AccountTermsSnapshot | null | undefined): Promise<AccountIdentity | null> {
  if (!snap?.ruleId) return null;
  const rule = await getAccountRule(snap.ruleId).catch(() => null);
  if (!rule || rule.isDefault) return null;
  return { ruleId: rule.id, ruleName: rule.name, aliases: rule.matchAliases };
}

