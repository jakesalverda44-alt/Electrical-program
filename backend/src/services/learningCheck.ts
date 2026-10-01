// Level 2 learning, Task 14 B — "Check and release": the model-effect A/B
// on the held-out eval jobs, run ONLY from Jake's button in Settings (L-D2;
// it costs real money, ~$12-15). Never run by a test (tests inject a fake
// client and job runner) and never by the builder.
//
// Leave-one-job-out: the bank for job J excludes every example from bid J
// or from J's own drawings (document sha). Arms: A = no learning, B = the
// release; each twice (the counter varies run to run). When J's LOJO bank
// is empty the job is reported "no change (empty bank)" without a single
// model call — the honest state today (L-D1: no labelling session).
// Read-only: the evidence cache is read, never written; nothing of the bid
// is written. The release's eval + status are the only writes.
import fs from 'fs';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { loadDocumentBytes } from '../utils/backfillContentHashes';
import { dbEvidenceCache } from './evidenceCache';
import { loadRemodelInput } from '../estimating/remodelConvention';
import { parseAIJSON } from '../ai/json';
import { runCountingStage, type CountResult } from '../ai/countingStage';
import { buildReviewItems } from '../ai/reviewItems';
import { diffAgainstExpected, validateExpectedFile, type ExpectedFile } from '../eval/takeoffEval';
import { gateDecision, type ArmRepeat, type GateResult } from '../eval/learningGate';
import { reviewCounts } from '../eval/reviewCounts';
import { makeCounterLearning, type LearningBank } from '../ai/learning/counterLearning';
import { selectExamples, selectLessons } from '../ai/learning/selectExamples';
import type { CountTarget } from '../ai/countTargets';
import { getRelease, setReleaseEval, activateRelease, claimReleaseForCheck, listExamples, listLessons } from '../ai/learning/learningDb';
import { clusterOf } from '../ai/learning/visualHash';
import type { InventoryPage } from '../ai/countSheets';
import type { EvidenceCache } from '../ai/evidence/evidenceStage';

/** The held-out eval jobs (the two live bids; Jake marked both Calibration). */
export const EVAL_JOBS = [
  { label: 'Kissimmee', bidId: '041c6d48-5910-4e29-a99c-850867a900f3', expected: 'autozone-10077-kissimmee.expected.json', disputed: ['exit_emergency', 'wall_packs', 'retail_power_poles'] },
  { label: '36th Street', bidId: '0cd39e74-999a-4d83-9629-115340ba08be', expected: '36th-street-warehouse.expected.json', disputed: ['type_H', 'emergency', 'demo_fluor', 'demo_hid', 'demo_exit_em', 'demo_recept', 'demo_switch'] },
] as const;
export const EST_COST_USD = '$12–15';

const readOnlyCache: EvidenceCache = { get: (...a) => dbEvidenceCache.get(...a), set: async () => {} };

export interface JobInputs { /** The stored run's count targets (S4: used to skip a job nothing in the bank applies to). Absent = cannot pre-select, so the job runs. */ targets?: CountTarget[]; agent1: Record<string, unknown>; inventory: InventoryPage[]; pdfs: Map<string, Buffer>; docShas: Set<string>; remodel: { buildType: string | null; answer: string | null } }

