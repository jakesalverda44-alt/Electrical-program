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
import { takeoffRowsFrom, proposedLinesFromRows, resolveLines, parseAgent2Takeoff, type RawTakeoffRow, type BidLineRow, type ResolveOptions } from '../estimating/bidEstimate';
import { computeGeneratedTakeoffRows } from '../estimating/footageAllowanceDb';
import { materialAndHoursFrom, previewCostLinesFrom, accubidRecapFrom, costLineContextOfLines, fixturePackageQuestionFor, type AccubidSettings, type QuoteRow, type CostLineRow, type FixturePackageQuestion } from '../estimating/accubidBidData';
import { priceBid, type PricedLine } from '../estimating/pricing';
import { noteKindOfEvidence } from '../estimating/equipmentConnection';
import { DEFAULT_COST_LINE_DEFAULTS, COST_LINE_DEFAULTS_V2, COST_LINE_DEFAULTS_V2_OXBLUE, isEstimatingBid, oxblueSupportQuote } from '../estimating/costLineDefaults';
import { projectCountsOntoRows } from '../estimating/reviewAnswers';
import { parseAccubidBom } from '../estimating/accubidBom';
import { classifyBomRow, classifyCrmLine, sumHours, wireGaugeRank, type HoursBreakdown } from '../estimating/hoursGroups';
import { diffAgainstExpected, type EvalDiff, type ExpectedFile, type LinearFeet } from './takeoffEval';
import type { Library } from '../estimating/library';
import { SEED_ITEMS, SEED_ASSEMBLIES } from '../estimating/seed/laborUnits';
import { ALIAS_ONLY_CODE_RE } from '../estimating/mapper';
import type { CountResult } from '../ai/countingStage';
import type { ReviewItem } from '../ai/reviewItems';
import type { ExistingLineLike } from '../estimating/wiringScopes';
import type { Live0930, LiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import type { FeederEstimateInput } from '../estimating/feederEstimate';
import { applyScopeAnswers, type AccountTermsSnapshot, type ScopeAnswer } from '../bidstd/accountRules';
import { decideOwnerFurnished } from '../estimating/ownerFurnished';
import { applyGapMigrations, GAP_INSERT_CODES } from './gapMigrations';
import { libraryAsOf } from '../estimating/libraryAsOf';

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
  /** Price against the exported library exactly (the baseline); default =
   *  the library after this round's migrations (libraryAfterMigrations). */
  libraryAsIs?: boolean;
  /** Include per-line detail (D0 / tests). */
  detail?: boolean;
  /** Treat the bid as a calibration job (bids.calibration). */
  calibration?: boolean;
  /** What the feeder estimate reads besides the export: the vector sheets'
   *  text runs (as the app's loader extracts them), estimator pins
   *  (est_markups rows; SCRIPTED in tests), and a locate[] stand-in. */
  feeders?: { pins?: FeederEstimateInput['pins']; textSheets?: FeederEstimateInput['textSheets']; locate?: Array<{ node: string; sheetKey: string; x: number; y: number; confidence?: string | null }> };
  // ── Gap-closing T0 — the "SCRIPTED answers" scenario (additive) ──
  /** The account-terms snapshot the run would carry (resolveAccountTerms over the account-rule fixture +
   *  agent1.furnishStatements: the exports have no takeoff_results.account_terms). */
  accountTerms?: AccountTermsSnapshot;
  /** Scope answers (scope:<term>[:<half>] → answer), as applyScopeAnswers reads them. */
  scopeAnswers?: Record<string, string | ScopeAnswer>;
  /** The estimator's answer to "is this quote the fixture package?" per quote id (true = yes, false = decided no). */
  quoteFixturePackage?: Record<string, boolean>;
  /** SCRIPTED count answers: the Agent 2 row whose item matches `item` (a regex, exactly one row) takes `qty`,
   *  with the quote in its evidence — the way projectCountsOntoRows lays a count onto a row. */
  answers?: ScriptedAnswer[];
}

export interface ScriptedAnswer { item: string; qty: number; sheet: string; quote: string }

