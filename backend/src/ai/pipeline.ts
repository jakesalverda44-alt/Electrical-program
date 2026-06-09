import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import { AGENT1_SYSTEM, AGENT2_SYSTEM, AGENT3_SYSTEM, AGENT4_SYSTEM } from './prompts';
import { callWithRetry } from './retry';
import { parseAIJSON, extractJSONText } from './json';
import { uploadFile } from '../services/googleDrive';

/**
 * The 4-agent takeoff pipeline, extracted from the preconstruction route so it
 * can be invoked both by the HTTP route (fresh run) and by startup/periodic
 * recovery (resume after a crash or redeploy).
 *
 * Durability model: every agent's input/output is persisted to takeoff_results
 * as it completes, so agents 2-4 are resumable from the database. Agent 1 is
 * not — its inputs are uploaded file buffers that only exist in memory — so an
 * interrupted Agent 1 run is marked as an error by recovery and must be re-run.
 * While any agent is in flight the worker stamps worker_heartbeat_at every 15s;
 * recovery only acts on rows whose heartbeat has gone stale, which keeps
 * overlapping instances (zero-downtime deploys) from double-running a live job.
 */

export interface AIConfig {
  model: string;
  modelA2: string;
  modelA3: string;
  modelA4: string;
  maxTokensA1: number;
  maxTokensA2: number;
  maxTokensA3: number;
  maxTokensA4: number;
  temperature: number;
  promptA1: string;
  promptA2: string;
  promptA3: string;
  promptA4: string;
}

const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS_A1 = 16000;
const DEFAULT_MAX_TOKENS_A2 = 4000;
const DEFAULT_MAX_TOKENS_A3 = 4000;
const DEFAULT_MAX_TOKENS_A4 = 8000;
const DEFAULT_TEMPERATURE = 0.3;

