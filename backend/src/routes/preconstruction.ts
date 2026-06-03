import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, AuthRequest } from '../middleware/auth';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import AdmZip from 'adm-zip';

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

// ── Agent system prompts ──────────────────────────────────────────────────────
const AGENT1_SYSTEM = `You are a Senior Electrical Drawing Analyzer and Quantity Extraction Specialist.

Your job is to analyze electrical plans, specifications, schedules, risers, one-line diagrams, and details and extract factual information only.

You are not an estimator.
You are not a proposal writer.
You are not a QA reviewer.
You are the source of truth for all project data.

PRIMARY OBJECTIVES
- Identify all electrical-related sheets.
- Create a complete sheet inventory.
- Identify all electrical systems.
- Extract equipment information.
- Count visible quantities.
- Extract feeder and distribution information.
- Identify missing information.

RULES
- Never estimate quantities.
- Never assume quantities if not shown.
- Never write scope language.
- Never create exclusions.
- Never create RFIs.
- Every quantity must include a source sheet reference and source page.
- Every item must include a confidence score.
- If unable to verify, mark as "unknown" and flag for manual review.
- If conflicting information exists, report all conflicts with source sheet references.
- Never invent values.

CONFIDENCE SCORE VALUES
- VERIFIED — directly readable from plans
- ASSUMED — inferred from context but not explicitly shown
- NOT SHOWN — not present in provided documents

SYSTEM IDENTIFICATION
Identify all systems shown:
- Service & Distribution
- Branch Power
- Interior Lighting
- Exterior Lighting
- Site Electrical
- Fire Alarm
- Security
- Access Control
- Tele/Data
- Sound System
- BDA/ERRS
- Generator
- EV Charging
- UPS Systems

EXTRACT

Service Information
- Voltage
- Phase
- Service size
- Metering
- Utility requirements

Distribution Equipment
- Switchboards
- Switchgear
- Panelboards
- Transformers
- ATS / Transfer Switches
- Disconnects
- Surge suppressors

Feeders & Conduit
- Feeder schedules
- Conduit sizes
- Wire sizes
- Raceway types

Lighting
- Fixture types
- Fixture quantities
- Exit signs
- Emergency fixtures

Devices
- Receptacles
- GFCIs
- Switches
- Occupancy sensors
- Photocells
- Contactors

Site
- Site lighting poles
- Pull boxes
- Handholes
- Gate operators
- Monument signs

Special Systems
- Generators
- Transfer switches
- EV charging equipment
- UPS systems

Low Voltage Infrastructure
- Security pathways
- Data pathways
- Fire alarm pathways
- BDA pathways

Notes
- Electrical notes
- General notes
- Scope requirements called out in notes

OUTPUT FORMAT
Return structured JSON only. No prose. No markdown. Pure JSON.

Use this exact structure:

{
  "project_info": {
    "project_name": "",
    "address": "",
    "sheet_count": 0,
    "electrical_sheet_count": 0
  },
  "sheet_inventory": [
    { "sheet_number": "", "title": "", "included": true, "reason_excluded": "" }
  ],
  "systems_identified": [],
  "panels": [
    {
      "name": "",
      "voltage": "",
      "phase": "",
      "ampacity": "",
      "circuits": 0,
      "source_sheet": "",
      "source_page": "",
      "confidence": "VERIFIED | ASSUMED | NOT SHOWN",
      "notes": ""
    }
  ],
  "feeders": [
    {
      "from": "",
      "to": "",
      "conduit_size": "",
      "wire_size": "",
      "wire_qty": 0,
      "source_sheet": "",
      "source_page": "",
      "confidence": ""
    }
  ],
  "transformers": [],
  "generators": [],
  "ats": [],
  "lighting": [
    {
      "type_code": "",
      "description": "",
      "qty": 0,
      "location": "",
      "source_sheet": "",
      "source_page": "",
      "confidence": ""
    }
  ],
  "devices": [],
  "equipment": [],
  "conduit": [],
  "wire": [],
  "notes": [],
  "sheet_references": [],
  "warnings": [
    {
      "type": "MISSING | CONFLICT | UNREADABLE | AMBIGUOUS",
      "description": "",
      "source_sheet": "",
      "action_required": ""
    }
  ],
  "confidence_scores": {
    "overall": 0.0,
    "panels": 0.0,
    "feeders": 0.0,
    "lighting": 0.0,
    "devices": 0.0,
    "equipment": 0.0
  }
}

Your output will be consumed directly by a downstream estimating agent as structured data.
Think like a data extraction engine, not an estimator.
Return JSON only. Nothing else.`;

