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
import { evidenceResponder, isEvidenceRequest, E2_HOST_MARKS, E1_RESTROOM_REPEATS, gapFillResponder, isGapFillRequest } from './fixtures/evidence/kissimmeeReplies';
import { fakeAnthropic, systemText, userText, type FakeRequest, type FakeReply } from './fixtures/takeoff/fakeAnthropic';
import { screenPosition } from '../estimating/pageGeometry';
import { planCountTiles } from '../ai/countRender';
import { counterTileSpec } from '../ai/modelLimits';
import { runCountingStage, runSupplementCounting, type CountResult } from '../ai/countingStage';
import { buildReviewItems, referencedSheetItems, reviewItemIsOpen, enforcedCounts, type ReviewItem } from '../ai/reviewItems';
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

type Sym = { type: string; x: number; y: number };

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
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) marks.push([s.type, id, Number(nx.toFixed(4)), Number(ny.toFixed(4))]);
      }
    }
    return { text: JSON.stringify({ marks, unreadable: [], notes: [] }), usage: { input_tokens: 25000, output_tokens: 1800 } };
  };
}

function truthFor(mode: 'before' | 'after') {
  const m = new Map<string, { geom: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number }; symbols: Sym[] }>();
  for (const s of baseline.sheets) {
    const symbols: Sym[] = baseline.marks.filter(x => x.sheetKey === s.key).map(x => ({ type: x.typeKey, x: x.x, y: x.y }));
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
    // The HONEST traceable receptacle count (fix round): drawn + typicals,
    // without anything gap-fill added — SIMPLEX 9+1, DUPLEX 4+8, GFCI 7
    // (1 main + 6 restroom plan), WP GFI 4 = 33.
    const gapAdded = ['SIMPLEX RECEPTACLE', 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 'GFCI', 'WP GFI']
      .reduce((sum, k) => sum + ((t(k).components as { gapfill?: number } | undefined)?.gapfill ?? 0), 0);
    expect(row(after.diff, 'receptacles_total').actual! - gapAdded).toBe(33);
    expect(t('GFCI').count - ((t('GFCI').components as { gapfill?: number }).gapfill ?? 0)).toBe(7);
    // 4.4/4.3 — gap-fill's targeted re-search found 5 more GFCIs (the
    // documented undercount on the sheet's west portion, which this fixture
    // has no crop of); the crop check accepted all 5, never gap-fill's own
    // proposal directly. GFCI is now exactly the audited 16 (7+4 -> 12+4).
    expect(t('GFCI').count).toBe(12);
    expect(t('GFCI').components).toMatchObject({ drawn: 7, typical: 0, schedule: 0, gapfill: 5 });
    expect(t('GFCI').gapFill).toHaveLength(5);
    expect(t('GFCI').gapFill!.every(g => g.reason.includes('undercount risk') && g.note.includes('confirmed GFCI example'))).toBe(true);
    expect(t('WP GFI').count).toBe(4);
    expect(row(after.diff, 'gfci').actual).toBe(16);
    expect(row(after.diff, 'receptacles_total').actual).toBe(33 + gapAdded);
    // The typicals: 5 pole types and the coil+J boxes, each with its quote.
    const exp = after.cr.evidence!.expansions.filter(e => e.status === 'expanded');
    expect(exp.map(e => [e.host, e.hostCount, e.perHost, e.expanded])).toEqual(expect.arrayContaining([
      ['Office area power pole', 1, 2, 2], ['Checkout counter power pole', 1, 1, 1], ['Parts pod power pole', 2, 1, 2],
      ['Test station power pole', 1, 1, 1], ['Test station power pole', 1, 1, 1], ['Commercial counter power pole', 1, 2, 2],
    ]));
    expect(after.cr.evidence!.expansions.filter(e => e.status === 'assembly').map(e => [e.host, e.hostCount])).toEqual([['Junction box with 6\'-0" flex conduit at wall & H.P. counters', 3]]);
    // Fix round S3: E-1's "duplex outlet at deck" (A-31) sits over the
    // checkout pole (A-29) once the sheets are aligned — asked, never
    // subtracted silently. S2: the office pole's unstated floor simplex
    // outlets are drawn near it (#11), so that item is information.
    expect(after.review.find(i => i.id.startsWith('typicalat:') && i.id.includes('@9#2'))).toMatchObject({ kind: 'area', keepQty: 12, sumQty: 11 });
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
  it('4.2 reconciliation — LUMINAIRE SCHEDULE QTY 4 vs S1+S2 = 3 is a real finding; gap-fill honestly finds nothing there, so the audited 3 is never disturbed', (ctx) => {
    if (!have) return ctx.skip();
    const gf = after.cr.evidence!.gapFill!;
    const poleFinding = gf.findings.find(f => f.kind === 'schedule_qty');
    expect(poleFinding).toMatchObject({ typeKey: 'S1+S2', expected: 4, actual: 3, shortfall: 1 });
    expect(gf.findings.filter(f => f.kind === 'gfci_confirm').map(f => f.typeKey).sort()).toEqual(['GFCI', 'WP GFI']);
    // Only the GFCI job actually found (and had accepted) anything.
    expect(gf.candidates).toBe(5);
    expect(gf.accepted).toBe(5);
    expect(gf.errors).toEqual([]);
    expect(row(after.diff, 'site_poles').actual).toBe(3);
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
  it('the review list: 46 -> 13 (9 blocking); 4.5 groups the 12 legend-only zeros into one item', (ctx) => {
    if (!have) return ctx.skip();
    expect(after.review).toHaveLength(13);
    expect(after.review.filter(reviewItemIsOpen)).toHaveLength(9);
    const group = after.review.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group).toBeTruthy();
    expect(group.title).toBe('12 legend items not found on any counted sheet — confirm none on this job');
    expect(group.groupedTypes!.map(g => g.key).sort()).toEqual([
      '1 EMPTY CONDUIT AND J-BOX TO DECK', '200A FUSED DISCONNECT NEMA 3R', 'DATA CONCENTRATOR',
      'DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX ON PHONE BOARD', 'LCP', 'M2', 'MB', 'N',
      'QUADPLEX RECEPTACLE', 'STORE OPEN/CLOSE PUSHBUTTON', 'T', 'WIREWAY',
    ]);
    expect(after.review.filter(reviewItemIsOpen).map(i => i.id).sort()).toEqual([
      group.id, after.review.find(i => i.id.startsWith('typicalat:'))!.id, 'refsheet:SGN101', 'scope:disconnects', 'scope:power_poles:furnish', 'scope:power_poles:install',
      'unscheduled:GALVANIZED-UNISTRUT-14GA-FIXTURE-SUPPORT-E-3', 'unscheduled:LIGHT-POLE-CONCRETE-BASE-E-7',
      'unscheduled:POLE-CONCRETE-BASE-FOUNDATION-3-0-ABOVE-GRADE-PH0-1',
    ].sort());
    // Resolving the group in one motion zeroes every member (never a silent drop).
    const resolved = { ...group, resolution: { action: 'not_on_job' as const, reason: 'One-line/detail items only, none drawn or scheduled on this job', by: 'Jake', at: 't' } };
    const enforced = enforcedCounts(after.cr, [...after.review.filter(i => i.id !== group.id), resolved]);
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
  it('the evidence readers: 15 calls on this set, plus 5 gap-fill / crop-check calls (Part 4); every call priced', (ctx) => {
    if (!have) return ctx.skip();
    const ev = after.cr.evidence!;
    // 15 viewport/typicals/table calls + 5 gap-fill calls: GFCI (1 gapfill +
    // 1 crop-check), WP GFI (1 gapfill, no candidates so no crop-check), S1
    // and S2 (1 gapfill each, no candidates) = 5.
    expect(ev.calls).toBe(20);
    expect(ev.gapFill!.calls).toBe(5);
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
    // 42, not 37: the first ('after') pass's own gap-fill already found and
    // accepted the 5 GFCIs (carried in `first.cr`, this supplement's prior).
    expect(row(d, 'receptacles_total').actual).toBe(row(first.diff, 'receptacles_total').actual);
    expect(row(d, 'gfci').actual).toBe(16);
    expect(cr.types.find(t => t.key === 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE')!.components!.typical).toBe(8);
    // Only the new sheet was read and counted.
    expect(calls.filter(c => isEvidenceRequest(c) === 'viewports').map(c => /SHEET: (E-\d)/.exec(userText(c))![1])).toEqual(['E-9']);
    expect(cr.sheets.find(s => s.label.startsWith('E-2'))!.viewports!.length).toBe(11);
  }, 300_000);
});