function parseNumberSetting(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function loadAIConfig(): Promise<AIConfig> {
  const [
    modelSetting, modelA2Setting, modelA3Setting, modelA4Setting,
    maxA1Setting, maxA2Setting, maxA3Setting, maxA4Setting,
    temperatureSetting,
    promptA1Setting, promptA2Setting, promptA3Setting, promptA4Setting,
  ] = await Promise.all([
    getSetting('ai_model'),
    getSetting('ai_takeoff_agent2_model'),
    getSetting('ai_takeoff_agent3_model'),
    getSetting('ai_takeoff_agent4_model'),
    getSetting('ai_max_tokens_agent1'),
    getSetting('ai_max_tokens_agent2'),
    getSetting('ai_max_tokens_agent3'),
    getSetting('ai_max_tokens_agent4'),
    getSetting('ai_temperature'),
    getSetting('ai_prompt_agent1'),
    getSetting('ai_prompt_agent2'),
    getSetting('ai_prompt_agent3'),
    getSetting('ai_prompt_agent4'),
  ]);
  const defaultModel = (process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL).trim();
  return {
    model:   (modelSetting   || defaultModel),
    modelA2: (modelA2Setting || 'claude-haiku-4-5-20251001'),
    modelA3: (modelA3Setting || 'claude-haiku-4-5-20251001'),
    modelA4: (modelA4Setting || 'claude-sonnet-4-6'),
    maxTokensA1: parseNumberSetting(maxA1Setting || '', DEFAULT_MAX_TOKENS_A1, 256, 64000),
    maxTokensA2: parseNumberSetting(maxA2Setting || '', DEFAULT_MAX_TOKENS_A2, 256, 64000),
    maxTokensA3: parseNumberSetting(maxA3Setting || '', DEFAULT_MAX_TOKENS_A3, 256, 64000),
    maxTokensA4: parseNumberSetting(maxA4Setting || '', DEFAULT_MAX_TOKENS_A4, 256, 64000),
    temperature: parseNumberSetting(temperatureSetting || process.env.AI_TEMPERATURE || '', DEFAULT_TEMPERATURE, 0, 1),
    promptA1: (promptA1Setting || '').trim(),
    promptA2: (promptA2Setting || '').trim(),
    promptA3: (promptA3Setting || '').trim(),
    promptA4: (promptA4Setting || '').trim(),
  };
}

export function describeAIError(err: unknown): string {
  const e = err as { message?: string; status?: number; error?: { message?: string }; response?: { data?: { error?: string; message?: string } } };
  const status = e.status ? `Anthropic ${e.status}` : 'AI request failed';
  const detail = e.error?.message || e.response?.data?.error || e.response?.data?.message || e.message || 'Unknown error';
  return `${status}: ${detail}`;
}

// ── Electrical sheet filter ────────────────────────────────────────────────────
// Positive include: electrical sheet prefixes OR any keyword that signals electrical
// scope — fixture/lighting/luminaire/schedule. Keyword matches win over the exclude
// list, so a "Lighting Fixture Schedule" sheet is never dropped regardless of prefix.
const ELEC_INCLUDE = /^E\d|electrical|one.?line|panel.?sched|equip.?sched|fixture|lumin|lighting|schedule/i;
const EXCLUDE_ONLY = /^(A|S|C|L|M|P|G|FP|PL|CV|CI|LS)\d/i;

export function isElectricalSheet(filename: string): boolean {
  const base = filename.replace(/\.[^.]+$/, '');
  if (ELEC_INCLUDE.test(base)) return true;
  if (EXCLUDE_ONLY.test(base)) return false;
  return true; // uncertain — include
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

function logAgent1Request(bidId: string, blocks: Anthropic.MessageParam['content'], model: string, maxTokens: number, batchLabel: string) {
  const blockSummary = (blocks as Array<{ type: string; source?: { media_type?: string; type?: string }; text?: string }>).map(b => ({
    type: b.type,
    ...(b.source ? { source_type: b.source.type, media_type: b.source.media_type } : {}),
    ...(b.text   ? { text_length: b.text.length } : {}),
  }));
  logger.info({ bidId, batch: batchLabel, model, maxTokens, blocks: blockSummary }, '[takeoff] Agent 1 request');
}

function logAgent1Response(bidId: string, resp: Anthropic.Message, outputText: string, batchLabel: string) {
  logger.info({
    bidId,
    batch: batchLabel,
    stop_reason: resp.stop_reason,
    content_blocks: resp.content.map(b => ({ type: b.type, ...(b.type === 'text' ? { length: (b as Anthropic.TextBlock).text.length } : {}) })),
    input_tokens: resp.usage?.input_tokens,
    output_tokens: resp.usage?.output_tokens,
    output_text_length: outputText.length,
    output_preview: outputText.slice(0, 200),
  }, '[takeoff] Agent 1 response');
}

function compactOutput(text: string, max = 500): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}...`;
}

/**
 * Stamp worker_heartbeat_at every 15s while a run is in flight so recovery can
 * tell a live job from an orphaned one. Returns a stop function; always call it
 * in a finally block.
 */
function startHeartbeat(bidId: string): () => void {
  const stamp = () =>
    pool.query('UPDATE takeoff_results SET worker_heartbeat_at=now() WHERE bid_id=$1', [bidId])
      .catch(() => {});
  void stamp();
  const t = setInterval(stamp, 15_000);
  t.unref?.();
  return () => clearInterval(t);
}

function buildContentBlocks(files: Express.Multer.File[]): Anthropic.MessageParam['content'] {
  const contentBlocks: Anthropic.MessageParam['content'] = [];
  for (const f of files) {
    const b64 = f.buffer.toString('base64');
    const ext = f.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf') {
      contentBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 },
      } as Anthropic.DocumentBlockParam);
    } else {
      const mt: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' =
        ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mt, data: b64 },
      } as Anthropic.ImageBlockParam);
    }
  }
  return contentBlocks;
}

// ── Agent 1: drawing analysis (vision) ─────────────────────────────────────────
// Returns the validated Agent 1 output, or null after persisting an error state.
async function runAgent1(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig
): Promise<string | null> {
  let agent1Output = '';
  try {
    // Filter to electrical sheets
    const electricalFiles = files.filter(f => isElectricalSheet(f.originalname));
    const filesToSend = electricalFiles.length > 0 ? electricalFiles : files;
    const droppedFiles = files.filter(f => !filesToSend.includes(f));
    logger.info({
      bidId,
      sent: filesToSend.map(f => f.originalname),
      dropped: droppedFiles.map(f => f.originalname),
    }, '[takeoff] Agent 1 sheet filter — files sent vs. dropped');

    // Build document/image blocks
    // When multiple PDFs are present, send 1 per batch — each PDF may have many pages
    // and combined token output easily hits the max_tokens hard limit.
    const pdfCount = filesToSend.filter(f => (f.originalname.split('.').pop() || '').toLowerCase() === 'pdf').length;
    const BATCH_SIZE = pdfCount > 1 ? 1 : 20;
    let agent1JSON: Record<string, unknown> = {};

    if (filesToSend.length <= BATCH_SIZE) {
      // Single pass
      const contentBlocks = buildContentBlocks(filesToSend) as Exclude<Anthropic.MessageParam['content'], string>;
      contentBlocks.push({
        type: 'text',
        text: 'Analyze all uploaded electrical plans and provide your complete Drawing Analyzer output following your output format exactly. Return JSON only — no prose, no markdown fences.\nIMPORTANT: Even if a sheet contains no electrical equipment, you MUST return a valid JSON object. For non-electrical sheets, include the sheet name in sheet_inventory with a note and leave equipment arrays empty.',
      });

      logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, 'single');
      const resp = await callWithRetry(() =>
        client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokensA1,
          temperature: config.temperature,
          system: [{ type: 'text', text: config.promptA1 || AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contentBlocks }],
        }).finalMessage()
      , { onRetry: (a, _e, d) => logger.warn({ bidId }, `[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
      agent1Output = extractText(resp);
      logAgent1Response(bidId, resp, agent1Output, 'single');
      await pool.query(
        `UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2 WHERE bid_id=$3`,
        [JSON.stringify(resp.usage), config.model, bidId]
      ).catch(() => {});

    } else {
      // Batched: split into groups of BATCH_SIZE, merge JSON
      const batches: Express.Multer.File[][] = [];
      for (let i = 0; i < filesToSend.length; i += BATCH_SIZE) {
        batches.push(filesToSend.slice(i, i + BATCH_SIZE));
      }
      const batchResults: Record<string, unknown>[] = [];
      const batchUsage = { input_tokens: 0, output_tokens: 0 };

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const contentBlocks = buildContentBlocks(batch) as Exclude<Anthropic.MessageParam['content'], string>;
        contentBlocks.push({
          type: 'text',
          text: `Analyze batch ${bi + 1} of ${batches.length} electrical plan files and provide Drawing Analyzer JSON output. Return JSON only — no prose, no markdown fences.\nIMPORTANT: Even if this sheet contains no electrical equipment, you MUST return a valid JSON object with the sheet in sheet_inventory and equipment arrays empty.`,
        });

        logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, `batch ${bi + 1}/${batches.length}`);
        const bResp = await callWithRetry(() =>
          client.messages.stream({
            model: config.model,
            max_tokens: config.maxTokensA1,
            temperature: config.temperature,
            system: [{ type: 'text', text: config.promptA1 || AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: contentBlocks }],
          }).finalMessage()
        , { onRetry: (a, _e, d) => logger.warn({ bidId }, `[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
        const bText = extractText(bResp);
        logAgent1Response(bidId, bResp, bText, `batch ${bi + 1}/${batches.length}`);
        if (!bText.trim()) {
          logger.warn({ bidId, batch: `${bi + 1}/${batches.length}`, files: batch.map(f => f.originalname) },
            '[takeoff] Agent 1 batch returned empty output — skipping');
        }
        const parsed = parseAIJSON(bText);
        if (parsed) batchResults.push(parsed);
        if (bResp.usage) {
          batchUsage.input_tokens  += bResp.usage.input_tokens  ?? 0;
          batchUsage.output_tokens += bResp.usage.output_tokens ?? 0;
        }
      }
      await pool.query(
        `UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2 WHERE bid_id=$3`,
        [JSON.stringify(batchUsage), config.model, bidId]
      ).catch(() => {});

      // Merge batch results
      const merged: Record<string, unknown[]> & { project_info?: unknown; confidence_scores?: unknown } = {
        panels: [], feeders: [], transformers: [], generators: [], ats: [],
        lighting: [], devices: [], equipment: [], conduit: [], wire: [],
        notes: [], sheet_inventory: [], sheet_references: [], warnings: [],
        systems_identified: [],
      };
      const seenPanels = new Set<string>();
      for (const r of batchResults) {
        for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
          if (!Array.isArray(r[key])) continue;
          for (const item of r[key] as Record<string, unknown>[]) {
            if (key === 'panels' && item.name) {
              const sig = `${item.name}:${item.source_sheet}`;
              if (seenPanels.has(sig)) {
                (item as Record<string,unknown>).cross_reference = 'CROSS-REFERENCE — VERIFY';
              } else {
                seenPanels.add(sig);
              }
            }
            (merged[key] as unknown[]).push(item);
          }
        }
      }
      if (batchResults[0]) merged.project_info = batchResults[0].project_info;
      if (batchResults[0]) merged.confidence_scores = batchResults[0].confidence_scores;
      agent1JSON = merged as unknown as Record<string, unknown>;
      agent1Output = JSON.stringify(agent1JSON, null, 2);
    }

    // Validate JSON
    const parsedAgent1 = parseAIJSON(agent1Output);
    if (!parsedAgent1) {
      const stopHint = agent1Output.trim().startsWith('```') || agent1Output.trim().startsWith('{')
        ? 'Agent 1 returned JSON that could not be parsed. The response may have been cut off. Try fewer sheets or increase AI Max Tokens in Settings > AI.'
        : 'Agent 1 did not return JSON.';
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [`${stopHint}\n\nRaw preview: ${compactOutput(agent1Output)}`, bidId]
      );
      logger.error({ bidId }, '[takeoff] Agent 1 JSON parse failed');
      return null;
    }

    await pool.query(
      `UPDATE takeoff_results SET status='agent1_complete', agent1_output=$1 WHERE bid_id=$2`,
      [agent1Output, bidId]
    );
    return agent1Output;
  } catch (err) {
    const message = `Agent 1 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 1 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return null;
  }
}

// ── Agent 2: scope & estimate ──────────────────────────────────────────────────
// Returns the Agent 2 output, or null after persisting an error state.
async function runAgent2(
  bidId: string,
  client: Anthropic,
  config: AIConfig,
  agent1Output: string
): Promise<string | null> {
  try {
    await pool.query(`UPDATE takeoff_results SET status='agent2_running' WHERE bid_id=$1`, [bidId]);
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA2,
      max_tokens: config.maxTokensA2,
      temperature: config.temperature,
      system: [{ type: 'text', text: config.promptA2 || AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}`,
      }],
    }), { onRetry: (a, _e, d) => logger.warn({ bidId }, `[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    const agent2Output = extractText(resp);
    const agent2ToStore = extractJSONText(agent2Output) ?? agent2Output;

    await pool.query(
      `UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1, usage_agent2=$2, model_agent2=$3 WHERE bid_id=$4`,
      [agent2ToStore, JSON.stringify(resp.usage), config.modelA2, bidId]
    );
    return agent2Output;
  } catch (err) {
    const message = `Agent 2 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 2 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent2_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return null;
  }
}

