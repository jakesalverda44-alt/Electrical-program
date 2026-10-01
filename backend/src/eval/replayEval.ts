// Accuracy round F2 — the replay eval (pure orchestration; no model, no DB).
// Per job, from a READ-ONLY live export (test/fixtures/realrun/live0930.ts):
//   1. counting: the caller hands in a count result (the live one, or the
//      counting stage replayed on the live marks — replay0930.ts) → the
//      expected-file diff (takeoffEval.diffAgainstExpected);
//   2. rows: Agent 2's stored rows, either as stored ('live' — what the app
//      priced) or with the count projected onto them ('projected' —
//      projectCountsOntoRows, the replay's stand-in for Agent 2 reading the
//      new counts; stated in every table);
//   3. review answers: the export's stored answers (36th), or none;
//   4. generated rows (footage / feeders / box-fitting / site) and the
//      default cost lines through the app's own pure cores, at the export's
//      stage or at a stated override (F2.4: 'due' assumed);
//   5. mapper → priceBid → Accubid recap with the export's library, app
//      settings and bid settings (proposedLinesFromRows, materialAndHoursFrom,
//      previewCostLinesFrom, accubidRecapFrom — what GET /accubid runs).
// Outputs hours by CRM category, by CRM bucket and by BOM group (one
// classifier for both sides: estimating/hoursGroups.ts), material, selling
// price, feeder LF by conductor size, held lines, and the count diff.
import { takeoffRowsFrom, proposedLinesFromRows, resolveLines, parseAgent2Takeoff, type RawTakeoffRow, type BidLineRow } from '../estimating/bidEstimate';
import { computeGeneratedTakeoffRows } from '../estimating/footageAllowanceDb';
import { materialAndHoursFrom, previewCostLinesFrom, accubidRecapFrom, type AccubidSettings, type QuoteRow, type CostLineRow } from '../estimating/accubidBidData';
import { priceBid, type PricedLine } from '../estimating/pricing';
import { projectCountsOntoRows } from '../estimating/reviewAnswers';
import { parseAccubidBom } from '../estimating/accubidBom';
import { classifyBomRow, classifyCrmLine, sumHours, wireGaugeRank, type HoursBreakdown } from '../estimating/hoursGroups';
import { diffAgainstExpected, type EvalDiff, type ExpectedFile } from './takeoffEval';
import type { Library } from '../estimating/library';
import type { CountResult } from '../ai/countingStage';
import type { ReviewItem } from '../ai/reviewItems';
import type { ExistingLineLike } from '../estimating/wiringScopes';
import type { Live0930, LiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import type { FeederEstimateInput } from '../estimating/feederEstimate';

export interface ReplayPricingOptions {
  /** 'live' = Agent 2's rows as stored; 'projected' = the count projected onto them. */
  rows: 'live' | 'projected';
  /** The count to use (default: the export's live count_result). */
  countResult?: CountResult;
  /** Review items (default: the export's stored items, with their answers). */
  reviewItems?: ReviewItem[];
  /** The stage the generated rows and cost-line defaults see (default: the bid's own). */
  stage?: string;
  /** Treat the bid as never seeded with default equipment / GE lines (a
   *  fresh bid): the defaults preview applies (on a pre-submission stage). */
  ignoreCostLineSeeds?: boolean;
  /** Treat the bid as a calibration job (bids.calibration). */
  calibration?: boolean;
  /** What the feeder estimate reads besides the export: the vector sheets'
   *  text runs (as the app's loader extracts them), estimator pins
   *  (est_markups rows; SCRIPTED in tests), and a locate[] stand-in. */
  feeders?: { pins?: FeederEstimateInput['pins']; textSheets?: FeederEstimateInput['textSheets']; locate?: Array<{ node: string; sheetKey: string; x: number; y: number; confidence?: string | null }> };
}

export interface HeldLine { description: string; category: string; qty: number; unit: string; matched: string | null }

export interface ReplayPricing {
  stage: string;
  rowsMode: 'live' | 'projected';
  lines: number;
  material: number;
  hours: number;
  laborFactorMultiplier: number;
  equipment: number;
  generalExpenses: number;
  sellingPrice: number;
  hoursByCategory: Record<string, number>;
  hoursByBucket: Record<string, number>;
  hoursByGroup: Record<string, number>;
  /** Conductor LF on feeder-group lines, by size ("#3/0": 0 …). */
  feederLf: Record<string, number>;
  /** qty > 0, not excluded, 0 material and 0 hours. */
  heldLines: HeldLine[];
  heldCount: number;
  confirmMatchCount: number;
  projectionCorrections?: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function setting(lib: LiveLibrary0930, key: string): string | undefined {
  return lib.appSettings.find(s => s.key === key)?.value;
}

/** The raw agent2_output text the app parses (the export stores it parsed). */
export function agent2RawOf(live: Live0930): string {
  return '```json\n' + JSON.stringify(live.agent2) + '\n```';
}

export async function replayPricing(live: Live0930, lib: LiveLibrary0930, opts: ReplayPricingOptions): Promise<ReplayPricing> {
  const library: Library = lib.library;
  const stage = opts.stage ?? live.bid.stage;
  const baseCount = (opts.countResult ?? live.countResult) as unknown as CountResult;
  const countResult = (opts.feeders?.locate ? { ...baseCount, locate: opts.feeders.locate } : baseCount) as unknown as CountResult;
  const reviewItems = (opts.reviewItems ?? live.reviewItems) as unknown as ReviewItem[];
  const agent2Raw = agent2RawOf(live);
  const itemName = new Map(library.items.map(i => [i.id, i.name]));
  const existing = (live.estBidLines as Array<Record<string, unknown>>).map(l => ({ ...l, qty: Number(l.qty), item_name: l.item_id ? itemName.get(String(l.item_id)) ?? null : null })) as unknown as ExistingLineLike[];

  let projectionCorrections: string[] | undefined;
  // 'projected': the count's totals projected onto Agent 2's rows first; the
  // app path (takeoffRowsFrom → applyReviewAnswers) then runs on those rows.
  const agent2ForPath = opts.rows === 'projected'
    ? (() => {
        const base = parseAgent2Takeoff(agent2Raw);
        const p = projectCountsOntoRows(base, countResult, reviewItems);
        projectionCorrections = p.corrections;
        return '```json\n' + JSON.stringify({ ...live.agent2, takeoff: p.rows }) + '\n```';
      })()
    : agent2Raw;

  const rawRows: RawTakeoffRow[] = await takeoffRowsFrom(
    { agent2Raw: agent2ForPath, agent1Raw: live.agent1, countResult, reviewItems: opts.rows === 'projected' ? [] : reviewItems },
    library,
    args => computeGeneratedTakeoffRows({
      ...args, agent2Raw: args.agent2Raw ?? agent2ForPath,
      settings: {
        footageRatios: setting(lib, 'est_footage_ratios'), dropFt: setting(lib, 'est_default_drop_ft'),
        slackPct: setting(lib, 'est_default_slack_pct'), boxFitting: setting(lib, 'est_box_fitting_allowance'),
      },
      bid: { sq_ft: live.bid.sq_ft, stage, calibration: opts.calibration ?? false },
      existing,
      scales: live.estSheets as never, pins: live.panelPins as never,
      feeders: {
        pins: [...(live.panelPins as never[]), ...(opts.feeders?.pins ?? [])] as FeederEstimateInput['pins'],
        textSheets: opts.feeders?.textSheets ?? [],
        settingsRaw: setting(lib, 'est_feeder_estimate'), deckFt: null,
      },
    }),
  );
  const { lines } = proposedLinesFromRows(rawRows, library);
  const ctx = live.pricingContext;
  const mh = materialAndHoursFrom(lines, library, ctx.bidSettings as never, ctx.fixturePackageQuoted);
  const costLines = previewCostLinesFrom({
    stage, calibration: opts.calibration ?? false, seededKinds: opts.ignoreCostLineSeeds ? [] : live.costLineSeeds.map(s => s.kind), rulesRaw: setting(lib, 'est_cost_line_defaults'),
    hours: mh.hours, costLines: ctx.costLines as unknown as CostLineRow[],
  });
  const { recap } = accubidRecapFrom({
    settings: ctx.accubidSettings as unknown as AccubidSettings, material: mh.material, hours: mh.hours,
    quotes: ctx.quotes as unknown as QuoteRow[], costLines,
  });

  // Per-line breakdown (same resolve + neutral priceBid the totals used).
  const priced = priceBid(resolveLines(lines, library, { fixturePackageQuoted: ctx.fixturePackageQuoted }), {
    laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1,
  }, []);
  const nameOf = (l: BidLineRow) => (l.item_id ? itemName.get(l.item_id) : l.assembly_id ? library.assemblies.find(a => a.id === l.assembly_id)?.name : null) ?? null;
  const rows = priced.lines.map((p, i) => ({ p, l: lines[i] }));
  const live2 = rows.filter(x => !x.p.excluded);
  const mult = mh.laborFactorMultiplier;
  const byCat: Record<string, number> = {};
  for (const { p } of live2) byCat[p.category] = (byCat[p.category] ?? 0) + p.hoursExt * mult;
  const cls = sumHours(live2, x => x.p.hoursExt * mult, x => classifyCrmLine({ category: x.p.category, description: x.p.description, matchedName: nameOf(x.l) }));
  const feederLf: Record<string, number> = {};
  for (const { p, l } of live2) {
    const text = `${p.description} ${nameOf(l) ?? ''}`;
    if (classifyCrmLine({ category: p.category, description: p.description, matchedName: nameOf(l) }).group !== 'feeders') continue;
    if (String(p.unit).toUpperCase() !== 'LF' || /conduit|emt|pvc/i.test(text)) continue;
    const rank = wireGaugeRank(text);
    if (rank == null) continue;
    const label = rank > 0 ? `#${rank}/0` : `#${-rank}`;
    feederLf[label] = (feederLf[label] ?? 0) + p.qty;
  }
  const held: HeldLine[] = live2.filter(({ p }) => p.qty > 0 && p.materialExt === 0 && p.hoursExt === 0)
    .map(({ p, l }) => ({ description: p.description, category: p.category, qty: p.qty, unit: String(p.unit), matched: nameOf(l) }));
  const equipment = costLines.filter(c => c.kind === 'equipment').reduce((s, c) => s + c.amount, 0);
  const generalExpenses = costLines.filter(c => c.kind === 'general_expense').reduce((s, c) => s + c.amount, 0);
  return {
    stage, rowsMode: opts.rows, lines: lines.length,
    material: r2(mh.material), hours: Math.round(mh.hours * 10000) / 10000, laborFactorMultiplier: mult,
    equipment, generalExpenses, sellingPrice: recap.sellingPrice,
    hoursByCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, r2(v)])),
    hoursByBucket: cls.byBucket, hoursByGroup: cls.byGroup, feederLf,
    heldLines: held, heldCount: held.length, confirmMatchCount: priced.warnings.confirmMatchCount,
    ...(projectionCorrections ? { projectionCorrections } : {}),
  };
}

/** Chris's hours from his Accubid BOM text, through the same classifier. */
export function chrisHours(bomText: string, extraExterior: RegExp[] = []): HoursBreakdown & { footer: number | null } {
  const bom = parseAccubidBom(bomText);
  const h = sumHours(bom.rows, r => r.totalFieldLaborHours ?? 0, r => classifyBomRow(r, extraExterior));
  return { ...h, footer: bom.footerLaborHours };
}

export function countDiff(expected: ExpectedFile, countResult: CountResult | null): EvalDiff {
  return diffAgainstExpected(expected, countResult);
}

export type { PricedLine };
