// Fewer-questions round — the account a bid belongs to (Task 2's aliases,
// Task 6's remembered answers, Level 2 lesson scope): the matched account
// rule, only when it is NOT the Default rule (the Default rule is never an
// account).
import { pool } from '../db/pool';
import { getAccountRule } from './accountRulesDb';
import { collectMemories, applyAccountMemory, type MemorySourceBid } from '../ai/accountMemory';
import type { ReviewItem } from '../ai/reviewItems';
import type { AccountTermsSnapshot } from './accountRules';

export interface AccountIdentity { ruleId: string; ruleName: string; aliases: string[] }

export async function accountIdentityOf(snap: AccountTermsSnapshot | null | undefined): Promise<AccountIdentity | null> {
  if (!snap?.ruleId) return null;
  const rule = await getAccountRule(snap.ruleId).catch(() => null);
  if (!rule || rule.isDefault) return null;
  return { ruleId: rule.id, ruleName: rule.name, aliases: rule.matchAliases };
}


/** Fewer-questions round Task 6 — the other bids of this account (same
 *  non-default rule id, never this bid), newest first, with their current
 *  review items. Remembered answers are taken from these (accountMemory.ts);
 *  takeoff_labeled_events is never read. */
export async function loadAccountMemorySources(bidId: string, ruleId: string): Promise<MemorySourceBid[]> {
  const { rows } = await pool.query(
    `SELECT tr.bid_id, b.name, tr.created_at, tr.review_items
       FROM takeoff_results tr JOIN bids b ON b.id = tr.bid_id
      WHERE tr.account_terms->>'ruleId' = $1 AND tr.bid_id <> $2 AND tr.review_items IS NOT NULL
      ORDER BY tr.created_at DESC LIMIT 50`,
    [ruleId, bidId],
  );
  return rows.map(r => ({ bidId: r.bid_id as string, bidName: (r.name as string) || 'another bid', createdAt: new Date(r.created_at as string).toISOString(), items: (r.review_items as ReviewItem[]) ?? [] }));
}

/** The pipeline's memory step for finalizeReview (never throws: no memory
 *  is ever a reason for a run to fail). */
export async function accountMemoryApplier(bidId: string, account: AccountIdentity | null): Promise<((items: ReviewItem[]) => ReviewItem[]) | undefined> {
  if (!account) return undefined;
  try {
    const memories = collectMemories(await loadAccountMemorySources(bidId, account.ruleId));
    if (!memories.length) return undefined;
    return items => applyAccountMemory(items, memories, { ruleId: account.ruleId, ruleName: account.ruleName });
  } catch {
    return undefined;
  }
}