// ── Agent 3: QC review ─────────────────────────────────────────────────────────
async function runAgent3(
  bidId: string,
  client: Anthropic,
  config: AIConfig,
  agent1Output: string,
  agent2Output: string
): Promise<void> {
  try {
    await pool.query(`UPDATE takeoff_results SET status='agent3_running' WHERE bid_id=$1`, [bidId]);
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA3,
      max_tokens: config.maxTokensA3,
      temperature: config.temperature,
      system: [{ type: 'text', text: config.promptA3 || AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}\n\n---\n\nESTIMATOR OUTPUT:\n\n${agent2Output}`,
      }],
    }), { onRetry: (a, _e, d) => logger.warn({ bidId }, `[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
    const agent3Output = extractText(resp);
    const agent3ToStore = extractJSONText(agent3Output) ?? agent3Output;

    // Final write — all three complete
    await pool.query(`
      UPDATE takeoff_results SET
        status='complete',
        agent3_output=$1,
        raw_response=$2,
        usage_agent3=$3,
        model_agent3=$4
      WHERE bid_id=$5
    `, [agent3ToStore, agent1Output, JSON.stringify(resp.usage), config.modelA3, bidId]);

    // Also persist structured fields from agent1 JSON for backward compatibility
    const a1 = parseAIJSON(agent1Output) ?? {};
    await pool.query(`
      UPDATE takeoff_results SET
        scope=$1, materials=$2
      WHERE bid_id=$3
    `, [
      JSON.stringify(a1.panels ?? []),
      JSON.stringify(a1.lighting ?? []),
      bidId,
    ]);

    // Fire-and-forget: upload scope extraction JSON to Drive
    (async () => {
      try {
        const { rows: bidRows } = await pool.query(
          'SELECT name, drive_estimates_folder_id FROM bids WHERE id=$1',
          [bidId],
        );
        if (!bidRows.length || !bidRows[0].drive_estimates_folder_id) return;
        const bid = bidRows[0];
        const date = new Date().toISOString().split('T')[0];
        const payload = {
          job: bid.name,
          generated: date,
          drawing_analysis: parseAIJSON(agent1Output) ?? agent1Output,
          scope_and_estimate: agent2Output,
          qc_review: agent3Output,
        };
        await uploadFile(
          `Scope — ${bid.name} — ${date}.json`,
          'application/json',
          Buffer.from(JSON.stringify(payload, null, 2)),
          bid.drive_estimates_folder_id,
        );
      } catch (err) {
        logger.error({ err, bidId }, '[drive] Scope JSON upload failed');
      }
    })();
  } catch (err) {
    const message = `Agent 3 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 3 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent3_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
  }
}

// ── Entry points ───────────────────────────────────────────────────────────────

/** Fresh full run: Agent 1 from uploaded files, then Agents 2 and 3. */
export async function runPipeline(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig
): Promise<void> {
  const stopHeartbeat = startHeartbeat(bidId);
  try {
    const agent1Output = await runAgent1(bidId, files, client, config);
    if (agent1Output == null) return;
    const agent2Output = await runAgent2(bidId, client, config, agent1Output);
    if (agent2Output == null) return;
    await runAgent3(bidId, client, config, agent1Output, agent2Output);
  } finally {
    stopHeartbeat();
  }
}

/** Recovery resume: re-run from Agent 2 using the persisted Agent 1 output. */
export async function resumeFromAgent2(
  bidId: string,
  client: Anthropic,
  config: AIConfig,
  agent1Output: string
): Promise<void> {
  const stopHeartbeat = startHeartbeat(bidId);
  try {
    const agent2Output = await runAgent2(bidId, client, config, agent1Output);
    if (agent2Output == null) return;
    await runAgent3(bidId, client, config, agent1Output, agent2Output);
  } finally {
    stopHeartbeat();
  }
}

/** Recovery resume: re-run Agent 3 using the persisted Agent 1 + 2 outputs. */
export async function resumeFromAgent3(
  bidId: string,
  client: Anthropic,
  config: AIConfig,
  agent1Output: string,
  agent2Output: string
): Promise<void> {
  const stopHeartbeat = startHeartbeat(bidId);
  try {
    await runAgent3(bidId, client, config, agent1Output, agent2Output);
  } finally {
    stopHeartbeat();
  }
}

// ── Agent 4: proposal formatter ────────────────────────────────────────────────

export interface Agent4Args {
  price: string;
  internalNotes: string | null;
  agent1Output: string;
  agent2Output: string;
}

/**
 * Run the Agent 4 proposal formatter and persist the result. The caller must
 * have already set agent4_status='running' (with agent4_price/agent4_notes, so
 * recovery can re-run an interrupted job). Never throws.
 */
export async function runAgent4(
  bidId: string,
  client: Anthropic,
  config: AIConfig,
  args: Agent4Args
): Promise<void> {
  const userMsg = [
    `PROPOSAL REQUEST`,
    ``,
    `Total Bid Price: ${args.price.trim()}`,
    ``,
    `Internal Notes from Estimator:`,
    (args.internalNotes?.trim() || '(none)'),
    ``,
    `--- DRAWING ANALYSIS (Agent 1) ---`,
    args.agent1Output.slice(0, 8000),
    ``,
    `--- SCOPE & ESTIMATE (Agent 2) ---`,
    args.agent2Output,
  ].join('\n');

  const stopHeartbeat = startHeartbeat(bidId);
  try {
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA4,
      max_tokens: config.maxTokensA4,
      temperature: config.temperature,
      system: [{ type: 'text', text: config.promptA4 || AGENT4_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }), { onRetry: (a, _e, d) => logger.warn(`[agent4] retry ${a} in ${d}ms`) });

    const rawText = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
    const parsed = parseAIJSON(rawText);
    if (!parsed) {
      logger.warn({ bidId, preview: rawText.slice(0, 300) }, '[agent4] Could not parse JSON from response');
      await pool.query(
        `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
        ['AI response could not be parsed as valid JSON — the output may have been cut off. Try re-running Agent 4.', bidId]
      );
      return;
    }
    await pool.query(
      `UPDATE takeoff_results SET
        agent4_output=$1, agent4_price=$2, agent4_notes=$3,
        agent4_model=$4, usage_agent4=$5,
        agent4_status='complete', agent4_error=NULL
      WHERE bid_id=$6`,
      [JSON.stringify(parsed), args.price.trim(), args.internalNotes?.trim() || null, config.modelA4, JSON.stringify(resp.usage), bidId]
    );
    logger.info({ bidId }, '[agent4] Proposal generated successfully');
  } catch (err) {
    logger.error({ err, bidId }, '[agent4] Background run failed');
    const message = err instanceof Error ? err.message : 'Unknown error during proposal generation';
    await pool.query(
      `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
      [message, bidId]
    ).catch(dbErr => logger.error({ err: dbErr, bidId }, '[agent4] Could not persist failure'));
  } finally {
    stopHeartbeat();
  }
}
