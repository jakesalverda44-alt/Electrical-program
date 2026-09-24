// Evidence round Parts 1-3 — the Kissimmee-SHAPED end-to-end test.
//
// Inputs are the REAL Opus baseline run (bid d9abdb87, 2026-09-24): Agent 1's
// output, the page inventory and every mark the Opus counter placed, plus a
// RASTER plan set (image-only pages, no text layer, /Rotate 270) carrying real
// crops of E-1 / E-2 / E-4 at their real positions. The fake client answers:
//   * the counter — the baseline's own marks for each sheet, reported in every
//     tile that contains them (plus, "after", the pole-tag host markers and
//     the two GFCIs the E-1 restroom plan repeats — what the new instructions
//     ask a counter to report);
//   * the evidence readers — the executor's transcriptions of the real sheets.
// The REAL counting stage runs: renders, viewport attribution, enlarged-plan
// reconciliation, the sheet-pair relationship, typicals, schedules, families,
// the merge, the review list, and the eval's own diff against the committed
// expected file.
//   BEFORE = the same inputs with the evidence readers off (today's behaviour);
//   it must reproduce the live baseline's numbers, which is what makes the
//   fixture trustworthy.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildRasterSet, BLANK_PAGE, KISSIMMEE_E1, KISSIMMEE_E2, KISSIMMEE_E4, type RasterPage } from './fixtures/evidence/buildRasterSheet';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from './fixtures/evidence/kissimmeeBaseline';
import { evidenceResponder, isEvidenceRequest, E2_HOST_MARKS, E1_RESTROOM_REPEATS, E1_DECK_DUPLEX, gapFillResponder, isGapFillRequest } from './fixtures/evidence/kissimmeeReplies';
import { fakeAnthropic, systemText, userText, type FakeRequest, type FakeReply } from './fixtures/takeoff/fakeAnthropic';
import { screenPosition } from '../estimating/pageGeometry';
import { planCountTiles } from '../ai/countRender';
import { counterTileSpec } from '../ai/modelLimits';
import { runCountingStage, runSupplementCounting, type CountResult } from '../ai/countingStage';
import { buildReviewItems, referencedSheetItems, reviewItemIsOpen, enforcedCounts, applyGroupMemberResolution, type ReviewItem } from '../ai/reviewItems';
import { normalizeSheetId } from '../ai/sheetRefs';
import { resolveAccountTerms } from '../bidstd/accountRules';
import { scopeQuestionsFor } from '../bidstd/accountRulesDb';
import { AUTOZONE_SEED } from './fixtures/bidstd/kissimmeeProposal';
import { diffAgainstExpected, formatDiffTable, validateExpectedFile, usageCost, type EvalDiff } from '../eval/takeoffEval';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { DEFAULT_EVIDENCE_MODEL } from '../routes/preconstruction';
import type { InventoryPage } from '../ai/countSheets';
import { normalizeTypeKey } from '../ai/countTargets';

const baseline = loadKissimmeeBaseline();
const COUNTER_MODEL = 'claude-opus-5-5';
const EVIDENCE_MODEL = DEFAULT_EVIDENCE_MODEL;
const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/autozone-10077-kissimmee.expected.json'), 'utf8')));

type Sym = { type: string; x: number; y: number; circuit?: string };

/** A counter that reports every truth symbol of the sheet in every tile of
 *  the call containing it, for the types the call asked for. Tile rects come
 *  from the same tile plan the renderer uses (pdftoppm at 300 DPI). */