/** Gap-closing T0 — lays SCRIPTED count answers onto Agent 2's rows (raw agent2 text in, raw text out). */
export function applyScriptedAnswers(agent2Raw: string, answers: ScriptedAnswer[]): string {
  const rows = parseAgent2Takeoff(agent2Raw) as unknown as Array<Record<string, unknown>>;
  const parsed = JSON.parse(/```(?:json)?\s*([\s\S]*?)```/i.exec(agent2Raw)?.[1] ?? agent2Raw) as Record<string, unknown>;
  for (const a of answers) {
    const re = new RegExp(a.item, 'i');
    const hits = rows.filter(r => re.test(String(r.item ?? '')));
    if (hits.length !== 1) throw new Error(`SCRIPTED answer "${a.item}" matches ${hits.length} Agent 2 rows (needs exactly 1)`);
    const r = hits[0];
    r.evidence = `Takeoff review answer (SCRIPTED): ${Number(r.qty) || 0} → ${a.qty} — ${a.sheet} "${a.quote}"`;
    r.qty = a.qty;
    r.spec = String(r.spec ?? '').replace(/COUNT PENDING ESTIMATOR REVIEW[^;]*/i, '').trim() || String(r.item);
  }
  return '```json\n' + JSON.stringify({ ...parsed, takeoff: rows }) + '\n```';
}

export interface HeldLine { description: string; category: string; qty: number; unit: string; matched: string | null; reason?: string }

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
  /** C8 — raceway LF by size + kind over every priced LF line ("1\" PVC", "2\" EMT"). */
  conduitLf?: Record<string, number>;
  /** qty > 0, not excluded, 0 material and 0 hours. */
  heldLines: HeldLine[];
  heldCount: number;
  confirmMatchCount: number;
  notes?: Array<{ description: string; qty: number; kind: string }>;
  noteCount?: number;
  /** Per line (takeoff key, description, qty, hours, material, note / hold) — not written to the baseline. */
  lineDetail?: Array<{ key: string | null; category: string; description: string; qty: number; unit: string; hours: number; material: number; note: string | null; hold: string | null; matched: string | null; excluded: boolean; furnish?: string }>;
  /** Gap-closing T2 — owner-furnished / disputed totals (the app's warnings). */
  ownerFurnished?: { lineCount: number; materialRemoved: number };
  furnishDisputed?: { lineCount: number; terms: string[] };
  /** Gap-closing T3 — the "is this quote the fixture package?" prompt, when it would show. */
  fixturePackageQuestion?: FixturePackageQuestion;
  projectionCorrections?: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function setting(lib: LiveLibrary0930, key: string): string | undefined {
  return lib.appSettings.find(s => s.key === key)?.value;
}

/** An app setting as this round's migration 159 leaves it (the untouched v1
 *  cost-line defaults become v2). */
function settingAfterMigrations(lib: LiveLibrary0930, key: string): string | undefined {
  const v = setting(lib, key);
  // 159 moved the untouched v1 to v2; gap-closing 168 adds the OxBlue line to the untouched v2 (J13).
  if (key === 'est_cost_line_defaults' && (v == null || JSON.stringify(JSON.parse(v)) === JSON.stringify(DEFAULT_COST_LINE_DEFAULTS) || JSON.stringify(JSON.parse(v)) === JSON.stringify(COST_LINE_DEFAULTS_V2))) return JSON.stringify(COST_LINE_DEFAULTS_V2_OXBLUE);
  // Gap-closing migration 168 — inserted when absent (J9 approved: true).
  if (key === 'est_receptacle_device_only' && v == null) return 'true';
  // Gap-closing migration 168 (J10) — the untouched migration-150 footage ratios move to the luminaire basis; the
  // box / fitting setting (absent = defaults) is inserted with the per-luminaire MC connector driver.
  if (key === 'est_footage_ratios' && v != null && JSON.stringify(JSON.parse(v)) === JSON.stringify(JSON.parse(FOOTAGE_RATIOS_150))) return JSON.stringify({ ...JSON.parse(v), ...FOOTAGE_RATIOS_168_PATCH });
  if (key === 'est_box_fitting_allowance' && v == null) return JSON.stringify(BOX_FITTING_168);
  return v;
}