export async function loadJobInputs(bidId: string): Promise<JobInputs | null> {
  const { rows } = await pool.query('SELECT agent1_output, count_result, prep_inventory, input_document_ids FROM takeoff_results WHERE bid_id = $1', [bidId]);
  if (!rows.length || !rows[0].agent1_output) return null;
  const a1 = (parseAIJSON(rows[0].agent1_output as string) ?? {}) as Record<string, unknown>;
  const cr = rows[0].count_result as CountResult | null;
  // The counter's own input: Agent 1's rows that the count did not own, plus the rows it removed.
  const q = (a1.quantities as Array<Record<string, unknown>> | undefined) ?? [];
  const { countingSummary: _cs, ...rest } = a1;
  const agent1 = { ...rest, quantities: [...q.filter(r => !r.countType && r.countedBy !== 'schedule'), ...((cr?.removedRows ?? []) as Array<{ row: Record<string, unknown> }>).map(r => r.row)] };
  const ids = (rows[0].input_document_ids as string[] | null) ?? [];
  const docs = await pool.query(
    `SELECT id, name, file_data, storage_url, content_sha256 FROM documents WHERE linked_id = $1 AND deleted_at IS NULL AND category = 'plans' ${ids.length ? 'AND id = ANY($2::uuid[])' : ''}`,
    ids.length ? [bidId, ids] : [bidId]);
  const pdfs = new Map<string, Buffer>();
  const docShas = new Set<string>();
  for (const d of docs.rows) {
    const b = await loadDocumentBytes(d);
    if (!b) continue;
    pdfs.set(d.name as string, b);
    if (d.content_sha256) docShas.add(d.content_sha256 as string);
  }
  return { targets: cr?.targets, agent1, inventory: (rows[0].prep_inventory as InventoryPage[] | null) ?? [], pdfs, docShas, remodel: await loadRemodelInput(bidId) };
}

async function bankOf(releaseId: number | null, exampleIds: string[], lessonIds: string[], withCrop: boolean): Promise<LearningBank> {
  const ex = exampleIds.length ? (await listExamples({ ids: exampleIds, withCrop, limit: 5000 })).filter(e => e.status !== 'retired' && (!withCrop || e.crop)) : [];
  const clusters = clusterOf(ex.map(e => ({ id: e.id, dhash: e.dhash, deviceClass: e.meaning.deviceClass, meaningFp: e.meaning.meaningFp })));
  const lessons = lessonIds.length ? (await listLessons({ ids: lessonIds })).filter(l => l.status === 'approved') : [];
  return {
    releaseId,
    examples: ex.map(e => ({ id: e.id, polarity: e.polarity, meaning: e.meaning, confusedWith: e.confusedWith, notADevice: e.notADevice, quality: e.quality, sourceBidId: e.sourceBidId, sourceBidName: e.sourceBidName, sourceDocSha: e.sourceDocSha, createdAt: e.createdAt, dhash: e.dhash, conflicted: clusters.get(e.id)?.conflicted ?? false, crop: e.crop ?? Buffer.alloc(0) })),
    lessons: lessons.map(l => ({ id: l.id, version: l.version, text: l.text, appliesTo: l.appliesTo, scopeKind: l.scopeKind, scopeValue: l.scopeValue, match: l.match })),
  };
}

export async function releaseBank(releaseId: number): Promise<LearningBank> {
  const r = await getRelease(releaseId);
  if (!r) throw new Error('No such release.');
  return bankOf(releaseId, r.exampleIds, r.lessonIds, true);
}

/** S4 — what the check WOULD do for each eval job if started now (no model calls, no PDFs read):
 *  the confirm dialog shows which jobs would spend money and which are "no change". */