function tileCounter(truth: Map<string, { geom: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number }; symbols: Sym[] }>) {
  const spec = counterTileSpec(COUNTER_MODEL);
  return (req: FakeRequest): FakeReply => {
    const text = userText(req);
    const label = Object.keys(Object.fromEntries(truth)).find(l => text.includes(`SHEET: ${l}`));
    if (!label) return { text: JSON.stringify({ marks: [], unreadable: [], notes: [] }) };
    const { geom: g, symbols } = truth.get(label)!;
    const asked = new Set([...text.split('\n')].filter(l => l.startsWith('- ') && l.includes(' | ')).map(l => normalizeTypeKey(l.slice(2).split(' | ')[0])));
    const shown = g.rotation === 90 || g.rotation === 270 ? { w: g.heightPt / 72, h: g.widthPt / 72 } : { w: g.widthPt / 72, h: g.heightPt / 72 };
    const rects = new Map(planCountTiles(shown.w, shown.h, { tileIn: spec.tileIn }).map(r => [r.id, r]));
    const ids = [...text.matchAll(/Tile (R\d+C\d+) \(row/g)].map(m => m[1]);
    const marks: unknown[] = [];
    for (const s of symbols) {
      if (!asked.has(s.type)) continue;
      const d = screenPosition(s.x, s.y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
      for (const id of ids) {
        const t = rects.get(id)!;
        const nx = (d.x / 72 - t.leftIn) / t.widthIn, ny = (d.y / 72 - t.topIn) / t.heightIn;
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) marks.push([s.type, id, Number(nx.toFixed(4)), Number(ny.toFixed(4)), ...(s.circuit ? [s.circuit] : [])]);
      }
    }
    return { text: JSON.stringify({ marks, unreadable: [], notes: [] }), usage: { input_tokens: 25000, output_tokens: 1800 } };
  };
}

function truthFor(mode: 'before' | 'after') {
  const m = new Map<string, { geom: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number }; symbols: Sym[] }>();
  for (const s of baseline.sheets) {
    const symbols: Sym[] = baseline.marks.filter(x => x.sheetKey === s.key).map(x => ({ type: x.typeKey, x: x.x, y: x.y,
      // Fix round 3 / S19 — the "after" counter also reads circuit tags.
      ...(mode === 'after' && s.page === 49 && Math.abs(x.x - E1_DECK_DUPLEX.x) < 0.5 && Math.abs(x.y - E1_DECK_DUPLEX.y) < 0.5 ? { circuit: E1_DECK_DUPLEX.circuit } : {}) }));
    if (mode === 'after' && s.page === 50) symbols.push(...E2_HOST_MARKS);
    if (mode === 'after' && s.page === 49) symbols.push(...E1_RESTROOM_REPEATS);
    m.set(s.label, { geom: s.geometry, symbols });
  }
  return m;
}

const PAGE_BY_LABEL = new Map(baseline.inventory.map(p => [`${p.sheetNo} "${p.title}"`, p.page]));
const pageOf = (s: string) => PAGE_BY_LABEL.get(s) ?? (/#(\d+)$/.exec(s) ? Number(/#(\d+)$/.exec(s)![1]) : undefined);

let have = false;
let pdf: Buffer;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  const pages: RasterPage[] = Array.from({ length: 55 }, (_, i) => {
    const n = i + 1;
    if (n === 19) return { images: [], rotation: 0 };
    if (n === 49) return KISSIMMEE_E1;
    if (n === 50) return KISSIMMEE_E2;
    if (n === 52) return KISSIMMEE_E4;
    return BLANK_PAGE;
  });
  pdf = await buildRasterSet(pages);
}, 60_000);

interface Run { cr: CountResult; review: ReviewItem[]; diff: EvalDiff; calls: FakeRequest[]; usage: { input_tokens: number; output_tokens: number } }

