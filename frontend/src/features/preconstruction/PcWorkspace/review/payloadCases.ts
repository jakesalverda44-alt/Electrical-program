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
const MB: ReviewItem = { id: 'count:MB', kind: 'count', group: 'zero', category: 'equipment', title: 'Type MB — Meter base', detail: ZERO_DETAIL, aiCount: 0, actions: ['count', 'markers', 'not_on_job'] };
const ASSIGN_POLES: ReviewItem = {
  id: 'typicalassign:PP-1..6', kind: 'count', group: 'typical', title: '6 power poles found on the plans, 2 power pole types — assign a type to each power pole', detail: 'd',
  actions: ['answer'], options: ['tag:1', 'tag:2', 'not_a_host'],
  reconcileMembers: [
    { key: 'pole:E-2:1', type: 'power pole at E-2', description: 'which type is this power pole? Suggested: #1 Office power pole (from the tag read there; not counted)', unit: 'count', currentQty: 0, headsPerPole: null },
    { key: 'pole:held:E-2:1', type: 'power pole on E-2 enlarged plan #11', description: 'on enlarged plan #11 — may repeat a main-plan power pole', unit: 'count', currentQty: 0, headsPerPole: null },
    { key: 'pole:unlocated:n1', type: 'stated power pole 1 of 1 — not found on the plans', description: 'which type, or not on the job?', unit: 'count', currentQty: 0, headsPerPole: null },
  ],
  hostAssignment: { hostNoun: 'power pole', perPole: {
    types: [{ typeId: 'tag:1', label: '#1 Office power pole' }, { typeId: 'tag:2', label: '#2 Checkout power pole' }],
    poles: [
      { id: 'pole:E-2:1', sheetLabel: 'E-2', pdf: { sheetKey: 'set.pdf#50', x: 1192.6, y: 2226.9 }, tag: '1', suggestedType: 'tag:1' },
      { id: 'pole:held:E-2:1', sheetLabel: 'E-2', pdf: { sheetKey: 'set.pdf#50', x: 140, y: 495 }, held: true, viewportLabel: '#11' },
      { id: 'pole:unlocated:n1', unlocated: true },
    ],
  } },
};
const ALIGN: ReviewItem = { id: 'typicalalign:PP-1..6', kind: 'area', group: 'typical', title: "PP-1..6: E-2's 4 could not be lined up with E-1's 4 — same poles or more?", detail: 'd', options: ['Same poles — 4', 'Different poles — 8'], actions: ['answer'] };
const PIPES: ReviewItem = { id: 'pipepoles:PP-1..6:3-pvc', kind: 'area', group: 'info', blocking: false, title: '2 3" PVC data/security pipes at pole #5 — price them as power poles?', detail: 'd', options: ['No — raceway only, not power poles', 'Yes — price 2 as power poles'], suggested: 'No — raceway only, not power poles', actions: ['answer'] };
const CHECKLIST: ReviewItem = {
  id: 'textzero:equipment', kind: 'count', group: 'textzero', category: 'equipment', title: '4 items from the notes / schedules weren\'t drawn as symbols — confirm counts', detail: 'd',
  actions: ['count', 'markers', 'not_on_job', 'confirm'],
  groupedTypes: [
    { key: 'TSTAT', type: 'TSTAT', description: 'Thermostats #1 and #2 above electric panels (2)', rowKind: 'text', quote: { text: 'Thermostats #1 and #2 above electric panels (2)', sheet: 'the equipment list', field: 'equipment list' },
      proposal: { action: 'count', qty: 2, reason: 'Stated: "Thermostats #1 and #2 above electric panels (2)" (the equipment list)', tier: 'stated' } },
    { key: 'PYLON SIGN', type: 'PYLON SIGN', description: 'Pylon sign connection, circuit A-18', rowKind: 'text', quote: { text: 'Pylon sign connection, circuit A-18', sheet: 'the equipment list', field: 'equipment list' },
      proposal: { action: 'not_on_job', reason: 'Covered by SIGNS (A-18) — already a counted line ("Front wall sign A-6, side wall signs A-14/A-16, pylon sign A-18")', tier: 'covered' }, alsoDrawn: [{ sheet: 'E-7', count: 1 }] },
    { key: 'MB', type: 'MB', description: 'Meter base NEMA 3R, parallel (2)4#3/0 2"C', rowKind: 'text', quote: { text: 'Meter base NEMA 3R, parallel (2)4#3/0 2"C', sheet: 'the equipment list', field: 'equipment list' } },
    { key: 'T', type: 'T', description: 'Thermostat', rowKind: 'legend', twinOf: 'TSTAT', label: 'a legend symbol — needs your number' },
  ],
};
const FAMILY: ReviewItem = { id: 'family:S1', kind: 'confirm', group: 'family', title: 'Site poles: E-7 shows 4 site poles; PH0.1 shows S1 2 + S2 1 = 3', detail: 'd', actions: ['confirm'] };
export const NEW_UI_ONLY: Record<string, PayloadCase> = {
  zeroNotOnJobPreset: { items: [G, OS], expected: { itemIds: ['count:OS'], action: 'not_on_job', reason: 'Not shown on the plans for this job' } },
  coverageConfirmPreset: { items: [COVERAGE], expected: { itemIds: ['coverage:SL'], action: 'confirm', reason: 'Checked on the plans — 9 is right' } },
  gapfillRejectPreset: { items: [GFCI_ITEM], expected: { itemIds: ['gapfill:GFCI'], action: 'confirm', reason: 'Checked the plans — keep the current count', memberKey: 'GFCI' } },
  // Review fixes S6 / B1: QuantityCard markers + not-on-job, recount confirm, the member waiting on poles,
  // counting:* confirm typed only.
  coverageMarkers: { items: [COVERAGE], expected: { itemIds: ['coverage:SL'], action: 'markers' } },
  coverageNotOnJob: { items: [COVERAGE], expected: { itemIds: ['coverage:SL'], action: 'not_on_job', reason: 'Counted on all three site sheets already' } },
  recountConfirm: { items: [RECOUNT], expected: { itemIds: ['recount:A'], action: 'confirm', reason: 'Recount missed a sheet, 70 is right' } },
  needsPoles: {
    items: [{ ...GAPFILL_S2, id: 'gapfill:S3', reconcileMembers: [{ key: 'S3', type: 'S3', description: 'Pole light', unit: 'count', currentQty: 2, headsPerPole: null, resolution: { action: 'count', qty: 4, needs: 'poles', by: 'Jake', at: 't' } }] }],
    expected: { itemIds: ['gapfill:S3'], action: 'count', qty: 2, memberKey: 'S3' },
  },
  countingTypedOnly: { items: [COUNTING], expected: { itemIds: ['counting:not_run'], action: 'confirm', reason: 'Checked E-3 by hand: 40 troffers' } },
  // Equipment: no ready-made reasons, typed only.
  equipmentNoPresets: { items: [MB, OS], expected: { itemIds: ['count:MB'], action: 'not_on_job', reason: 'Design-build scope, not this job' } },
  // Accuracy round B3 (feat/accuracy-reading) — a per-pole assignment: one select per pole, exactly {memberKey, answer}.
  assignPoleAnswer: { items: [ASSIGN_POLES], expected: { itemIds: ['typicalassign:PP-1..6'], action: 'answer', answer: 'tag:2', memberKey: 'pole:E-2:1' } },
  assignHeldPole: { items: [ASSIGN_POLES], expected: { itemIds: ['typicalassign:PP-1..6'], action: 'answer', answer: 'not_a_host', memberKey: 'pole:held:E-2:1' } },
  // Fix round 2/3 — "same poles or more?": the option string verbatim.
  typicalalignAnswer: { items: [ALIGN], expected: { itemIds: ['typicalalign:PP-1..6'], action: 'answer', answer: 'Different poles — 8' } },
  // B4 — pipes at a pole: the option string verbatim (non-blocking).
  pipepolesAnswer: { items: [PIPES], expected: { itemIds: ['pipepoles:PP-1..6:3-pvc'], action: 'answer', answer: 'Yes — price 2 as power poles' } },
  // A — the site-pole family question: confirm with a TYPED reason (no presets).
  familyConfirmTyped: { items: [FAMILY], expected: { itemIds: ['family:S1'], action: 'confirm', reason: 'E-7 shows 4 poles, PH0.1 is out of date' } },
  // Fewer-questions round Task 7 — the checklist ("Use 2" with the stated quote; "Confirm all"), and Undo of an automatic answer.
  checklistUseStated: { items: [CHECKLIST], expected: { itemIds: ['textzero:equipment'], action: 'count', qty: 2, reason: 'Stated: "Thermostats #1 and #2 above electric panels (2)" (the equipment list)', memberKey: 'TSTAT' } },
  checklistConfirmAll: { items: [CHECKLIST], expected: { itemIds: ['textzero:equipment'], action: 'confirm', reason: 'Confirmed the pre-filled checklist against the quotes' } },
  checklistMemberNoj: { items: [CHECKLIST], expected: { itemIds: ['textzero:equipment'], action: 'not_on_job', reason: 'Meter base is by the utility here', memberKey: 'MB' } },
};
// Fewer-questions round Task 7 — Undo of an automatic answer = the existing reopen.
export const AUTO_UNDO = { url: '/preconstruction/b1/review/reopen', body: { itemId: 'area:$' } };
export const AUTO_UNDO_MEMBER = { url: '/preconstruction/b1/review/reopen', body: { itemId: 'legend-zero:MS-OS-PC', memberKey: 'MS' } };
// Level 2 learning, Task 15 — the learning bodies (not review resolutions).
export const LEARNING_BODIES = {
  lessonFromItem: { url: '/learning/lessons/from-item', body: { bidId: 'b1', itemId: 'unlisted:H' } },
  learningOffForBid: { url: '/learning/bids/b1/off', body: { refKind: 'lesson', refId: '11111111-1111-4111-8111-111111111111' } },
  approveDefaultScope: { url: '/learning/lessons/L1/approve', body: { scope_kind: 'all', scope_value: null, applies_to: ['review'] } },
};
