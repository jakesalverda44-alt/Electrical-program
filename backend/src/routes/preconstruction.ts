import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, AuthRequest } from '../middleware/auth';
import { getSetting } from '../db/getSetting';
import Anthropic from '@anthropic-ai/sdk';
import AdmZip from 'adm-zip';
import { AGENT1_SYSTEM, AGENT2_SYSTEM, AGENT3_SYSTEM } from '../ai/prompts';
import { callWithRetry } from '../ai/retry';
import { parseAIJSON } from '../ai/json';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { drawingUpload } from '../utils/upload';
import { uploadFile, getFileMedia } from '../services/googleDrive';

const router = Router();
const upload = drawingUpload;

interface AIConfig {
  model: string;       // Agent 1 — vision model (reads plan images/PDFs)
  modelA2: string;     // Agent 2 — scope & estimate
  modelA3: string;     // Agent 3 — QA review
  maxTokens: number;
  temperature: number;
}

const DEFAULT_AI_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_TEMPERATURE = 0.3;

function parseNumberSetting(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function loadAIConfig(): Promise<AIConfig> {
  const [modelSetting, modelA2Setting, modelA3Setting, maxTokensSetting, temperatureSetting] = await Promise.all([
    getSetting('ai_model'),
    getSetting('ai_takeoff_agent2_model'),
    getSetting('ai_takeoff_agent3_model'),
    getSetting('ai_max_tokens'),
    getSetting('ai_temperature'),
  ]);
  const defaultText = 'claude-haiku-4-5-20251001';
  return {
    model:    (modelSetting    || process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL).trim(),
    modelA2:  (modelA2Setting  || defaultText).trim(),
    modelA3:  (modelA3Setting  || defaultText).trim(),
    maxTokens: parseNumberSetting(maxTokensSetting || process.env.AI_MAX_TOKENS || '', DEFAULT_MAX_TOKENS, 256, 64000),
    temperature: parseNumberSetting(temperatureSetting || process.env.AI_TEMPERATURE || '', DEFAULT_TEMPERATURE, 0, 1),
  };
}

function describeAIError(err: unknown): string {
  const e = err as { message?: string; status?: number; error?: { message?: string }; response?: { data?: { error?: string; message?: string } } };
  const status = e.status ? `Anthropic ${e.status}` : 'AI request failed';
  const detail = e.error?.message || e.response?.data?.error || e.response?.data?.message || e.message || 'Unknown error';
  return `${status}: ${detail}`;
}

// ── Electrical sheet filter ────────────────────────────────────────────────────
const ELEC_INCLUDE = /^E\d|electrical|one.?line|panel.?sched|equip.?sched/i;
const EXCLUDE_ONLY = /^(A|S|C|L|M)\d/i;

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
  config: AIConfig,
  resumeAgent1Output?: string  // if provided, skip Agent 1 and reuse saved output
): Promise<void> {
  let agent1Output = '';
  let agent2Output = '';
  let agent3Output = '';

  const updateStatus = (status: string) =>
    pool.query(`UPDATE takeoff_results SET status=$1 WHERE bid_id=$2`, [status, bidId]);

  // ── Agent 1 ─────────────────────────────────────────────────────────────────
  if (resumeAgent1Output) {
    agent1Output = resumeAgent1Output;
    await updateStatus('agent1_complete');
  } else try {
    // Filter to electrical sheets
    const electricalFiles = files.filter(f => isElectricalSheet(f.originalname));
    const filesToSend = electricalFiles.length > 0 ? electricalFiles : files;

    // Build document/image blocks
    // If multiple PDFs are present, process one per batch — each PDF may have many pages
    // and combined output easily exceeds the 64K token hard limit.
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
        text: 'Analyze all uploaded electrical plans and provide your complete Drawing Analyzer output following your output format exactly. Return JSON only.',
      });

      const resp = await callWithRetry(() => client.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: [{ type: 'text', text: AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: contentBlocks }],
      }).finalMessage(), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
      agent1Output = extractText(resp);

    } else {
      // Batched: split into groups of BATCH_SIZE, merge JSON
      const batches: Express.Multer.File[][] = [];
      for (let i = 0; i < filesToSend.length; i += BATCH_SIZE) {
        batches.push(filesToSend.slice(i, i + BATCH_SIZE));
      }
      const batchResults: Record<string, unknown>[] = [];

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
          text: `Analyze batch ${bi + 1} of ${batches.length} electrical plan files and provide Drawing Analyzer JSON output. Return JSON only.`,
        });

        const bResp = await callWithRetry(() => client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          system: [{ type: 'text', text: AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contentBlocks }],
        }).finalMessage(), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
        const bText = extractText(bResp);
        const parsed = parseAIJSON(bText);
        if (parsed) batchResults.push(parsed);
      }

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
      const looksLikeJSON = agent1Output.trim().startsWith('```') || agent1Output.trim().startsWith('{');
      const stopHint = looksLikeJSON
        ? `Agent 1 output was cut off before the JSON closed — the response exceeded the ${config.maxTokens.toLocaleString()}-token output limit. ` +
          `This usually means a single file contains too many sheets. ` +
          `Try splitting the plan set into separate PDFs (e.g. one per discipline or 20 sheets each) and uploading them individually.`
        : 'Agent 1 did not return JSON. Check that the uploaded files are readable electrical plan PDFs.';
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
  } // end Agent 1 else-try

  // ── Agent 2 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent2_running');
    const resp = await callWithRetry(() => client.messages.stream({
      model: config.modelA2,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: [{ type: 'text', text: AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}`,
      }],
    }).finalMessage(), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    agent2Output = extractText(resp);

    await pool.query(
      `UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1 WHERE bid_id=$2`,
      [agent2Output, bidId]
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
    const resp = await callWithRetry(() => client.messages.stream({
      model: config.modelA3,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: [{ type: 'text', text: AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}\n\n---\n\nESTIMATOR OUTPUT:\n\n${agent2Output}`,
      }],
    }).finalMessage(), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
    agent3Output = extractText(resp);

    // Final write — all three complete
    await pool.query(`
      UPDATE takeoff_results SET
        status='complete',
        agent3_output=$1,
        raw_response=$2
      WHERE bid_id=$3
    `, [agent3Output, agent1Output, bidId]);

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