async function run(mode: 'before' | 'after'): Promise<Run> {
  const counter = tileCounter(truthFor(mode));
  const ev = evidenceResponder(pageOf);
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isEvidenceRequest(req) ? ev(req)
    : isGapFillRequest(req) ? gf(req)
    : systemText(req).includes('counting symbols on ONE electrical plan sheet') ? counter(req)
    : (() => { throw new Error('unexpected call'); })()));
  const stage = await runCountingStage({
    client, model: COUNTER_MODEL, maxTokens: 32000,
    agent1: JSON.parse(JSON.stringify(baseline.agent1)), inventory: baseline.inventory as InventoryPage[],
    pdfs: new Map([[KISSIMMEE_FILE, pdf]]),
    ...(mode === 'after' ? { evidence: { model: EVIDENCE_MODEL, maxTokens: 16000 } } : {}),
  });
  const cr = stage.countResult;
  const snap = resolveAccountTerms(AUTOZONE_SEED, '"AutoZone" in the brand', baseline.agent1.furnishStatements as never, false);
  const loaded = new Set(baseline.inventory.map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));
  const review = [
    ...buildReviewItems(cr, scopeQuestionsFor(snap)),
    ...referencedSheetItems(baseline.agent1.missingSheets, { loadedSheetKeys: loaded, checkRefKeys: new Set() }, normalizeSheetId),
  ];
  return { cr, review, diff: diffAgainstExpected(expected, cr), calls, usage: stage.usage };
}

const row = (d: EvalDiff, id: string) => d.rows.find(r => r.id === id)!;

describe('Kissimmee-shaped fixture — before (evidence round off) reproduces the live Opus baseline', () => {
  let before: Run;
  beforeAll(async () => { if (have) before = await run('before'); }, 300_000);
  it('receptacles 19, GFCI 11, battery chargers 0, site poles 6 / heads 7, 46 review items — the live run\'s numbers', (ctx) => {
    if (!have) return ctx.skip();
    // eslint-disable-next-line no-console
    console.log(`[before]\n${formatDiffTable(before.diff)}\nreview items: ${before.review.length} (${before.review.filter(reviewItemIsOpen).length} blocking)`);
    expect(row(before.diff, 'receptacles_total').actual).toBe(19);
    expect(row(before.diff, 'gfci').actual).toBe(11);
    expect(row(before.diff, 'battery_chargers').actual).toBe(0);
    expect(row(before.diff, 'site_poles').actual).toBe(6);
    expect(row(before.diff, 'site_heads').actual).toBe(7);
    expect(row(before.diff, 'type_A').actual).toBe(73);
    expect(before.review.length).toBe(46);
  });
});

