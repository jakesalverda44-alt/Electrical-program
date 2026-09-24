// Takeoff accuracy, Task 10 — run the FULL AI takeoff pipeline (page
// classifier, Agent 1, the counting stage, Agents 2-3) on a local plan-set PDF
// and diff the counts against an expected-counts file, with the run's cost.
//
//   # dry run (default): checks the inputs, prints what WOULD run, spends nothing
//   npx tsx scripts/evalTakeoff.ts --pdf "<plan set.pdf>" --expected eval/autozone-10077-kissimmee.expected.json
//
//   # real run — PAID Anthropic calls; only with Jake's OK. Runs against the
//   # TEST database (electrical_crm_test) unless --db names another one:
//   npx tsx scripts/evalTakeoff.ts --pdf "<plan set.pdf>" \
//     --expected eval/autozone-10077-kissimmee.expected.json --confirm-live-api [--keep] [--out report.json] [--db <name>]
//
// Fix round 1 / S16 — the database: default electrical_crm_test. The live
// app's database (electrical_crm, still at an older migration before this
// branch merges) is refused unless --db names it explicitly, because the run
// applies this branch's migrations and inserts (then deletes) a bid there.
// DB_NAME in the environment is ignored unless it matches --db.
//
// The real run creates a throwaway bid ("EVAL …", notifications never fire —
// it is a direct insert, not POST /api/bids), runs the pipeline in-process,
// prints the per-type diff and the token cost per stage (classifier + Agent
// 1, the counter, Agents 2-3 and the pre-bid draft Agent 4 composes right
// after a clear review), and deletes the bid again (cascade: takeoff_results,
// est_markups) unless --keep. The Anthropic key comes from app_settings
// (Settings → AI) or ANTHROPIC_API_KEY and is never printed. Nothing is
// emailed, nothing touches Drive (the bid has no Drive folder).
//
// Written for the takeoff-accuracy plan; the executor never ran it against the
// real API (plan Decision 10).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type Anthropic from '@anthropic-ai/sdk';
import { validateExpectedFile, diffAgainstExpected, formatDiffTable, usageCost, evalDatabase, EVAL_DEFAULT_DB, type UsageLike } from '../src/eval/takeoffEval';
import type { CountResult } from '../src/ai/countingStage';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main(): Promise<number> {
  const pdfPath = arg('--pdf');
  const expectedPath = arg('--expected');
  if (!pdfPath || !expectedPath) {
    console.error('Usage: npx tsx scripts/evalTakeoff.ts --pdf <plan-set.pdf> --expected <expected.json> [--confirm-live-api] [--keep] [--out report.json]');
    return 2;
  }
  if (!fs.existsSync(pdfPath)) { console.error(`PDF not found: ${pdfPath}`); return 2; }
  const expected = validateExpectedFile(JSON.parse(fs.readFileSync(expectedPath, 'utf8')));
  const pdf = fs.readFileSync(pdfPath);
  let pages = '?';
  try { pages = /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfPath]).toString())?.[1] ?? '?'; } catch { /* pdfinfo optional */ }

  console.log(`Eval: ${expected.project}`);
  console.log(`PDF: ${path.basename(pdfPath)} — ${(pdf.length / 1e6).toFixed(1)} MB, ${pages} pages`);
  console.log(`Expected items: ${expected.items.length} (${expected.items.filter(i => i.disputed).length} disputed, ${expected.items.filter(i => i.not_counted).length} not counted)`);

  const dbChoice = evalDatabase(process.argv);
  if ('error' in dbChoice) { console.error(`Database: ${dbChoice.error}.`); return 2; }
  console.log(`Database: ${dbChoice.db}${dbChoice.db === EVAL_DEFAULT_DB ? ' (the test database — pass --db to use another)' : ''}`);

  if (!has('--confirm-live-api')) {
    console.log('\nDRY RUN — nothing was sent. Add --confirm-live-api to run the real pipeline (PAID Anthropic calls: page classifier, Agent 1, the Opus counter on every electrical plan sheet, Agents 2-3, and the pre-bid draft — an Agent 4 call — when the review comes back clear).');
    return 0;
  }

  // The DB is chosen BEFORE the pool module loads (it reads DB_NAME once).
  process.env.DB_NAME = dbChoice.db;
  const { pool } = await import('../src/db/pool');
  poolRef = pool;
  const { runMigrations } = await import('../src/migrate');
  const { getSetting } = await import('../src/db/getSetting');
  const { runPipeline, loadAIConfig, startAnalysisRun } = await import('../src/routes/preconstruction');
  const { default: AnthropicSdk } = await import('@anthropic-ai/sdk');

  await runMigrations();
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) { console.error('No Anthropic key in Settings → AI or ANTHROPIC_API_KEY.'); return 2; }
  const config = await loadAIConfig();
  console.log(`Models: classifier ${config.modelClassifier} · Agent 1 ${config.model} · counter ${config.modelCounter} · Agent 2 ${config.modelA2} · Agent 3 ${config.modelA3}`);

  const b = expected.bid;
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, brand, project_type) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [`${b.name} ${new Date().toISOString()}`, b.gc, b.loc, b.brand ?? null, b.project_type ?? null]
  );
  const bidId = rows[0].id as string;
  await startAnalysisRun(bidId);
  const started = Date.now();
  try {
    const file = { originalname: path.basename(pdfPath), buffer: pdf, mimetype: 'application/pdf', size: pdf.length } as Express.Multer.File;
    await runPipeline(bidId, [file], new AnthropicSdk({ apiKey }) as Anthropic, config);
    const { rows: tr } = await pool.query('SELECT * FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const r = tr[0];
    console.log(`\nStatus: ${r.status} after ${Math.round((Date.now() - started) / 1000)} s`);
    if (r.status === 'error') console.log(`Error: ${r.agent1_output || r.agent2_output || r.agent3_output || r.raw_response}`);

    const cr = (r.count_result ?? null) as CountResult | null;
    if (cr) {
      console.log(`Counted sheets: ${cr.sheets.filter(s => s.status === 'counted').map(s => s.label).join(', ') || '—'}`);
      const failed = cr.sheets.filter(s => s.status !== 'counted');
      if (failed.length) console.log(`Failed sheets: ${failed.map(s => `${s.label} (${s.error})`).join('; ')}`);
      console.log(`Not counted: ${cr.skippedSheets.map(s => `${s.label} — ${s.reason}`).join('; ') || '—'}`);
    }
    const diff = diffAgainstExpected(expected, cr);
    console.log(`\n${formatDiffTable(diff)}`);

    const reviewOpen = ((r.review_items ?? []) as Array<{ title: string; resolution?: unknown }>).filter(i => !i.resolution);
    if (reviewOpen.length) console.log(`\nNeeds review (${reviewOpen.length}): ${reviewOpen.map(i => i.title).join('; ')}`);
    if (r.account_terms) console.log(`Account rule: ${r.account_terms.ruleName} (${r.account_terms.matchedBy})`);
    for (const f of (r.hygiene?.flags ?? []) as string[]) console.log(`Hygiene: ${f}`);

    const stages: Array<[string, UsageLike | null, string | null]> = [
      ['Classifier + Agent 1', r.usage_agent1, r.model_agent1],
      ['Counter (Agent 1C)', r.usage_counter, r.model_counter],
      ['Agent 2', r.usage_agent2, r.model_agent2],
      ['Agent 3', r.usage_agent3, r.model_agent3],
      ['Pre-bid draft (Agent 4)', r.usage_draft, r.draft_model],
    ];
    let total = 0;
    console.log('\nCOST (list prices; classifier tokens are billed at the classifier model but folded into Agent 1\'s usage, so that line is approximate)');
    for (const [label, usage, model] of stages) {
      const c = usageCost(usage, model);
      total += c ?? 0;
      console.log(`${label.padEnd(22)} ${model ?? '—'}  in ${usage?.input_tokens ?? 0}  out ${usage?.output_tokens ?? 0}  cache-read ${usage?.cache_read_input_tokens ?? 0}  ${c == null ? '(no price)' : `$${c.toFixed(2)}`}`);
    }
    console.log(`TOTAL ≈ $${total.toFixed(2)}`);

    const out = arg('--out');
    if (out) {
      fs.writeFileSync(out, JSON.stringify({ project: expected.project, status: r.status, diff, countResult: cr, review: r.review_items, accountTerms: r.account_terms, hygiene: r.hygiene, cost: total }, null, 2));
      console.log(`Report written: ${out}`);
    }
    return diff.failed === 0 && r.status === 'complete' ? 0 : 1;
  } finally {
    if (has('--keep')) console.log(`\nKept bid ${bidId} (--keep).`);
    else await pool.query('DELETE FROM bids WHERE id=$1', [bidId]);
  }
}

let poolRef: { end: () => Promise<void> } | null = null;
const endPool = () => (poolRef ? poolRef.end() : Promise.resolve());

if (require.main === module) {
  main()
    .then(code => endPool().then(() => process.exit(code)))
    .catch(err => { console.error(err instanceof Error ? err.message : err); endPool().finally(() => process.exit(1)); });
}