export async function previewLearningCheck(): Promise<{ jobs: Array<{ label: string; willRun: boolean; note: string }>; estimatedCost: string }> {
  const ex = await pool.query(`SELECT id FROM symbol_examples WHERE status <> 'retired'`);
  const ls = await pool.query(`SELECT id FROM counting_lessons WHERE status = 'approved'`);
  const bank = await bankOf(null, ex.rows.map(r => r.id as string), ls.rows.map(r => r.id as string), false);
  const jobs: Array<{ label: string; willRun: boolean; note: string }> = [];
  for (const job of EVAL_JOBS) {
    const { rows } = await pool.query(`SELECT tr.count_result->'targets' AS targets, b.project_type, tr.account_terms->>'ruleId' AS rule_id FROM bids b LEFT JOIN takeoff_results tr ON tr.bid_id = b.id WHERE b.id = $1`, [job.bidId]);
    const shas = new Set<string>((await pool.query(`SELECT content_sha256 FROM documents WHERE linked_id = $1 AND deleted_at IS NULL AND category = 'plans' AND content_sha256 IS NOT NULL`, [job.bidId])).rows.map(r => r.content_sha256 as string));
    const targets = (rows[0]?.targets as CountTarget[] | null) ?? null;
    const lb = lojoBank(bank, job, shas);
    if (!lb.examples.length && !lb.lessons.some(l => l.appliesTo.includes('counter'))) { jobs.push({ label: job.label, willRun: false, note: 'no change — nothing from other jobs in the bank (no model calls)' }); continue; }
    if (!targets) { jobs.push({ label: job.label, willRun: false, note: 'cannot be checked — no stored run; the release would NOT go live' }); continue; }
    const off = { all: false, examples: new Set<string>(), lessons: new Set<string>() };
    const hits = selectExamples(targets, lb.examples, { bidId: job.bidId, docShas: shas, off }, 196).picked.length > 0
      || selectLessons(targets, lb.lessons, { projectType: (rows[0]?.project_type as string | null) ?? null, accountRuleId: (rows[0]?.rule_id as string | null) ?? null, off, statusMode: true }, 'counter').length > 0;
    jobs.push(hits ? { label: job.label, willRun: true, note: 'will run (AI calls)' } : { label: job.label, willRun: false, note: 'no change — nothing in the bank applies to this job (no model calls)' });
  }
  return { jobs, estimatedCost: EST_COST_USD };
}

/** Leave-one-job-out: nothing from this bid or its drawings. */
export function lojoBank(bank: LearningBank, job: { bidId: string }, docShas: Set<string>): LearningBank {
  return { ...bank, examples: bank.examples.filter(e => e.sourceBidId !== job.bidId && !(e.sourceDocSha && docShas.has(e.sourceDocSha))) };
}

export interface CheckDeps {
  client: Anthropic;
  model: string;
  maxTokens: number;
  evidence: { model: string; maxTokens: number };
  /** Tests inject a runner; default = the real counting stage. */
  runArm?: (job: typeof EVAL_JOBS[number], inputs: JobInputs, learning: ReturnType<typeof makeCounterLearning>) => Promise<CountResult>;
  loadInputs?: (bidId: string) => Promise<JobInputs | null>;
}

export interface CheckResult { passed: boolean; jobs: Array<{ label: string; bidId: string; bankExamples: number; bankLessons: number; ran: boolean; note: string; gate?: GateResult; usage?: { input_tokens: number; output_tokens: number } }>; costNote: string; at: string }

