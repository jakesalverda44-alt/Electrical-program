import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, AuthRequest, ownScopeId } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { getSetting } from '../db/getSetting';
import Anthropic from '@anthropic-ai/sdk';
import AdmZip from 'adm-zip';
import { AGENT1_SYSTEM, AGENT2_SYSTEM, AGENT3_SYSTEM, AGENT4_SYSTEM } from '../ai/prompts';
import { buildProposalDocx, ProposalJSON } from '../utils/proposalDocx';
import { callWithRetry } from '../ai/retry';
import { parseAIJSON, extractJSONText } from '../ai/json';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { drawingUpload } from '../utils/upload';
import { uploadFile, getFileMedia } from '../services/googleDrive';

const router = Router();
const upload = drawingUpload;

interface AIConfig {
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

async function loadAIConfig(): Promise<AIConfig> {
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

function describeAIError(err: unknown): string {
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

function isElectricalSheet(filename: string): boolean {
  const base = filename.replace(/\.[^.]+$/, '');
  if (ELEC_INCLUDE.test(base)) return true;
  if (EXCLUDE_ONLY.test(base)) return false;
  return true; // uncertain — include
}


// ── Helper: extract text from Anthropic response ──────────────────────────────
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

// ── Background pipeline ───────────────────────────────────────────────────────
async function runPipeline(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig
): Promise<void> {
  let agent1Output = '';
  let agent2Output = '';
  let agent3Output = '';

  const updateStatus = (status: string) =>
    pool.query(`UPDATE takeoff_results SET status=$1 WHERE bid_id=$2`, [status, bidId]);

  // ── Agent 1 ─────────────────────────────────────────────────────────────────
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
      const contentBlocks: Anthropic.MessageParam['content'] = [];
      for (const f of filesToSend) {
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
      , { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
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
      let batchUsage = { input_tokens: 0, output_tokens: 0 };

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const contentBlocks: Anthropic.MessageParam['content'] = [];
        for (const f of batch) {
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
        , { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
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
      console.error('[takeoff] Agent 1 JSON parse failed');
      return;
    }
    agent1JSON = parsedAgent1;

    await pool.query(
      `UPDATE takeoff_results SET status='agent1_complete', agent1_output=$1 WHERE bid_id=$2`,
      [agent1Output, bidId]
    );
  } catch (err) {
    const message = `Agent 1 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 1 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  // ── Agent 2 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent2_running');
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA2,
      max_tokens: config.maxTokensA2,
      temperature: config.temperature,
      system: [{ type: 'text', text: config.promptA2 || AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    agent2Output = extractText(resp);
    const agent2ToStore = extractJSONText(agent2Output) ?? agent2Output;

    await pool.query(
      `UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1, usage_agent2=$2, model_agent2=$3 WHERE bid_id=$4`,
      [agent2ToStore, JSON.stringify(resp.usage), config.modelA2, bidId]
    );
  } catch (err) {
    const message = `Agent 2 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 2 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent2_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  // ── Agent 3 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent3_running');
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA3,
      max_tokens: config.maxTokensA3,
      temperature: config.temperature,
      system: [{ type: 'text', text: config.promptA3 || AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}\n\n---\n\nESTIMATOR OUTPUT:\n\n${agent2Output}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
    agent3Output = extractText(resp);
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
        console.error('[drive] Scope JSON upload failed:', err);
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

// ── Routes ────────────────────────────────────────────────────────────────────

// GET hardcoded default system prompts (for display in Settings)
router.get('/prompt-defaults', requireAuth, (_req, res) => {
  res.json({ agent1: AGENT1_SYSTEM, agent2: AGENT2_SYSTEM, agent3: AGENT3_SYSTEM, agent4: AGENT4_SYSTEM });
});

// GET all workspaces (for restoring state on app load). Restricted reps only get
// workspaces for bids they own; managers/admins see all.
router.get('/workspaces', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const { rows } = scope
    ? await pool.query(
        `SELECT w.* FROM bid_workspaces w
         JOIN bids b ON b.id = w.bid_id
         WHERE b.salesperson_id = $1 AND b.deleted_at IS NULL`,
        [scope]
      )
    : await pool.query('SELECT * FROM bid_workspaces');
  res.json(rows);
});

// PUT workspace (upsert)
router.put('/:bidId/workspace', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const { step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, confirmed_service } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO bid_workspaces (bid_id, step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, confirmed_service, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       step=$2, active_tab=$3, notes=$4, scope=$5, rfis=$6, files=$7,
       ai_done=$8, proposal_generated=$9, confirmed_service=$10, updated_at=now()
     RETURNING *`,
    [bidId, step||'intake', active_tab||'overview', notes||'',
     JSON.stringify(scope||{}), JSON.stringify(rfis||[]), JSON.stringify(files||[]),
     !!ai_done, !!proposal_generated,
     confirmed_service ? JSON.stringify(confirmed_service) : null]
  );
  res.json(rows[0]);
});

// GET results for a bid
router.get('/:bidId/results', requireAuth, requireAIPermission('view_results'), async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const { rows } = await pool.query(
    'SELECT * FROM takeoff_results WHERE bid_id=$1',
    [req.params.bidId]
  );
  res.json(rows[0] || null);
});

// GET historical cost comps from real won jobs data
router.get('/costs', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT b.name, b.amount, b.sheets, b.gc, b.loc, b.sq_ft, b.project_type,
           EXTRACT(YEAR FROM b.updated_at) as year,
           be.subtotals, be.confidence
    FROM bids b
    LEFT JOIN bid_estimates be ON be.bid_id = b.id
    WHERE b.stage = 'awarded' AND b.amount IS NOT NULL AND b.deleted_at IS NULL
    ORDER BY b.updated_at DESC
    LIMIT 30
  `);
  res.json(rows);
});

// GET bid intelligence stats
router.get('/intelligence/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const { rows: gcStats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost,
      COUNT(*) FILTER (WHERE stage IN ('awarded','lost')) as total,
      AVG(amount) FILTER (WHERE stage='awarded') as avg_won_amount
    FROM bids WHERE gc=$1 AND deleted_at IS NULL
  `, [bid.gc]);

  const { rows: overall } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost
    FROM bids WHERE deleted_at IS NULL
  `);

  const gc = gcStats[0];
  const ov = overall[0];
  const gcWinRate = gc.total > 0 ? Math.round((gc.won / gc.total) * 100) : null;
  const overallWinRate = (Number(ov.won) + Number(ov.lost)) > 0
    ? Math.round((Number(ov.won) / (Number(ov.won) + Number(ov.lost))) * 100) : null;

  res.json({
    gc: bid.gc,
    gcWinRate,
    gcWins: Number(gc.won),
    gcLosses: Number(gc.lost),
    gcAvgWonAmount: gc.avg_won_amount ? Math.round(gc.avg_won_amount) : null,
    overallWinRate,
  });
});

// POST analyze — 3-agent sequential pipeline
router.post('/analyze', requireAuth, requireAIPermission('run_analysis'), upload.array('files', 50), asyncHandler(async (req: AuthRequest, res) => {
  const bidId = req.body.bidId;
  if (!bidId) return res.status(400).json({ error: 'bidId required' });

  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const rawFiles = (req.files as Express.Multer.File[]) ?? [];

  // Expand any zip archives into their constituent PDF/image files
  const files: Express.Multer.File[] = [];
  for (const f of rawFiles) {
    if (f.originalname.toLowerCase().endsWith('.zip')) {
      try {
        const zip = new AdmZip(f.buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const n = entry.name.toLowerCase();
          if (!n.endsWith('.pdf') && !n.endsWith('.jpg') && !n.endsWith('.jpeg') && !n.endsWith('.png')) continue;
          files.push({
            ...f,
            originalname: entry.name,
            buffer: entry.getData(),
            size: entry.header.size,
            mimetype: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          });
        }
      } catch { /* corrupt or unreadable zip — skip */ }
    } else {
      files.push(f);
    }
  }
  // Also pull in any documents already attached to this bid
  const rawDocIds = req.body.document_ids;
  const docIds: string[] = Array.isArray(rawDocIds)
    ? (rawDocIds as string[]).filter(Boolean)
    : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];

  for (const docId of docIds) {
    try {
      const { rows: docRows } = await pool.query(
        'SELECT name, file_type, file_data, storage_url FROM documents WHERE id=$1 AND deleted_at IS NULL',
        [docId]
      );
      const doc = docRows[0];
      if (!doc) continue;

      const fname = doc.name as string;
      const ftype = (doc.file_type as string) || 'application/octet-stream';
      let buf: Buffer | null = null;

      if (doc.file_data) {
        buf = Buffer.from(doc.file_data as string, 'base64');
      } else if (doc.storage_url) {
        const driveMatch = (doc.storage_url as string).match(/\/file\/d\/([^/?#]+)/);
        if (driveMatch) {
          const media = await getFileMedia(driveMatch[1]);
          if (media) {
            buf = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              media.stream.on('data', (c: Buffer) => chunks.push(c));
              media.stream.on('end', () => resolve(Buffer.concat(chunks)));
              media.stream.on('error', reject);
            });
          }
        } else {
          const resp = await fetch(doc.storage_url as string);
          if (resp.ok) buf = Buffer.from(await resp.arrayBuffer());
        }
      }

      if (!buf) continue;
      files.push({
        fieldname: 'files',
        originalname: fname,
        encoding: '7bit',
        mimetype: ftype,
        buffer: buf,
        size: buf.length,
        stream: undefined,
        destination: '',
        filename: fname,
        path: '',
      } as unknown as Express.Multer.File);
    } catch (err) {
      logger.warn({ err, docId }, '[takeoff] could not load document, skipping');
    }
  }

  if (!files.length) {
    return res.status(400).json({ error: 'Upload at least one plan file, or select files from Project Files, before running AI analysis.' });
  }

  // Prefer the key configured in Settings -> AI; fall back to the env var.
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' });
  }
  const aiConfig = await loadAIConfig();

  // Mark as running
  await pool.query(`
    INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')
    ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now(),
      agent1_output=NULL, agent2_output=NULL, agent3_output=NULL
  `, [bidId]);

  // Log AI usage for rate limiting and audit
  await pool.query(
    `INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_analysis','preconstruction',$1,$2)`,
    [`Plan analysis for ${bid.name || bidId} (${files.length} files) by ${req.user?.name}`, req.user?.id]
  ).catch(() => {}); // non-fatal

  // Count electrical sheets for immediate response
  const electricalCount = files.filter(f => isElectricalSheet(f.originalname)).length || files.length;

  // Respond immediately, run pipeline in background
  res.json({
    status: 'running',
    message: 'Analysis started',
    totalFiles: files.length,
    electricalSheets: electricalCount,
  });

  const client = new Anthropic({ apiKey });
  logger.info({ bidId, model: aiConfig.model, modelA2: aiConfig.modelA2, modelA3: aiConfig.modelA3 }, 'AI takeoff pipeline started');
  runPipeline(bidId, files, client, aiConfig).catch(async err => {
    const message = `Pipeline failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff pipeline failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', raw_response=$1 WHERE bid_id=$2`,
      [message, bidId]
    ).catch(dbErr => logger.error({ err: dbErr, bidId }, 'Could not persist takeoff pipeline failure'));
  });
}));

// POST run-agent4 — kicks off Proposal Formatter in background, returns immediately
// Frontend polls GET /:bidId/results and watches agent4_status for completion.
router.post('/:bidId/run-agent4', requireAuth, requireAIPermission('run_analysis'), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const { price, internalNotes } = req.body as { price?: string; internalNotes?: string };

  if (!price?.trim()) return res.status(400).json({ error: 'price is required' });
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const { rows: trRows } = await pool.query(
    'SELECT agent1_output, agent2_output FROM takeoff_results WHERE bid_id=$1',
    [bidId]
  );
  if (!trRows.length || !trRows[0].agent2_output) {
    return res.status(400).json({ error: 'No scope data found. Run the 3-agent analysis first.' });
  }

  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'Anthropic API key not configured.' });