describe('Kissimmee-shaped fixture — after (Parts 1-3)', () => {
  let after: Run;
  beforeAll(async () => { if (have) after = await run('after'); }, 300_000);
  it('prints the eval diff and the review list', (ctx) => {
    if (!have) return ctx.skip();
    const ev = after.cr.evidence!;
    // eslint-disable-next-line no-console
    const gf = ev.gapFill;
    console.log(`[after]\n${formatDiffTable(after.diff)}\nreview items: ${after.review.length} (${after.review.filter(reviewItemIsOpen).length} blocking)\n${after.review.map(i => `  ${reviewItemIsOpen(i) ? 'B' : 'i'} ${i.id} — ${i.title}`).join('\n')}\nevidence calls ${ev.calls} (of which gap-fill/crop-check: ${gf?.calls ?? 0}), usage ${JSON.stringify(ev.usage)}, est $${usageCost(ev.usage, EVIDENCE_MODEL)?.toFixed(3)} total; gap-fill/crop-check alone: usage ${JSON.stringify(gf?.usage)}, est $${usageCost(gf?.usage, EVIDENCE_MODEL)?.toFixed(4)}`);
  });
  it('receptacles: every one traceable — drawn marks (E-1, E-2 #11 office), E-1 restroom plan, typicals at the power poles and coil+J boxes', (ctx) => {
    if (!have) return ctx.skip();
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    expect(t('SIMPLEX RECEPTACLE').components).toEqual({ drawn: 9, typical: 1, schedule: 0 }); // fix round B4: B-32 once
    // Fix round S1: the coil+J "receptacle mounted to base plate" is part of
    // the display-baseflex assembly (priced with COIL + J), not 3 more duplexes.
    expect(t('DUPLEX RECEPTACLE / FLOOR RECEPTACLE').components).toEqual({ drawn: 4, typical: 8, schedule: 0 });
    expect(t('COIL + J').assembly).toEqual([{ device: 'Receptacle mounted to base plate', deviceKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', perHost: 1 }]);
    expect(row(after.diff, 'baseflex')).toMatchObject({ actual: 3, expected: 8 });
    // Fix round (review a479103, B2/B3/S5) — gap-fill runs ONLY from a real
    // reconciliation shortfall, never an always-on "confirm" bias pass, and
    // a site-lighting schedule QTY is compared in HEADS, never poles. Once
    // both are fixed, Kissimmee's own LUMINAIRE SCHEDULE (QTY 4 heads) vs
    // S1 (2 poles x 1 head) + S2 (1 pole x 2 heads) = 4 heads matches
    // EXACTLY — the false alarm B2 called out is gone, so gap-fill never
    // runs on this fixture at all: GFCI stays the plans' own honest total,
    // never bumped by a synthetic reply. SIMPLEX 9+1, DUPLEX 4+8, GFCI 7
    // (1 main + 6 restroom plan), WP GFI 4 = 33. See gapFillEndToEnd.test
    // for the "a real reconciled shortfall -> suggest -> confirm -> count"
    // flow, on clearly-synthetic data.
    expect(t('GFCI').count).toBe(7);
    expect(t('WP GFI').count).toBe(4);
    expect(after.cr.evidence!.gapFill).toMatchObject({ findings: [], jobs: 0, candidates: 0, suggested: [] });
    expect(row(after.diff, 'gfci').actual).toBe(7 + 4);
    expect(row(after.diff, 'receptacles_total').actual).toBe(33);
    // The typicals: 5 pole types and the coil+J boxes, each with its quote.
    const exp = after.cr.evidence!.expansions.filter(e => e.status === 'expanded');
    expect(exp.map(e => [e.host, e.hostCount, e.perHost, e.expanded])).toEqual(expect.arrayContaining([
      ['Office area power pole', 1, 2, 2], ['Checkout counter power pole', 1, 1, 1], ['Parts pod power pole', 2, 1, 2],
      ['Test station power pole', 1, 1, 1], ['Test station power pole', 1, 1, 1], ['Commercial counter power pole', 1, 2, 2],
    ]));
    expect(after.cr.evidence!.expansions.filter(e => e.status === 'assembly').map(e => [e.host, e.hostCount])).toEqual([['Junction box with 6\'-0" flex conduit at wall & H.P. counters', 3]]);
    // Fix round S3 / fix round 3 S19: E-1's "duplex outlet at deck" sits
    // over the checkout pole once the sheets are aligned, but it is on A-31
    // (CCTV MONITOR) and the pole on A-29 (CK OUT REG & PRN): different
    // outlets — no question, nothing subtracted. S2: the office pole's
    // unstated floor simplex outlets are drawn near it (#11) -> information.
    expect(after.review.some(i => i.id.startsWith('typicalat:'))).toBe(false);
    expect(after.cr.evidence!.expansions.find(e => e.host === 'Checkout counter power pole')).toMatchObject({ expanded: 1, drawnAtHosts: 0 });
    expect(after.cr.evidence!.expansions.find(e => e.host === 'Checkout counter power pole')!.possibleAtHosts ?? 0).toBe(0);
    expect(after.review.find(i => i.id.startsWith('typicalqty:'))).toMatchObject({ blocking: false });
    expect(exp.every(e => e.quote.length > 20)).toBe(true);
    // The E-1 / E-2 receptacles were summed as complementary layers.
    expect(t('SIMPLEX RECEPTACLE').relations![0].kind).toBe('complementary');
    expect(after.review.some(i => i.id === 'area:SIMPLEX RECEPTACLE')).toBe(false);
  });
  it('site poles 3 / heads 4 — S1/S2 (PH0.1), E-7\'s untagged site light and E-3\'s SITE LIGHT are one DSX1 family, never stacked', (ctx) => {
    if (!have) return ctx.skip();
    expect(row(after.diff, 'site_poles').actual).toBe(3);
    expect(row(after.diff, 'site_heads').actual).toBe(4);
    const merged = after.cr.types.filter(t => t.status === 'merged').map(t => [t.key, t.mergedInto]);
    expect(merged).toEqual(expect.arrayContaining([['(UNTAGGED) SITE LIGHT', 'S1/S2'], ['SITE LIGHT', 'S1/S2'], ['W1', 'D'], ['W2', 'L']]));
  });
  it('4.2 reconciliation (fixed, B2) — LUMINAIRE SCHEDULE QTY 4 is HEADS, matches S1+S2 exactly: no false alarm, no gap-fill job, the audited 3 poles are never disturbed', (ctx) => {
    if (!have) return ctx.skip();
    const gf = after.cr.evidence!.gapFill!;
    // Before the fix, this compared 4 (schedule QTY, heads) against 3
    // (S1+S2 POLES) and ran two whole-sheet gap-fill searches able to turn
    // the audited 3 poles into 4. Fixed: heads (2+2=4) vs QTY 4 -> no
    // finding at all.
    expect(gf.findings).toEqual([]);
    expect(gf.jobs).toBe(0);
    expect(gf.candidates).toBe(0);
    expect(gf.suggested).toEqual([]);
    expect(gf.errors).toEqual([]);
    expect(row(after.diff, 'site_poles').actual).toBe(3);
    expect(row(after.diff, 'site_heads').actual).toBe(4);
    expect(after.review.some(i => i.id.startsWith('gapfill:') || i.id.startsWith('reconcile:'))).toBe(false);
  });
  it('battery chargers 5 — from Panel B circuits 15-23, the rows as evidence; equipment stops raising zero-count items', (ctx) => {
    if (!have) return ctx.skip();
    expect(row(after.diff, 'battery_chargers').actual).toBe(5);
    const b = after.cr.types.find(t => t.key === 'BATT CHGR')!;
    expect(b.scheduleRows!.map(r => r.cells[0])).toEqual(['15', '17', '19', '21', '23']);
    for (const k of ['WH', 'ALC', 'MINI-TUNE', 'DRINK MACH', 'DF', 'PYLON SIGN', 'DISCON A', 'DISCON B']) {
      expect(after.cr.types.find(t => t.key === k)!.count).toBe(1);
      expect(after.review.find(i => i.id === `count:${k}`)).toBeUndefined();
    }
    // Schedule-owned types were never sent to the counter.
    const counterCalls = after.calls.filter(c => systemText(c).includes('counting symbols on ONE electrical plan sheet'));
    expect(counterCalls.every(c => !/^- BATT CHGR \|/m.test(userText(c)))).toBe(true);
  });
  it('the review list: 46 -> 21 (15 blocking; fix round 3 S19 removed the A-31 question; real-run fix 2 folded LCP into ALC); B6 groups only the 4 non-equipment/non-phone-board legend zeros, honest count above 12', (ctx) => {
    if (!have) return ctx.skip();
    // Fix round B6 — equipment (by category: 1" empty conduit/J-box, the
    // 200A disconnect, T/thermostat, MB, WIREWAY, LCP, DATA CONCENTRATOR)
    // and the phone-board duplex are never grouped, however many
    // legend-zeros otherwise qualify: they're individual $-risk items, so
    // the honest blocking count is reported even though it's now above 12
    // (17, not 9) — nothing here is hidden in a bulk "confirm none" item.
    // S13 adds two more non-blocking spot-check items (Type A: 73 counted,
    // Type B: 52 counted — both above the 20-count threshold), so the
    // total is 23, not 21; the blocking count is unaffected (17).
    // Real-run fix 2 — LCP ("Venstar lighting contactor enclosure … fed
    // from circuit B-25") is another name for ALC (B-25): folded into it
    // with that evidence, no zero item of its own. 22 -> 21, 16 -> 15.
    expect(after.review).toHaveLength(21);
    expect(after.review.filter(reviewItemIsOpen)).toHaveLength(15);
    expect(after.cr.types.find(t => t.key === 'LCP')).toMatchObject({ status: 'merged', mergedInto: 'ALC' });
    expect(after.cr.types.find(t => t.key === 'ALC')!.aliases!.map(a => a.key)).toEqual(['LCP']);
    expect(after.review.find(i => i.id === 'spotcheck:A')).toMatchObject({ blocking: false, title: 'Spot-check: confirm these 5 marks — Type A (73 auto-counted)' });
    expect(after.review.find(i => i.id === 'spotcheck:B')).toMatchObject({ blocking: false, title: 'Spot-check: confirm these 4 marks — Type B (52 auto-counted)' });
    const group = after.review.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group).toBeTruthy();
    expect(group.title).toBe('4 legend items not found on any counted sheet — answer each one');
    expect(group.groupedTypes!.map(g => g.key).sort()).toEqual(['M2', 'N', 'QUADPLEX RECEPTACLE', 'STORE OPEN/CLOSE PUSHBUTTON']);
    const equipmentAndPhoneBoardKeys = [
      '1 EMPTY CONDUIT AND J-BOX TO DECK', '200A FUSED DISCONNECT NEMA 3R', 'DATA CONCENTRATOR',
      'DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX ON PHONE BOARD', 'MB', 'T', 'WIREWAY',
    ];
    for (const key of equipmentAndPhoneBoardKeys) {
      const item = after.review.find(i => i.id === `count:${key}`);
      expect(item, `${key} should be its own individual blocking item, never grouped`).toBeTruthy();
      expect(reviewItemIsOpen(item!)).toBe(true);
    }
    expect(after.review.filter(reviewItemIsOpen).map(i => i.id).sort()).toEqual([
      group.id, 'refsheet:SGN101', 'scope:disconnects', 'scope:power_poles:furnish', 'scope:power_poles:install',
      'unscheduled:GALVANIZED-UNISTRUT-14GA-FIXTURE-SUPPORT-E-3', 'unscheduled:LIGHT-POLE-CONCRETE-BASE-E-7',
      'unscheduled:POLE-CONCRETE-BASE-FOUNDATION-3-0-ABOVE-GRADE-PH0-1',
      ...equipmentAndPhoneBoardKeys.map(k => `count:${k}`),
    ].sort());
    // Fix round B6 — each member of the (now much smaller) group carries
    // its own resolution; the group resolves only once every member has
    // answered, never a single blanket flag.
    let resolvedGroup = group;
    for (const g of group.groupedTypes!) {
      resolvedGroup = applyGroupMemberResolution(resolvedGroup, g.key, { action: 'not_on_job', reason: 'One-line/detail items only, none drawn or scheduled on this job' }, 'Jake');
    }
    expect(resolvedGroup.resolution).toBeTruthy();
    const enforced = enforcedCounts(after.cr, [...after.review.filter(i => i.id !== group.id), resolvedGroup]);
    for (const g of group.groupedTypes!) expect(enforced.byType.get(g.key)).toBeNull();
    // Gone, with the reason: the E-1/E-2 "same area?" pair (1.4), 9 schedule-
    // owned equipment zeros (3.2), the stacked site-light rows and types
    // (3.3), the branch-circuit "fixtures" (3.4), L (W2's photometric count).
    for (const id of ['area:SIMPLEX RECEPTACLE', 'area:DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 'count:BATT CHGR', 'count:WH', 'count:SITE LIGHT',
      'coverage:(UNTAGGED) SITE LIGHT', 'count:L', 'count:EF', 'count:PYLON SIGN']) {
      expect(after.review.find(i => i.id === id)).toBeUndefined();
    }
    expect(after.cr.removedRows.filter(r => /schedule parser/.test(r.reason)).map(r => String(r.row.item))).toEqual(expect.arrayContaining([
      'Lighting branch circuits 20/1 (work, sales, exit/em, restroom)', 'Site lighting branch circuits 20/1',
    ]));
  });
  it('the evidence readers: 15 calls on this set; no gap-fill calls (no real finding on Kissimmee once the false alarm is fixed); every call priced', (ctx) => {
    if (!have) return ctx.skip();
    const ev = after.cr.evidence!;
    expect(ev.calls).toBe(15);
    expect(ev.gapFill!.calls).toBe(0);
    expect(ev.errors).toEqual([]);
    expect(ev.model).toBe(EVIDENCE_MODEL);
    expect(after.cr.sheets.find(s => s.label.startsWith('E-2'))!.viewports!.length).toBe(11);
  });
});

describe('a supplement pass keeps the evidence round\'s results (earlier typicals / tables / held questions carried, never re-read)', () => {
  it('adding an E-9 plan sheet: battery chargers, site poles, typical receptacles and the family merges survive the re-merge', async (ctx) => {
    if (!have) return ctx.skip();
    const first = await run('after');
    const e9 = await buildRasterSet([BLANK_PAGE]);
    const counter = tileCounter(truthFor('after'));
    const ev = evidenceResponder(pageOf);
    const gf = gapFillResponder();
    const { client, calls } = fakeAnthropic(req => (isEvidenceRequest(req) ? ev(req)
      : isGapFillRequest(req) ? gf(req)
      : systemText(req).includes('counting symbols on ONE electrical plan sheet') ? counter(req)
      : (() => { throw new Error('unexpected call'); })()));
    const inv9: InventoryPage = { file: 'e9.pdf', page: 1, sheetNo: 'E-9', title: 'POWER PLAN ADDENDUM', discipline: 'electrical', cls: 'plan', included: true };
    const stage = await runSupplementCounting({
      client, model: COUNTER_MODEL, maxTokens: 32000, agent1: JSON.parse(JSON.stringify(baseline.agent1)),
      inventory: [...(baseline.inventory as InventoryPage[]), inv9], pdfs: new Map([[KISSIMMEE_FILE, pdf], ['e9.pdf', e9]]),
      evidence: { model: EVIDENCE_MODEL, maxTokens: 16000 },
      prior: first.cr, priorInventory: baseline.inventory as InventoryPage[], newFiles: new Set(['e9.pdf']),
    });
    const cr = stage.countResult;
    const d = diffAgainstExpected(expected, cr);
    expect(row(d, 'battery_chargers').actual).toBe(5);
    expect([row(d, 'site_poles').actual, row(d, 'site_heads').actual]).toEqual([3, 4]);
    // Fix round — no gap-fill activity on Kissimmee once the S1/S2 false
    // alarm is fixed (see the 'after' describe block above): the supplement
    // pass carries the same honest 33, GFCI 7+4, unchanged.
    expect(row(d, 'receptacles_total').actual).toBe(row(first.diff, 'receptacles_total').actual);
    expect(row(d, 'receptacles_total').actual).toBe(33);
    expect(row(d, 'gfci').actual).toBe(7 + 4);
    expect(cr.evidence!.gapFill).toMatchObject({ jobs: 0, candidates: 0 });
    expect(cr.types.find(t => t.key === 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE')!.components!.typical).toBe(8);
    // Only the new sheet was read and counted.
    expect(calls.filter(c => isEvidenceRequest(c) === 'viewports').map(c => /SHEET: (E-\d)/.exec(userText(c))![1])).toEqual(['E-9']);
    expect(cr.sheets.find(s => s.label.startsWith('E-2'))!.viewports!.length).toBe(11);
  }, 300_000);
});
