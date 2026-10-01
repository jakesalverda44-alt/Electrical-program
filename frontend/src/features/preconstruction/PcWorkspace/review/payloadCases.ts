// UI cleanup round 2A, Task 0 — the payload freeze.
//
// Every review answer the UI can POST, as a minimal fixture plus the exact
// request body it must send. Written against the CURRENT panel and then held
// fixed while the UI is rebuilt: the tests in
// ../TakeoffReviewPanel.payloads.test.tsx drive whatever UI exists and assert
// `toStrictEqual(expected)`. DO NOT CHANGE the frozen section below. Only add
// to the NEW_UI_ONLY section at the bottom.
import type { ReviewItem } from '../TakeoffReviewPanel';

export interface PayloadCase { items: ReviewItem[]; expected: Record<string, unknown> }

const ZERO_DETAIL = 'Counted 0: not found on any counted plan sheet.';
const G: ReviewItem = { id: 'count:G', kind: 'count', group: 'zero', title: 'Type G — 6 in LED downlight', detail: ZERO_DETAIL, aiCount: 0, actions: ['count', 'markers', 'not_on_job'] };
const OS: ReviewItem = { id: 'count:OS', kind: 'count', group: 'zero', title: 'Type OS — Ceiling occupancy sensor', detail: ZERO_DETAIL, aiCount: 0, actions: ['count', 'markers', 'not_on_job'] };
const L: ReviewItem = { id: 'count:L', kind: 'count', group: 'zero', title: 'Type L — LED wall sconce', detail: ZERO_DETAIL, aiCount: 0, actions: ['count', 'markers', 'not_on_job'] };
const HEADS: ReviewItem = { id: 'count:S1:heads', kind: 'count', group: 'heads', title: 'Type S1 — fixture heads', detail: '2 poles counted, but the schedule does not say how many heads each pole carries.', actions: ['count', 'not_on_job'] };
const COVERAGE: ReviewItem = { id: 'coverage:SL', kind: 'count', group: 'coverage', title: 'Type SL — Site light, partly covered', detail: 'Counted on 2 of 3 site sheets.', aiCount: 9, actions: ['count', 'markers', 'confirm', 'not_on_job'] };
const RECOUNT: ReviewItem = { id: 'recount:A', kind: 'count', group: 'recount', title: 'Type A — 2x4 troffer: a recount found fewer', detail: 'First pass 70, recount 65.', aiCount: 70, actions: ['count', 'confirm'] };
const AREA_A: ReviewItem = { id: 'area:A', kind: 'area', group: 'area', title: 'Type A: same area or different areas?', detail: 'E-2.1 40 / E-2.2 35 — same area (keep 40) or different areas (sum 75)?', options: ['Same area — keep 40', 'Different areas — sum 75'], actions: ['answer', 'count'] };
const AREA_GFI: ReviewItem = { id: 'area:GFI', kind: 'area', group: 'area:E-2 / E-2.1', title: 'Type GFI: same area or different areas?', detail: 'E-2 16 / E-2.1 4 — same area (keep 16) or different areas (sum 20)?', options: ['Same area — keep 16', 'Different areas — sum 20'], actions: ['answer', 'count'] };
const AREA_DUPLEX: ReviewItem = { id: 'area:DUPLEX', kind: 'area', group: 'area:E-2 / E-2.1', title: 'Type DUPLEX: same area or different areas?', detail: 'E-2 11 / E-2.1 2', options: ['Same area — keep 11', 'Different areas — sum 13'], actions: ['answer', 'count'] };
const SCOPE: ReviewItem = { id: 'scope:power_poles', kind: 'scope_question', group: 'scope', title: 'Power poles', detail: 'Who furnishes and installs the power poles? (APT / GC / Owner)', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 power poles (E-2)'] };
const SCOPE_FURNISH: ReviewItem = { id: 'scope:power_poles:furnish', kind: 'scope_question', group: 'scope', title: 'Power poles — furnished by', detail: 'Who FURNISHES the power poles?', question: 'Who FURNISHES the power poles?', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', notes: [] };
const SCOPE_INSTALL: ReviewItem = { id: 'scope:power_poles:install', kind: 'scope_question', group: 'scope', title: 'Power poles — installed by', detail: 'Who INSTALLS the power poles?', question: 'Who INSTALLS the power poles?', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', notes: [] };
const REUSE: ReviewItem = { id: 'reuse:PANEL', kind: 'area', group: 'remodel', title: 'Panel LP-1: existing, reused or new?', detail: 'The plans label panel LP-1 as existing.', options: ['Existing, reused — no new install, no demolition', 'New install — the old one is removed'], actions: ['answer'] };
const DEMOSUGGEST: ReviewItem = { id: 'demosuggest:LIGHT', kind: 'area', group: 'remodel', title: 'Demolition of lights: how many removed?', detail: '11 lights are shown on the demolition plan.', options: ['Use the suggestion — 4 removed', 'Keep all 11 — every one shown is removed', 'None removed — 0'], actions: ['answer', 'count'] };
const RECLASSIFIED: ReviewItem = { id: 'statuscrop:reclassified', kind: 'area', group: 'remodel', title: 'Some devices were reclassified as existing', detail: 'A second look at the tiles called 6 devices existing.', options: ['Confirm — they are existing (not priced)', 'Restore — count them as new, as the tile pass read them'], actions: ['answer'] };
const ASSIGN_AT: ReviewItem = { id: 'typicalassignat:PP-1..6:SIMPLEX', kind: 'confirm', group: 'typical', title: '2 SIMPLEX drawn at a power pole: the same outlet as the pole package, or additional?', detail: 'The pole types are assigned (PP-1..6), adding 6 SIMPLEX from the legend packages.', options: ['Additional — a separate SIMPLEX', 'The same outlet as the power pole package (−2)'], actions: ['answer'] };
const CONVENTIONS: ReviewItem = { id: 'remodel:conventions', kind: 'count', group: 'remodel', title: 'How are new vs existing devices shown on these plans?', detail: 'The plans show existing work.', options: ['All devices on these plans are new — count everything', 'Shaded / filled symbols are new; open symbols are existing — re-run the analysis to apply'], actions: ['answer'] };
const UNLISTED: ReviewItem = { id: 'unlisted:H', kind: 'count', group: 'unlisted', type: 'H', title: 'Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?', detail: 'SUGGESTION ONLY — not counted', aiCount: 13, options: ['Same as Type A'], actions: ['answer', 'count', 'not_on_job'] } as ReviewItem;
const LEGEND_ID = 'legend-zero:MS-OS-PC';
const LEGEND: ReviewItem = {
  id: LEGEND_ID, kind: 'count', group: 'legend-zero', title: '3 legend items not found on any counted sheet — answer each one', detail: 'Motion sensor; Occupancy sensor; Photocell.', actions: ['count', 'markers', 'not_on_job'],
  groupedTypes: [
    { key: 'MS', type: 'Motion sensor', description: 'Motion sensor' },
    { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
    { key: 'PC', type: 'Photocell', description: 'Photocell' },
  ],
};
const GFCI_ITEM: ReviewItem = {
  id: 'gapfill:GFCI', kind: 'count', group: 'gapfill', title: 'Gap-fill found 2 possible GFCI — confirm on plans', detail: 'd', actions: ['markers', 'confirm', 'count'],
  reconcileMembers: [{ key: 'GFCI', type: 'GFCI', description: 'GFCI duplex receptacle', unit: 'count', currentQty: 7, headsPerPole: null }],
};
const S1S2_ITEM: ReviewItem = {
  id: 'reconcile:S1+S2', kind: 'confirm', group: 'reconcile', title: 'Possible shortfall: S1/S2 vs LUMINAIRE SCHEDULE', detail: 'd', actions: ['confirm', 'count'],
  reconcileMembers: [
    { key: 'S1', type: 'S1', description: 'Pole light', unit: 'heads', currentQty: 2, headsPerPole: 1 },
    { key: 'S2', type: 'S2', description: 'Dual-head pole light', unit: 'heads', currentQty: 2, headsPerPole: 2 },
  ],
};
const GAPFILL_S2: ReviewItem = {
  id: 'gapfill:S2', kind: 'count', group: 'gapfill', title: 'Gap-fill found 1 possible S2', detail: 'schedule 4 heads, plans 2', actions: ['markers', 'confirm', 'count'],
  reconcileMembers: [{ key: 'S2', type: 'S2', description: 'Twin-head area light', unit: 'heads', currentQty: 2, headsPerPole: null, resolution: { action: 'markers', poles: 2, needs: 'heads', by: 'Jake', at: 't' } }],
};
const ASSIGN: ReviewItem = {
  id: 'typicalassign:PP-1..6', kind: 'count', group: 'typical', title: 'Power poles PP-1..6: which types does each pole carry?', detail: '6 power poles.', actions: ['count', 'confirm'],
  reconcileMembers: [
    { key: '#1 Office power pole', type: '#1 Office power pole', description: '1 × SIMPLEX', unit: 'count', currentQty: 0, headsPerPole: null },
    { key: '#4 Tester power pole', type: '#4 Tester power pole', description: '1 × DUPLEX', unit: 'count', currentQty: 0, headsPerPole: null },
  ],
};
const COUNTING: ReviewItem = { id: 'counting:not_run', kind: 'confirm', group: 'counting', title: 'No fixture schedule/legend found — counts not verified', detail: 'Counting did not run: ...', actions: ['confirm'] };
const SHEET2: ReviewItem = { id: 'sheet:a.pdf#2', kind: 'confirm', group: 'sheets', title: 'Page 2 of a.pdf was not counted', detail: 'Title sheet?', actions: ['confirm'] };
const SHEET3: ReviewItem = { id: 'sheet:a.pdf#3', kind: 'confirm', group: 'sheets', title: 'Page 3 of a.pdf was not counted', detail: 'Title sheet?', actions: ['confirm'] };
// multiSelect: the same two zero items, WITHOUT a group field (they land in the
// 'zero' group by detail) — as the original test did.
const G_NOGROUP: ReviewItem = { ...G, group: undefined, actions: undefined };
const OS_NOGROUP: ReviewItem = { ...OS, group: undefined, actions: undefined };

export const GROUP_ID = LEGEND_ID;

export const CASES: Record<string, PayloadCase> = {
  zeroCount: { items: [G, OS], expected: { itemIds: ['count:G'], action: 'count', qty: 11 } },
  zeroMarkers: { items: [G, OS], expected: { itemIds: ['count:G'], action: 'markers' } },
  zeroNotOnJob: { items: [G, OS], expected: { itemIds: ['count:OS'], action: 'not_on_job', reason: 'No sensors on this prototype' } },
  headsCount: { items: [HEADS], expected: { itemIds: ['count:S1:heads'], action: 'count', qty: 4 } },
  coverageConfirm: { items: [COVERAGE], expected: { itemIds: ['coverage:SL'], action: 'confirm', reason: 'Checked E-1 by hand: 9 poles' } },
  recountCount: { items: [RECOUNT], expected: { itemIds: ['recount:A'], action: 'count', qty: 68 } },
  areaAnswer: { items: [AREA_A], expected: { itemIds: ['area:A'], action: 'answer', answer: 'Different areas — sum 75' } },
  areaCount: { items: [AREA_A], expected: { itemIds: ['area:A'], action: 'count', qty: 60 } },
  areaBulkSum: { items: [AREA_GFI, AREA_DUPLEX], expected: { itemIds: ['area:GFI', 'area:DUPLEX'], action: 'answer', answerIndex: 1 } },
  areaBulkKeep: { items: [AREA_GFI, AREA_DUPLEX], expected: { itemIds: ['area:GFI', 'area:DUPLEX'], action: 'answer', answerIndex: 0 } },
  scopeAnswer: { items: [SCOPE], expected: { itemIds: ['scope:power_poles'], action: 'answer', answer: 'GC' } },
  scopeSuggested: { items: [SCOPE_FURNISH], expected: { itemIds: ['scope:power_poles:furnish'], action: 'answer', answer: 'APT' } },
  scopeBulkAccept: { items: [SCOPE_FURNISH, SCOPE_INSTALL], expected: { itemIds: ['scope:power_poles:furnish', 'scope:power_poles:install'], action: 'answer', useSuggested: true } },
  reuseAnswer: { items: [REUSE], expected: { itemIds: ['reuse:PANEL'], action: 'answer', answer: 'New install — the old one is removed' } },
  demosuggestAnswer: { items: [DEMOSUGGEST], expected: { itemIds: ['demosuggest:LIGHT'], action: 'answer', answer: 'Keep all 11 — every one shown is removed' } },
  demosuggestZero: { items: [DEMOSUGGEST], expected: { itemIds: ['demosuggest:LIGHT'], action: 'count', qty: 0 } },
  reclassifiedRestore: { items: [RECLASSIFIED], expected: { itemIds: ['statuscrop:reclassified'], action: 'answer', answer: 'Restore — count them as new, as the tile pass read them' } },
  assignAtAnswer: { items: [ASSIGN_AT], expected: { itemIds: ['typicalassignat:PP-1..6:SIMPLEX'], action: 'answer', answer: 'The same outlet as the power pole package (−2)' } },
  conventionAnswer: { items: [CONVENTIONS], expected: { itemIds: ['remodel:conventions'], action: 'answer', answer: 'All devices on these plans are new — count everything' } },
  unlistedCount: { items: [UNLISTED], expected: { itemIds: ['unlisted:H'], action: 'count', qty: 13, reason: '4ft LED strip, surface mounted' } },
  unlistedSameAs: { items: [UNLISTED], expected: { itemIds: ['unlisted:H'], action: 'answer', answer: 'Same as Type A' } },
  unlistedNotOnJob: { items: [UNLISTED], expected: { itemIds: ['unlisted:H'], action: 'not_on_job', reason: 'Title block tag, not a fixture' } },
  legendMemberCount: { items: [LEGEND], expected: { itemIds: [LEGEND_ID], action: 'count', qty: 6, memberKey: 'OS' } },
  legendMemberNoj: { items: [LEGEND], expected: { itemIds: [LEGEND_ID], action: 'not_on_job', reason: 'Design-build scope, not this job', memberKey: 'MS' } },
  legendAllRemaining: { items: [LEGEND], expected: { itemIds: [LEGEND_ID], action: 'not_on_job', reason: 'Design-build scope, not this job' } },
  gapfillMarkers: { items: [GFCI_ITEM], expected: { itemIds: ['gapfill:GFCI'], action: 'markers', memberKey: 'GFCI' } },
  gapfillReject: { items: [GFCI_ITEM], expected: { itemIds: ['gapfill:GFCI'], action: 'confirm', reason: 'Suggested marks are dimension ticks, not GFCI receptacles', memberKey: 'GFCI' } },
  reconcileCount: { items: [S1S2_ITEM], expected: { itemIds: ['reconcile:S1+S2'], action: 'count', qty: 3, memberKey: 'S1' } },
  needsHeads: { items: [GAPFILL_S2], expected: { itemIds: ['gapfill:S2'], action: 'count', qty: 3, memberKey: 'S2' } },
  assignCount: { items: [ASSIGN], expected: { itemIds: ['typicalassign:PP-1..6'], action: 'count', qty: 1, memberKey: '#1 Office power pole' } },
  assignNone: { items: [ASSIGN], expected: { itemIds: ['typicalassign:PP-1..6'], action: 'confirm', reason: 'No tester pole on this job', memberKey: '#4 Tester power pole' } },
  confirmOnly: { items: [COUNTING], expected: { itemIds: ['counting:not_run'], action: 'confirm', reason: 'Checked E-3 by hand: 40 troffers' } },
  zeroBulkNoj: { items: [L, OS], expected: { itemIds: ['count:L', 'count:OS'], action: 'not_on_job', reason: 'Not in this remodel scope' } },
  sheetsBulkConfirm: { items: [SHEET2, SHEET3], expected: { itemIds: ['sheet:a.pdf#2', 'sheet:a.pdf#3'], action: 'confirm', reason: 'Both are title sheets only' } },
  multiSelect: { items: [G_NOGROUP, OS_NOGROUP], expected: { itemIds: ['count:G', 'count:OS'], action: 'not_on_job', reason: 'Generic legend' } },
};

export const REOPEN = { url: '/preconstruction/b1/review/reopen', body: { itemId: 'count:G' } };

// ---------------------------------------------------------------------------
// NEW_UI_ONLY — additive section (preset-reason bodies: same shape, different
// reason text). Nothing above this line may change after Task 0.
// ---------------------------------------------------------------------------
export const NEW_UI_ONLY: Record<string, PayloadCase> = {};