async function accountRuleOf(bidId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT account_terms->>'ruleId' AS r FROM takeoff_results WHERE bid_id = $1`, [bidId]);
  return (rows[0]?.r as string | null) ?? null;
}

export async function runLearningCheck(releaseId: number, deps: CheckDeps): Promise<CheckResult> {
  const bank = await releaseBank(releaseId);
  const out: CheckResult = { passed: true, jobs: [], costNote: `estimated ${EST_COST_USD} when both jobs have a bank; nothing is spent on a job whose leave-one-out bank is empty`, at: new Date().toISOString() };
  for (const job of EVAL_JOBS) {
    const inputs = await (deps.loadInputs ?? loadJobInputs)(job.bidId);
    const projectType = async () => ((await pool.query('SELECT project_type FROM bids WHERE id = $1', [job.bidId])).rows[0]?.project_type as string | null) ?? null;
    const mkLearning = async (lb: LearningBank, docShas: Set<string>) => makeCounterLearning(lb, { bidId: job.bidId, docShas, off: { all: false, examples: new Set(), lessons: new Set() }, projectType: await projectType(), accountRuleId: await accountRuleOf(job.bidId) });
    if (!inputs || !inputs.pdfs.size) {
      // B1: a job that cannot be checked FAILS the release unless nothing in the bank could apply to it
      // (the leave-one-job-out bank, without the drawings' sha since they could not be read, is empty).
      const lb0 = lojoBank(bank, job, new Set());
      const would = await mkLearning(lb0, new Set());
      if (would) { out.passed = false; out.jobs.push({ label: job.label, bidId: job.bidId, bankExamples: lb0.examples.length, bankLessons: lb0.lessons.length, ran: false, note: `could not check ${job.label}: ${!inputs ? 'the eval job has no stored run' : 'its plan PDFs could not be loaded'} — not released` }); }
      else out.jobs.push({ label: job.label, bidId: job.bidId, bankExamples: 0, bankLessons: 0, ran: false, note: 'no change — the leave-one-job-out bank is empty for this job (no model calls)' });
      continue;
    }
    const lb = lojoBank(bank, job, inputs.docShas);
    const learning = await mkLearning(lb, inputs.docShas);
    if (!learning) { out.jobs.push({ label: job.label, bidId: job.bidId, bankExamples: lb.examples.length, bankLessons: lb.lessons.length, ran: false, note: 'no change — the leave-one-job-out bank is empty for this job (no model calls)' }); continue; }
    // S4: nothing in the bank applies to this job's targets -> the request would be byte-identical; spend nothing.
    if (inputs.targets) {
      const ctx = { bidId: job.bidId, docShas: inputs.docShas, off: { all: false, examples: new Set<string>(), lessons: new Set<string>() } };
      const hitsEx = selectExamples(inputs.targets, lb.examples, ctx, 196).picked.length > 0;
      const hitsLs = selectLessons(inputs.targets, lb.lessons, { projectType: await projectType(), accountRuleId: await accountRuleOf(job.bidId), off: ctx.off, statusMode: true }, 'counter').length > 0;
      if (!hitsEx && !hitsLs) { out.jobs.push({ label: job.label, bidId: job.bidId, bankExamples: lb.examples.length, bankLessons: lb.lessons.length, ran: false, note: 'no change — nothing in the bank applies to this job (no model calls)' }); continue; }
    }
    const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', job.expected), 'utf8'))) as ExpectedFile;
    const run = deps.runArm ?? (async (_j, inp, l) => (await runCountingStage({
      client: deps.client, model: deps.model, maxTokens: deps.maxTokens, agent1: inp.agent1, inventory: inp.inventory, pdfs: inp.pdfs,
      evidence: { ...deps.evidence, cache: readOnlyCache }, remodel: inp.remodel, ...(l ? { learning: l } : {}),
    })).countResult);
    const arm = async (l: ReturnType<typeof makeCounterLearning>): Promise<ArmRepeat[]> => {
      const reps: ArmRepeat[] = [];
      for (let k = 0; k < 2; k++) {
        const cr = await run(job, inputs, l);
        reps.push({ diff: diffAgainstExpected(expected, cr), asked: reviewCounts(buildReviewItems(cr)).asked });
      }
      return reps;
    };
    const a = await arm(undefined);
    const b = await arm(learning);
    const gate = gateDecision(a, b, new Set(job.disputed));
    if (!gate.passed) out.passed = false;
    out.jobs.push({ label: job.label, bidId: job.bidId, bankExamples: lb.examples.length, bankLessons: lb.lessons.length, ran: true, note: gate.passed ? 'no regression' : `regressions: ${gate.regressions.join('; ')}`, gate });
  }
  return out;
}

/** The button: check, store the result, activate on a pass. Never throws. */
export async function checkAndRelease(releaseId: number, deps: CheckDeps, opts: { alreadyClaimed?: boolean } = {}): Promise<void> {
  try {
    // S7: atomic claim (the route claims before it answers 202 and passes alreadyClaimed).
    if (!opts.alreadyClaimed && !(await claimReleaseForCheck(releaseId))) return;
    const r = await runLearningCheck(releaseId, deps);
    await setReleaseEval(releaseId, r as unknown as Record<string, unknown>, r.passed ? 'pending' : 'failed');
    if (r.passed) await activateRelease(releaseId);
  } catch (err) {
    logger.warn({ err, releaseId }, '[learning] check and release failed');
    await setReleaseEval(releaseId, { passed: false, error: err instanceof Error ? err.message : String(err) }, 'failed').catch(() => {});
  }
}