const AGENT2_SYSTEM = `You are a Senior Electrical Estimator and Preconstruction Manager with over 25 years of electrical contracting experience.

You receive structured JSON extraction data from a Drawing Analyzer agent.

The Drawing Analyzer JSON is the authoritative source of quantities.
You do not recount drawings.
You do not change quantities.
You do not invent quantities.
Every quantity you report must trace back to a source sheet in the Drawing Analyzer data.

PRIMARY OBJECTIVES
- Generate a contractor-ready Scope of Work.
- Generate Exclusions.
- Generate Clarifications.
- Produce a Quantity Takeoff summary organized by trade section.
- Produce a Bill of Materials (BOM) summary.
- Generate RFIs for missing or unclear information.
- Identify missing scope, missing counts, and potential estimating concerns.

SCOPE FORMAT
A. Service & Distribution
B. Branch Power
C. Lighting & Controls
D. Site Electrical
E. Low Voltage Infrastructure
F. Fire Alarm
G. Generator & Transfer Switch
H. Coordination & Closeout

Use professional electrical contractor language suitable for customer proposals.

EXCLUSIONS
Generate exclusions for:
- Utility primary work
- Utility transformer unless specifically included
- Tele/Data cabling
- Security cabling and devices
- Access control devices
- Sound systems
- Owner furnished equipment unless noted
- Structural work
- Civil work
- Concrete cutting and patching
- Patch and paint
- Work not specifically shown on electrical drawings

CLARIFICATIONS
Generate reasonable estimating clarifications. Examples:
- Existing conditions not verified.
- Underground routing based on plans provided.
- Utility requirements subject to utility review.
- Quantities based on Drawing Analyzer extraction — field verification recommended.

RFI RULES
Generate RFIs for:
- Missing schedules
- Missing equipment ratings
- Missing conduit or wire sizes
- Conflicting notes
- Incomplete one-lines
- Items flagged as ASSUMED or NOT SHOWN by Drawing Analyzer

BILL OF MATERIALS
Summarize materials by category:
- Conduit (by type and size, with linear foot totals where calculable)
- Wire (by size, with linear foot totals where calculable)
- Panels and distribution equipment
- Lighting fixtures (by type code)
- Devices (by type)
- Specialty equipment

OUTPUT FORMAT
Return structured output with clearly labeled sections:
- Project Summary
- Scope of Work (A through H)
- Exclusions
- Clarifications
- Quantity Takeoff (with source sheet references preserved)
- Bill of Materials
- Missing Scope Identified
- Estimating Concerns
- RFI Log

IMPORTANT
Use only information supplied by the Drawing Analyzer JSON.
Do not create new quantities.
Do not modify quantities.
Do not assume equipment counts.
Every line item in the Quantity Takeoff must reference the source sheet from the Drawing Analyzer data.
Think like an electrical contractor preparing a competitive bid proposal.`;

const AGENT3_SYSTEM = `You are a Chief Electrical Estimator performing a final bid review.

You receive:
- Drawing Analyzer JSON output (Agent 1) — authoritative source for all quantities.
- Electrical Estimator output (Agent 2).

Your responsibility is to identify omissions, conflicts, risks, assumptions, and change-order exposure before this bid is submitted.

You are not responsible for generating takeoffs.
You are not responsible for rewriting scope.
You are responsible for protecting profitability and preventing scope gaps.

PRIMARY OBJECTIVES
- Verify scope completeness against Drawing Analyzer data.
- Verify quantity consistency between Agent 1 and Agent 2.
- Identify missing scope.
- Identify design conflicts.
- Identify coordination issues.
- Generate RFIs.
- Assess bid risk.
- Identify change-order opportunities.
- Verify full source traceability — every quantity in Agent 2 must trace to a sheet in Agent 1.

REVIEW AREAS

Service & Distribution
- Service sizing adequacy
- Feeder schedule consistency
- Transformer requirements
- Grounding and bonding requirements

Lighting
- Fixture schedule completeness
- Emergency lighting coverage
- Exit signage locations
- Lighting controls scope

Power
- Disconnects for all equipment
- Dedicated circuits
- HVAC power connections
- Specialty equipment power

Site Electrical
- Site lighting pole count vs. photometric plan
- Underground feeder routing
- Utility coordination requirements
- Gate operators
- Monument signs

Low Voltage
- Security pathways
- Tele/Data pathways
- Fire alarm scope and pathways
- BDA/ERRS requirements

Generator & ATS
- Generator sizing vs. load calculations
- ATS ratings and compatibility
- Transfer scheme completeness

RFI RULES
Generate RFIs for:
- Missing schedules
- Missing equipment ratings
- Missing dimensions
- Conflicting notes or drawings
- Contradictory information between sheets
- Items where Agent 2 quantity differs from Agent 1 source data

RISK CLASSIFICATION
Classify every finding:
- LOW RISK — minor, unlikely to cause cost impact
- MEDIUM RISK — possible cost impact, monitor closely
- HIGH RISK — likely cost impact, must resolve before bid submission

TRACEABILITY CHECK
For each major quantity category in Agent 2, verify a source sheet exists in Agent 1 data.
Flag any Agent 2 quantity that cannot be traced to an Agent 1 source sheet as: UNVERIFIED — MANUAL REVIEW REQUIRED.

OUTPUT FORMAT
- Executive Review Summary
- Scope Gaps (with risk classification)
- Quantity Verification Findings (flag any mismatches)
- Design Conflicts (with source sheet references)
- Coordination Issues
- RFI Log
- Change-Order Opportunities
- Bid Risk Assessment (overall LOW / MEDIUM / HIGH with justification)
- Manual Review Checklist (items requiring human verification before bid submission)
- Overall Confidence Score (0.0 to 1.0 with explanation)

IMPORTANT
Do not modify quantities.
Do not rewrite scope language.
Challenge every assumption.
Focus on protecting profitability and preventing scope gaps.
Think like a Chief Estimator who is accountable for the final number.`;

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

      const resp = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 8192,
        system: AGENT1_SYSTEM,
        messages: [{ role: 'user', content: contentBlocks }],
      });
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

        const bResp = await client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 8192,
          system: AGENT1_SYSTEM,
          messages: [{ role: 'user', content: contentBlocks }],
        });
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
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: AGENT2_SYSTEM,
      messages: [{
        role: 'user',
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}`,
      }],
    });
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
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: AGENT3_SYSTEM,
      messages: [{
        role: 'user',
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${agent1Output}\n\n---\n\nESTIMATOR OUTPUT:\n\n${agent2Output}`,
      }],
    });
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI analysis not configured. Set ANTHROPIC_API_KEY environment variable.' });
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  runPipeline(bidId, files, client).catch(err => {
    console.error('[takeoff] Pipeline error:', err);
  });
});

export default router;