  const config = await loadAIConfig();
  const client = new Anthropic({ apiKey });

  const agent1Output = (trRows[0].agent1_output as string) || '';
  const agent2Output = (trRows[0].agent2_output as string) || '';

  // Mark as running and respond immediately — don't wait for AI
  await pool.query(
    `UPDATE takeoff_results SET agent4_status='running', agent4_error=NULL, agent4_output=NULL WHERE bid_id=$1`,
    [bidId]
  );
  res.json({ status: 'running' });

  // Run AI call in background
  const userMsg = [
    `PROPOSAL REQUEST`,
    ``,
    `Total Bid Price: ${price.trim()}`,
    ``,
    `Internal Notes from Estimator:`,
    (internalNotes?.trim() || '(none)'),
    ``,
    `--- DRAWING ANALYSIS (Agent 1) ---`,
    agent1Output.slice(0, 8000),
    ``,
    `--- SCOPE & ESTIMATE (Agent 2) ---`,
    agent2Output,
  ].join('\n');

  (async () => {
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
        [JSON.stringify(parsed), price.trim(), internalNotes?.trim() || null, config.modelA4, JSON.stringify(resp.usage), bidId]
      );
      logger.info({ bidId }, '[agent4] Proposal generated successfully');
    } catch (err) {
      logger.error({ err, bidId }, '[agent4] Background run failed');
      const message = err instanceof Error ? err.message : 'Unknown error during proposal generation';
      await pool.query(
        `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
        [message, bidId]
      );
    }
  })().catch(err => logger.error({ err, bidId }, '[agent4] Uncaught background error'));
}));

// GET generate-docx — build and return the .docx proposal file
router.get('/:bidId/generate-docx', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const { rows: trRows } = await pool.query(
    'SELECT agent4_output FROM takeoff_results WHERE bid_id=$1',
    [bidId]
  );
  if (!trRows.length || !trRows[0].agent4_output) {
    return res.status(404).json({ error: 'No proposal data found. Run Agent 4 first.' });
  }

  let proposalData: ProposalJSON;
  try {
    const raw = trRows[0].agent4_output as string;
    const parsed = parseAIJSON(raw);
    if (!parsed) return res.status(422).json({ error: 'Proposal data could not be parsed. Re-run Agent 4 to regenerate.' });
    proposalData = parsed as unknown as ProposalJSON;
  } catch {
    return res.status(422).json({ error: 'Proposal data is not valid JSON. Re-run Agent 4 to regenerate.' });
  }

  const { rows: bidRows } = await pool.query(
    'SELECT name, loc, gc, contact FROM bids WHERE id=$1 AND deleted_at IS NULL',
    [bidId]
  );
  const bid = bidRows[0] as { name?: string; loc?: string; gc?: string; contact?: string } | undefined;
  const bidName = bid?.name ?? bidId;
  // HTTP headers must be Latin-1. Strip any non-ASCII (em dashes, accents, etc.)
  // from the filename or res.setHeader throws ERR_INVALID_CHAR.
  const asciiName = bidName.replace(/[^\x20-\x7E]/g, '').trim() || 'proposal';
  const filename = `Proposal - ${asciiName}.docx`.replace(/[<>:"/\\|?*\r\n]/g, '-');

  let buf: Buffer;
  try {
    // The bid record is the authoritative source for the project name — Agent 4's
    // generated projectName is ignored in favor of what the estimator entered.
    buf = await buildProposalDocx(proposalData, {
      projectName: bid?.name,
      projectAddress: bid?.loc,
      gcName: bid?.gc,
      gcContact: bid?.contact,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-docx] buildProposalDocx threw');
    return res.status(500).json({ error: `Document build failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
}));

export default router;
