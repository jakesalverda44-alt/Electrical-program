// Task 6 (phase 2 takeoff fidelity): pre-bid cross-check feeds Agent 3.
//
// When a Cowork pre-bid takeoff exists (bid_takeoffs kind='prebid' — a
// human-reviewed independent count produced right after the bid invite was
// accepted, see takeoffParse.ts), Agent 3's QC step never saw it: the pipeline
// was throwing away the strongest QC available, two independent takeoffs to
// reconcile. This module builds the block Agent 3's user message appends when
// one exists; runPipeline decides whether to call it and null just means
// "today's behavior" — no pre-bid uploaded, nothing appended.
//
// Makes no AI/DB calls — pure formatting off the already-loaded row.
import type { TakeoffCategory, TakeoffLineItem } from '../utils/takeoffParse';
import { sanitizeForPrompt } from './sanitizeForPrompt';

/** Cap on the cross-check block sent to Agent 3 — mirrors pdfText.ts's per-run caps. */
export const CROSS_CHECK_CAP = 20_000;

export const PREBID_CROSS_CHECK_HEADER =
  '--- INDEPENDENT PRE-BID TAKEOFF (human-reviewed Cowork package) ---';

export interface PrebidTakeoffRow {
  categories?: Pick<TakeoffCategory, 'name'>[] | null;
  line_items?: Pick<TakeoffLineItem, 'category' | 'description' | 'unit' | 'qty' | 'confidence'>[] | null;
}

/**
 * Pure: format a stored pre-bid takeoff row into the block appended to Agent
 * 3's user message. Null when there is no pre-bid takeoff at all (no row, or
 * a row with zero line items) — callers append nothing in that case.
 */
export function buildPrebidCrossCheck(prebid: PrebidTakeoffRow | null | undefined): string | null {
  const items = prebid?.line_items;
  if (!items || items.length === 0) return null;

  // Group by each item's own category (parseTakeoffWorkbook builds `categories`
  // off the exact same field, so this reproduces the same grouping even when
  // the categories list is absent). First-appearance order is the fallback;
  // the row's own categories order — the Pre-Bid tab's display order — wins
  // when present.
  const byCategory = new Map<string, typeof items>();
  const firstSeenOrder: string[] = [];
  for (const item of items) {
    const cat = item.category || '(uncategorized)';
    const existing = byCategory.get(cat);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(cat, [item]);
      firstSeenOrder.push(cat);
    }
  }
  const namedOrder = (prebid?.categories ?? []).map(c => c.name).filter(name => byCategory.has(name));
  const categoryOrder = [
    ...namedOrder,
    ...firstSeenOrder.filter(cat => !namedOrder.includes(cat)),
  ];

  // Phase 4 Task 6.1 (Phase 2 F8) — category names and item descriptions
  // are untrusted (parsed straight off an uploaded workbook — see
  // takeoffParse.ts) and land directly in this same delimiter-framed
  // block; sanitize before interpolating so neither can impersonate this
  // module's own PREBID_CROSS_CHECK_HEADER (or any other "--- ... ---"
  // prompt delimiter used elsewhere in the pipeline).
  const lines: string[] = [PREBID_CROSS_CHECK_HEADER];
  for (const cat of categoryOrder) {
    lines.push('', `${sanitizeForPrompt(cat)}:`);
    for (const item of byCategory.get(cat)!) {
      const qty = item.qty === null || item.qty === undefined
        ? 'UNRESOLVED'
        : `${item.qty} ${item.unit ?? ''}`.trim();
      const conf = item.confidence ? ` [${item.confidence}]` : '';
      lines.push(`- ${sanitizeForPrompt(item.description ?? '')} — ${qty}${conf}`);
    }
  }

  const text = lines.join('\n');
  if (text.length <= CROSS_CHECK_CAP) return text;
  return `${text.slice(0, CROSS_CHECK_CAP)}\n[TRUNCATED — pre-bid cross-check exceeded limit]`;
}
