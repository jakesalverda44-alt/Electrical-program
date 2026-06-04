import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, AuthRequest } from '../middleware/auth';
import { getSetting } from '../db/getSetting';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { AGENT1_SYSTEM, AGENT2_SYSTEM, AGENT3_SYSTEM } from '../ai/prompts';
import { callWithRetry } from '../ai/retry';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// ── Background pipeline ───────────────────────────────────────────────────────
async function runPipeline(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic
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

    // Build document/image blocks
    const BATCH_SIZE = 20;
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

      const resp = await callWithRetry(() => client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 8192,
        system: [{ type: 'text', text: AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: contentBlocks }],
      }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
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

        const bResp = await callWithRetry(() => client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 8192,
          system: [{ type: 'text', text: AGENT1_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contentBlocks }],
        }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
        const bText = extractText(bResp);
        const bMatch = bText.match(/\{[\s\S]*\}/);
        if (bMatch) {
          try { batchResults.push(JSON.parse(bMatch[0])); } catch { /* skip bad batch */ }
        }
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
    const jsonMatch = agent1Output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [agent1Output, bidId]
      );
      console.error('[takeoff] Agent 1 returned no JSON');
      return;
    }
    try {
      agent1JSON = JSON.parse(jsonMatch[0]);
    } catch {
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [agent1Output, bidId]
      );
      console.error('[takeoff] Agent 1 JSON parse failed');
      return;
    }

    await pool.query(
      `UPDATE takeoff_results SET status='agent1_complete', agent1_output=$1 WHERE bid_id=$2`,
      [agent1Output, bidId]
    );
  } catch (err) {
    console.error('[takeoff] Agent 1 failed:', err);
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
      [`Agent 1 failed: ${(err as Error).message}`, bidId]
    );
    return;
  }

  // ── Agent 2 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent2_running');
    const resp = await callWithRetry(() => client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: [{ type: 'text', text: AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    agent2Output = extractText(resp);

    await pool.query(
      `UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1 WHERE bid_id=$2`,
      [agent2Output, bidId]
    );
  } catch (err) {
    console.error('[takeoff] Agent 2 failed:', err);
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent2_output=$1 WHERE bid_id=$2`,
      [`Agent 2 failed: ${(err as Error).message}`, bidId]
    );
    return;
  }

  // ── Agent 3 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent3_running');
    const resp = await callWithRetry(() => client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: [{ type: 'text', text: AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}\n\n---\n\nESTIMATOR OUTPUT:\n\n${agent2Output}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
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
    const a1 = JSON.parse(agent1Output.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Record<string, unknown>;
    await pool.query(`
      UPDATE takeoff_results SET
        scope=$1, materials=$2
      WHERE bid_id=$3
    `, [
      JSON.stringify(a1.panels ?? []),
      JSON.stringify(a1.lighting ?? []),
      bidId,
    ]);
  } catch (err) {
    console.error('[takeoff] Agent 3 failed:', err);
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent3_output=$1 WHERE bid_id=$2`,
      [`Agent 3 failed: ${(err as Error).message}`, bidId]
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
router.get('/:bidId/results', requireAuth, requireAIPermission('view_results'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM takeoff_results WHERE bid_id=$1',
    [req.params.bidId]
  );
  res.json(rows[0] || null);
});

// GET historical cost comps from real won jobs data
router.get('/costs', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT b.name, b.amount, b.sheets, b.gc, b.loc,
           EXTRACT(YEAR FROM b.updated_at) as year
    FROM bids b
    WHERE b.stage = 'awarded' AND b.amount IS NOT NULL
    ORDER BY b.updated_at DESC
    LIMIT 20
  `);
  res.json(rows);
});

// GET bid intelligence stats
router.get('/intelligence/:bidId', requireAuth, async (req, res) => {
  const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE id=$1', [req.params.bidId]);
  if (!bidRows.length) return res.status(404).json({ error: 'Bid not found' });
  const bid = bidRows[0];

  const { rows: gcStats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost,
      COUNT(*) FILTER (WHERE stage IN ('awarded','lost')) as total,
      AVG(amount) FILTER (WHERE stage='awarded') as avg_won_amount
    FROM bids WHERE gc=$1
  `, [bid.gc]);

  const { rows: overall } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost
    FROM bids
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
router.post('/analyze', requireAuth, requireAIPermission('run_analysis'), upload.array('files', 50), async (req: AuthRequest, res) => {
  const bidId = req.body.bidId;
  if (!bidId) return res.status(400).json({ error: 'bidId required' });

  const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
  if (!bidRows.length) return res.status(404).json({ error: 'Bid not found' });

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

  // Prefer the key configured in Settings → AI; fall back to the env var.
  const apiKey = (await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis not configured. Add an Anthropic API key in Settings → AI (or set ANTHROPIC_API_KEY).' });
  }

  // Mark as running
  await pool.query(`
    INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')
    ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now(),
      agent1_output=NULL, agent2_output=NULL, agent3_output=NULL
  `, [bidId]);

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
    message: 'Analysis started',
    totalFiles: files.length,
    electricalSheets: electricalCount,
  });

  const client = new Anthropic({ apiKey });
  runPipeline(bidId, files, client).catch(err => {
    console.error('[takeoff] Pipeline error:', err);
  });
});

export default router;