/** Migration 150's seeded est_footage_ratios (the "untouched" value 168 moves) and 168's patches — mirrored here
 *  and checked against the SQL by gapMigrations.test.ts. */
export const FOOTAGE_RATIOS_150 = '{"version":1,"emtPerPoint":{"fixture":6.6,"device":6.6,"equipment":6.6},"mcPerFixture":7.89,"wirePerConduitFt":5.54,"baseConductors":3,"wire10Share":0.47,"pvcSitePerPole":130,"v2DisagreePct":40,"pointsPerCircuit":8,"items":{"emt":"3/4\\" EMT (incl. couplings/straps)","wire12":"#12 THHN/THWN copper conductor","wire10":"#10 THHN/THWN copper conductor","mc":"12/2 MC cable","pvcSite":"1\\" PVC Sch 40 (incl. fittings/glue)"},"calibratedOn":"5 of Chris\'s jobs","looErrorPct":{"emt":35,"mc":22,"wire":37,"pvcSite":130}}';
export const FOOTAGE_RATIOS_168_PATCH = { mcBasis: 'luminaire', mcPerLuminaire: 13.3, mcLuminaireSource: 'Chris 2026 jobs (Kissimmee 13.49, 36th 13.02 ft per luminaire)' } as const;
export const BOX_FITTING_168 = { version: 1, mcConnectorBasis: 'luminaire' } as const;

/** The raw agent2_output text the app parses (the export stores it parsed). */
/** Fix round S7 — a line that prices at $0 with nothing saying why. `holds` (pricing.ts) is DEFINED as every
 *  qty > 0, $0, 0 h, non-note line, so "not a hold" can never find anything; the question that can fail is
 *  whether each hold's reason is SPECIFIC. A line is silent when it is a $0 line with a qty and
 *   - no reason at all, or
 *   - the generic `no_unit` fallback although it is a generated row (feeder / site / allowance rows say what
 *     they need) or although it matched a library item (a matched $0 line is a data problem, not "no unit"). */