// GET all workspaces (for restoring state on app load)
router.get('/workspaces', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM bid_workspaces');
  res.json(rows);
});

// PUT workspace (upsert)
router.put('/:bidId/workspace', requireAuth, async (req, res) => {
  const { bidId } = req.params;
  const { step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO bid_workspaces (bid_id, step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       step=$2, active_tab=$3, notes=$4, scope=$5, rfis=$6, files=$7,
       ai_done=$8, proposal_generated=$9, updated_at=now()
     RETURNING *`,
    [bidId, step||'intake', active_tab||'overview', notes||'',
     JSON.stringify(scope||{}), JSON.stringify(rfis||[]), JSON.stringify(files||[]),
     !!ai_done, !!proposal_generated]
  );
  res.json(rows[0]);
});

// GET results for a bid
const RUNNING_STATUSES = ['running', 'agent1_complete', 'agent2_running', 'agent2_complete', 'agent3_running'];
const STALE_RUN_MS = 30 * 60 * 1000; // a real pipeline finishes well within 30 min

router.get('/:bidId/results', requireAuth, requireAIPermission('view_results'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM takeoff_results WHERE bid_id=$1',
    [req.params.bidId]
  );
  let row = rows[0] || null;
  // Self-heal stale runs: a row still "running" long after it started was almost
  // certainly killed by a server restart/redeploy (which silently kills the background
  // pipeline). Flip it to error so the UI stops showing "reconnecting…" indefinitely.
  if (row && RUNNING_STATUSES.includes(row.status) && row.created_at &&
      Date.now() - new Date(row.created_at).getTime() > STALE_RUN_MS) {
    const msg = 'Analysis was interrupted before it finished (the server may have restarted). Please run it again.';
    const { rows: upd } = await pool.query(
      `UPDATE takeoff_results SET status='error', raw_response=$1 WHERE bid_id=$2 RETURNING *`,
      [msg, req.params.bidId]
    );
    row = upd[0] || row;
  }
  res.json(row);
});

// GET historical cost comps from real won jobs data
router.get('/costs', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT b.name, b.amount, b.sheets, b.gc, b.loc,
           EXTRACT(YEAR FROM b.updated_at) as year
    FROM bids b
    WHERE b.stage = 'awarded' AND b.amount IS NOT NULL AND b.deleted_at IS NULL
    ORDER BY b.updated_at DESC
    LIMIT 20
  `);
  res.json(rows);
});

// GET bid intelligence stats
router.get('/intelligence/:bidId', requireAuth, async (req, res) => {
  const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE id=$1 AND deleted_at IS NULL', [req.params.bidId]);
  if (!bidRows.length) return res.status(404).json({ error: 'Bid not found' });
  const bid = bidRows[0];

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

  const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE id=$1 AND deleted_at IS NULL', [bidId]);
  if (!bidRows.length) return res.status(404).json({ error: 'Bid not found' });

  // Check for resume mode — reuse saved Agent 1 output, skip re-reading plans
  const resume = req.body.resume === 'true' || req.body.resume === true;
  let resumeAgent1Output: string | undefined;
  if (resume) {
    const { rows: prev } = await pool.query(
      `SELECT agent1_output FROM takeoff_results WHERE bid_id=$1
       AND status IN ('agent1_complete','agent2_running','agent2_complete','agent3_running','complete')
       AND agent1_output IS NOT NULL AND length(agent1_output) > 50`,
      [bidId]
    );
    resumeAgent1Output = prev[0]?.agent1_output || undefined;
  }

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

  if (!files.length && !resumeAgent1Output) {
    return res.status(400).json({ error: 'Upload at least one plan file, or select files from Project Files, before running AI analysis.' });
  }

  // Prefer the key configured in Settings -> AI; fall back to the env var.
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' });
  }
  const aiConfig = await loadAIConfig();

  // Mark as running — preserve agent1_output when resuming
  if (resumeAgent1Output) {
    await pool.query(`
      UPDATE takeoff_results SET status='running', agent2_output=NULL, agent3_output=NULL WHERE bid_id=$1
    `, [bidId]);
  } else {
    await pool.query(`
      INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')
      ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now(),
        agent1_output=NULL, agent2_output=NULL, agent3_output=NULL
    `, [bidId]);
  }

  // Log AI usage for rate limiting and audit
  await pool.query(
    `INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_analysis','preconstruction',$1,$2)`,
    [`Plan analysis for ${bidRows[0].name || bidId} (${files.length} files) by ${req.user?.name}`, req.user?.id]
  ).catch(() => {}); // non-fatal

  // Count electrical sheets for immediate response
  const electricalCount = files.filter(f => isElectricalSheet(f.originalname)).length || files.length;

  // Respond immediately, run pipeline in background
  res.json({
    status: 'running',
    message: resumeAgent1Output ? 'Resuming from Agent 2 — plan data already saved' : 'Analysis started',
    totalFiles: files.length,
    electricalSheets: electricalCount,
    resumed: !!resumeAgent1Output,
  });

  const client = new Anthropic({ apiKey });
  logger.info({ bidId, model: aiConfig.model, maxTokens: aiConfig.maxTokens, resumed: !!resumeAgent1Output }, 'AI takeoff pipeline started');
  runPipeline(bidId, files, client, aiConfig, resumeAgent1Output).catch(async err => {
    const message = `Pipeline failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff pipeline failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', raw_response=$1 WHERE bid_id=$2`,
      [message, bidId]
    ).catch(dbErr => logger.error({ err: dbErr, bidId }, 'Could not persist takeoff pipeline failure'));
  });
}));

export default router;