export const GENERATED_KEY_RE = /\|\|(?:Feeder — |Tap — |Polaris taps|#6 ground lugs|Lighting control data cable|Underground PVC labor adjustment|MEASURE FEEDER|Site lighting circuits|Pole |Trenching|NEEDS FOOTAGE|Branch (?:conduit|wire) allowance|Fixture whip allowance|Site lighting conduit allowance)/;
export function silentZeroLines(detail: NonNullable<ReplayPricing['lineDetail']>): string[] {
  return detail.filter(l => !l.excluded && l.qty > 0 && l.hours === 0 && l.material === 0 && !l.note
    && (!l.hold || (l.hold === 'no_unit' && (!!l.matched || GENERATED_KEY_RE.test(l.key ?? ''))))).map(l => `${l.description} [${l.hold ?? 'no reason'}]`);
}

export function agent2RawOf(live: Live0930): string {
  return '```json\n' + JSON.stringify(live.agent2) + '\n```';
}

/** The live library as the round's migrations leave it (158: Chris's new
 *  units + Jake's decision-1 labor moves + aliases), applied the way the SQL
 *  does — only an untouched seed row moves, inserts never overwrite. */
export function libraryAfterMigrations(lib: Library): Library {
  const items = lib.items.map(i => ({ ...i, aliases: [...(i.aliases ?? [])] }));
  const byCode = new Map(items.map(i => [i.code, i]));
  // Fix round B1/B2: no generic site pole / fixture heads aliases — a row reaches
  // LTG-POLE / LTG-POLEHEAD only through decideRows (gated on isEstimatingBid), and
  // the migration strips them from a DB that applied the first draft of 158.
  for (const [code, drop] of [['LTG-POLE', ['site pole', 'pole (site lighting)']], ['LTG-POLEHEAD', ['fixture heads', 'pole top fixture head']]] as const) {
    const it = byCode.get(code);
    if (it && it.source === 'seed') it.aliases = it.aliases.filter(a => !(drop as readonly string[]).includes(a));
  }
  for (const s of SEED_ITEMS.filter(x => ALIAS_ONLY_CODE_RE.test(x.code) && !byCode.has(x.code) && !GAP_INSERT_CODES.includes(x.code))) {  // 158 only (165 is gapMigrations.ts)
    const it = { id: `mig158-${s.code}`, code: s.code, name: s.name, category: s.category, unit: s.unit, material_cost: s.materialCost, material_price_date: null, labor_hours: s.laborHours, aliases: s.aliases, source: 'seed', active: true } as unknown as Library['items'][number];
    items.push(it); byCode.set(s.code, it);
  }
  const assemblies = [...lib.assemblies];
  for (const a of SEED_ASSEMBLIES.filter(x => ALIAS_ONLY_CODE_RE.test(x.code) && !lib.assemblies.some(y => y.code === x.code))) {
    assemblies.push({ id: `mig158-${a.code}`, code: a.code, name: a.name, category: a.category, unit: a.unit as never, aliases: a.aliases, source: 'seed', active: true,
      components: a.components.map(c => ({ item_id: byCode.get(c.itemCode)!.id, item_code: c.itemCode, item_name: byCode.get(c.itemCode)!.name, qty_per: c.qtyPer })) });
  }
  return { ...lib, items, assemblies };
}

export async function replayPricing(live: Live0930, lib: LiveLibrary0930, opts: ReplayPricingOptions): Promise<ReplayPricing> {
  const stage = opts.stage ?? live.bid.stage;
  // Gap-closing T1 — Jake's pricing policy, as the app applies it (getLibraryForBid): a bid being estimated
  // prices against the library after this round's migrations (165–167); any other bid against the library AS OF
  // its submission (libraryAsOf over migration 164's history: the export predates the round's migrations).
  const library: Library = opts.libraryAsIs ? lib.library : (() => {
    const gap = applyGapMigrations(libraryAfterMigrations(lib.library));
    return isEstimatingBid({ stage, calibration: opts.calibration ?? false }) ? gap.library : libraryAsOf(gap.library, gap.history, live.exportedAt);
  })();
  const baseCount = (opts.countResult ?? live.countResult) as unknown as CountResult;
  const countResult = (opts.feeders?.locate ? { ...baseCount, locate: opts.feeders.locate } : baseCount) as unknown as CountResult;
  const reviewItems = (opts.reviewItems ?? live.reviewItems) as unknown as ReviewItem[];
  const agent2Raw = agent2RawOf(live);
  const itemName = new Map(library.items.map(i => [i.id, i.name]));
  const existing = (live.estBidLines as Array<Record<string, unknown>>).map(l => ({ ...l, qty: Number(l.qty), item_name: l.item_id ? itemName.get(String(l.item_id)) ?? null : null })) as unknown as ExistingLineLike[];

  let projectionCorrections: string[] | undefined;
  // 'projected': the count's totals projected onto Agent 2's rows first; the
  // app path (takeoffRowsFrom → applyReviewAnswers) then runs on those rows.
  const agent2ForPath0 = opts.rows === 'projected'
    ? (() => {
        const base = parseAgent2Takeoff(agent2Raw);
        const p = projectCountsOntoRows(base, countResult, reviewItems);
        projectionCorrections = p.corrections;
        // Stand-in for Agent 2 re-reading the replayed count (R merged): a row whose type the replayed count merged into
        // another (SITE LIGHT into S1/S2) or no longer finds (PP-1..6: 0 of the 6) is not carried at its stale live qty.
        const liveTypes = new Map((live.countResult.types as unknown as Array<{ key: string; count: number; status: string }>).map(t => [t.key, t]));
        const gone = new Set((countResult.types as unknown as Array<{ key: string; count: number; status: string }>)
          .filter(t => { const l = liveTypes.get(t.key); return !!l && l.count > 0 && (t.status === 'merged' || t.count === 0); }).map(t => t.key));
        const typeOf = (r: Record<string, unknown>) => String(r.countType ?? /countType:\s*([^;]+?)\s*(?:;|$)/.exec(String(r.notes ?? ''))?.[1] ?? '');
        const rows = (p.rows as unknown as Array<Record<string, unknown>>).map(r => (gone.has(typeOf(r)) ? { ...r, qty: 0, spec: 'COUNT PENDING ESTIMATOR REVIEW (the replayed count merged / did not find this type)' } : r));
        return '```json\n' + JSON.stringify({ ...live.agent2, takeoff: rows }) + '\n```';
      })()
    : agent2Raw;
  const agent2ForPath = opts.answers?.length ? applyScriptedAnswers(agent2ForPath0, opts.answers) : agent2ForPath0;

  const rawRows: RawTakeoffRow[] = await takeoffRowsFrom(
    { agent2Raw: agent2ForPath, agent1Raw: live.agent1, countResult, reviewItems: opts.rows === 'projected' ? [] : reviewItems, priced: isEstimatingBid({ stage, calibration: opts.calibration ?? false }),
      receptacleDeviceOnly: !opts.libraryAsIs && settingAfterMigrations(lib, 'est_receptacle_device_only') === 'true' },
    library,
    args => computeGeneratedTakeoffRows({
      ...args, agent2Raw: args.agent2Raw ?? agent2ForPath,
      settings: {
        footageRatios: opts.libraryAsIs ? setting(lib, 'est_footage_ratios') : settingAfterMigrations(lib, 'est_footage_ratios'), dropFt: setting(lib, 'est_default_drop_ft'),
        slackPct: setting(lib, 'est_default_slack_pct'), boxFitting: opts.libraryAsIs ? setting(lib, 'est_box_fitting_allowance') : settingAfterMigrations(lib, 'est_box_fitting_allowance'),
      },
      bid: { sq_ft: live.bid.sq_ft, stage, calibration: opts.calibration ?? false, build_type: live.bid.build_type ?? null },
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
  // Gap-closing T0 — the SCRIPTED "is this quote the fixture package?" answers (quote id → yes / no).
  const ctx = opts.quoteFixturePackage ? (() => {
    const qf = opts.quoteFixturePackage!;
    const quotes = (live.pricingContext.quotes as Array<Record<string, unknown>>).map(q => (String(q.id) in qf ? { ...q, fixturePackage: qf[String(q.id)], fixturePackageDecided: true } : q));
    return { ...live.pricingContext, quotes: quotes as typeof live.pricingContext.quotes, fixturePackageQuoted: live.pricingContext.fixturePackageQuoted || quotes.some(q => q.fixturePackage === true) };
  })() : live.pricingContext;
  // Gap-closing T2 — the owner-furnished decisions, built the way resolveOptionsForBid builds them (estimating bids only).
  const resolveOpts: ResolveOptions = { fixturePackageQuoted: ctx.fixturePackageQuoted };
  if (opts.accountTerms && isEstimatingBid({ stage, calibration: opts.calibration ?? false })) {
    const estimatorTerms = applyScopeAnswers(opts.accountTerms, opts.scopeAnswers ?? {}).filter(t => t.source === 'estimator');
    resolveOpts.ownerFurnished = decideOwnerFurnished(opts.accountTerms, { estimatorTerms });
  }
  const mh = materialAndHoursFrom(lines, library, ctx.bidSettings as never, resolveOpts);
  const costLines = previewCostLinesFrom({
    stage, calibration: opts.calibration ?? false, seededKinds: opts.ignoreCostLineSeeds ? [] : live.costLineSeeds.map(s => s.kind), rulesRaw: opts.libraryAsIs ? setting(lib, 'est_cost_line_defaults') : settingAfterMigrations(lib, 'est_cost_line_defaults'),
    hours: mh.hours, costLines: ctx.costLines as unknown as CostLineRow[],
    context: { ...costLineContextOfLines(lines, library, live.bid.build_type ?? null), oxblueSupport: opts.libraryAsIs ? null : oxblueSupportQuote(live.agent1) },
  });
  const { recap } = accubidRecapFrom({
    settings: ctx.accubidSettings as unknown as AccubidSettings, material: mh.material, hours: mh.hours,
    quotes: ctx.quotes as unknown as QuoteRow[], costLines,
  });

  // Per-line breakdown (same resolve + neutral priceBid the totals used).
  const priced = priceBid(resolveLines(lines, library, resolveOpts), {
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
    // Feeder / service / site conductors: the feeder group, or any line in
    // the Feeders or Site / Underground buckets (a service lateral is site work).
    const c = classifyCrmLine({ category: p.category, description: p.description, matchedName: nameOf(l) });
    if (c.group !== 'feeders' && c.bucket !== 'Feeders' && c.bucket !== 'Site / Underground') continue;
    if (String(p.unit).toUpperCase() !== 'LF' || /conduit|emt|pvc/i.test(text)) continue;
    const rank = wireGaugeRank(text);
    if (rank == null) continue;
    const label = rank > 0 ? `#${rank}/0` : `#${-rank}`;
    feederLf[label] = (feederLf[label] ?? 0) + p.qty;
  }
  const conduitLf: Record<string, number> = {};
  for (const { p } of live2) {
    const m = /^((?:\d+-)?\d+(?:\/\d+)?")\s+(EMT|PVC)\b/i.exec(p.description);
    if (!m || String(p.unit).toUpperCase() !== 'LF') continue;
    const k = `${m[1]} ${m[2].toUpperCase()}`;
    conduitLf[k] = (conduitLf[k] ?? 0) + p.qty;
  }
  // Holds = the app's own D5 list when the code has it; the baseline (pre-D5
  // code) counted every qty > 0 line at $0 / 0 h the same way.
  const appHolds = (priced.warnings as { holds?: Array<{ id: string; reason: string }> }).holds;
  const holdReason = new Map((appHolds ?? []).map(h => [h.id, h.reason]));
  const held: HeldLine[] = live2.filter(({ p }) => (appHolds ? holdReason.has(p.id) : p.qty > 0 && p.materialExt === 0 && p.hoursExt === 0))
    .map(({ p, l }) => ({ description: p.description, category: p.category, qty: p.qty, unit: String(p.unit), matched: nameOf(l), ...(holdReason.has(p.id) ? { reason: holdReason.get(p.id) } : {}) }));
  const notes = live2.filter(({ l }) => !!noteKindOfEvidence(l.evidence_note)).map(({ p, l }) => ({ description: p.description, qty: p.qty, kind: noteKindOfEvidence(l.evidence_note)! }));
  const equipment = costLines.filter(c => c.kind === 'equipment').reduce((s, c) => s + c.amount, 0);
  const generalExpenses = costLines.filter(c => c.kind === 'general_expense').reduce((s, c) => s + c.amount, 0);
  return {
    stage, rowsMode: opts.rows, lines: lines.length,
    material: r2(mh.material), hours: Math.round(mh.hours * 10000) / 10000, laborFactorMultiplier: mult,
    equipment, generalExpenses, sellingPrice: recap.sellingPrice,
    hoursByCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, r2(v)])),
    hoursByBucket: cls.byBucket, hoursByGroup: cls.byGroup, feederLf, ...(appHolds ? { conduitLf } : {}),
    heldLines: held, heldCount: held.length, confirmMatchCount: priced.warnings.confirmMatchCount,
    ...(priced.warnings.ownerFurnished ? { ownerFurnished: priced.warnings.ownerFurnished } : {}),
    ...((): { fixturePackageQuestion?: FixturePackageQuestion } => { const q = fixturePackageQuestionFor(ctx.quotes as unknown as QuoteRow[], mh.fixtureMaterial); return q ? { fixturePackageQuestion: q } : {}; })(),
    ...(priced.warnings.furnishDisputed ? { furnishDisputed: priced.warnings.furnishDisputed } : {}),
    ...(appHolds ? { notes, noteCount: notes.length } : {}),
    ...(opts.detail ? { lineDetail: rows.map(({ p, l }) => ({ key: l.takeoff_key ?? null, category: p.category, description: p.description, qty: p.qty, unit: String(p.unit), hours: p.hoursExt * mult, material: p.materialExt, note: noteKindOfEvidence(l.evidence_note), hold: holdReason.get(p.id) ?? null, matched: nameOf(l), excluded: !!p.excluded, ...(p.furnishedBy ? { furnish: `${p.furnishedBy.mode}:${p.furnishedBy.term}` } : {}) })) } : {}),
    ...(projectionCorrections ? { projectionCorrections } : {}),
  };
}

/** Chris's hours from his Accubid BOM text, through the same classifier. */
export function chrisHours(bomText: string, extraExterior: RegExp[] = []): HoursBreakdown & { footer: number | null } {
  const bom = parseAccubidBom(bomText);
  const h = sumHours(bom.rows, r => r.totalFieldLaborHours ?? 0, r => classifyBomRow(r, extraExterior));
  return { ...h, footer: bom.footerLaborHours };
}

export function countDiff(expected: ExpectedFile, countResult: CountResult | null, lf?: LinearFeet): EvalDiff {
  return diffAgainstExpected(expected, countResult, lf);
}

export type { PricedLine };

/** Gap-closing T0 — the price reference: CHRIS'S OWN INPUTS (his BOM material and hours, his equipment / GE
 *  lines and his vendor quotes exactly as he carried them — their own tax and markup) priced at the BID'S OWN
 *  CRM settings (the export's pricingContext: crew, burden, labor OH, markups). It answers "what would the CRM
 *  charge for Chris's estimate?", so the gate measures estimating (material + hours), not settings
 *  (gap analysis §1.3). */
export interface ChrisInputs {
  equipment: number;
  generalExpenses: number;
  quotes: Array<{ description: string; amount: number; taxPct: number; markupPct: number; status: 'firm' | 'budget_pending' }>;
  source: string;
}
export const CHRIS_INPUTS: Record<'kissimmee' | '36th', ChrisInputs> = {
  // accubidRecap.test.ts 'Autozone Kissimmee' — Chris's recap: equipment $4,350, GE $3,770 (incl. the $750 camera pole), no quotes.
  kissimmee: { equipment: 4350, generalExpenses: 3770, quotes: [], source: 'Chris\'s Kissimmee recap (accubidRecap.test.ts): equipment $4,350, GE $3,770, no quotes' },
  // accubidRecap.test.ts '36th Street Warehouse' — Chris's recap: equipment $890, GE $310, two lighting quotes at 7% tax / 10% markup.
  // (The plan's $20,904 put Chris's already taxed + marked-up $4,466.72 through the CRM's 18% quote markup again —
  // a second markup on the same quote; it is not what Chris submitted.)
  '36th': {
    equipment: 890, generalExpenses: 310, source: 'Chris\'s 36th recap (accubidRecap.test.ts): equipment $890, GE $310, quotes Lighting $1,965 + Lighting Optional $1,830 at 7% tax / 10% markup',
    quotes: [
      { description: 'Lighting', amount: 1965, taxPct: 7, markupPct: 10, status: 'firm' },
      { description: 'Lighting Optional', amount: 1830, taxPct: 7, markupPct: 10, status: 'firm' },
    ],
  },
};

export function chrisAtCrmSettings(job: 'kissimmee' | '36th', live: Live0930, bomText: string): { sellingPrice: number; material: number; hours: number; inputs: ChrisInputs } {
  const bom = parseAccubidBom(bomText);
  const material = bom.footerMaterialTotal ?? 0;
  const hours = bom.footerLaborHours ?? 0;
  const inputs = CHRIS_INPUTS[job];
  const { recap } = accubidRecapFrom({
    settings: live.pricingContext.accubidSettings as unknown as AccubidSettings, material, hours,
    quotes: inputs.quotes.map((q, i) => ({ id: `chris-${i}`, sort: i, vendor: null, fixturePackage: false, ...q })) as unknown as QuoteRow[],
    costLines: [
      { id: 'chris-eq', kind: 'equipment', description: 'Chris equipment', amount: inputs.equipment, taxPct: 0, sort: 0 },
      { id: 'chris-ge', kind: 'general_expense', description: 'Chris GE', amount: inputs.generalExpenses, taxPct: 0, sort: 1 },
    ] as unknown as CostLineRow[],
  });
  return { sellingPrice: recap.sellingPrice, material, hours, inputs };
}
