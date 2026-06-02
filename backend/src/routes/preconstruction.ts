import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// GET results for a bid
router.get('/:bidId/results', requireAuth, async (req, res) => {
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

  // Win rate for this GC
  const { rows: gcStats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost,
      COUNT(*) FILTER (WHERE stage IN ('awarded','lost')) as total,
      AVG(amount) FILTER (WHERE stage='awarded') as avg_won_amount
    FROM bids WHERE gc=$1
  `, [bid.gc]);

  // Overall win rate
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

// POST analyze — run AI takeoff
router.post('/analyze', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.body;
  if (!bidId) return res.status(400).json({ error: 'bidId required' });

  const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
  if (!bidRows.length) return res.status(404).json({ error: 'Bid not found' });
  const bid = bidRows[0];

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI analysis not configured. Set ANTHROPIC_API_KEY environment variable.' });
  }

  // Mark as in-progress
  await pool.query(`
    INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')
    ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now()
  `, [bidId]);

  // Run analysis asynchronously — respond immediately
  res.json({ status: 'running', message: 'Analysis started' });

  // Do the AI work after responding
  (async () => {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = `You are an experienced electrical estimator for a commercial and residential electrical subcontractor in Florida. Analyze this bid opportunity and provide a structured takeoff assessment.

BID INFORMATION:
- Project Name: ${bid.name}
- General Contractor: ${bid.gc}
- Location: ${bid.loc}
- Bid Due: ${bid.due}
- Estimated Amount: ${bid.amount ? '$' + Number(bid.amount).toLocaleString() : 'Not yet set'}
- Plan Sheet Count: ${bid.sheets || 'Unknown'}
- Contact: ${bid.contact || 'Unknown'}

Provide a comprehensive bid analysis in the following JSON format. Be specific and practical for a Florida commercial/residential electrical subcontractor.

Return ONLY valid JSON in this exact structure:
{
  "scope": [
    { "id": "A", "category": "Service & Distribution", "items": ["item1", "item2"], "estimatedHours": 40 },
    { "id": "B", "category": "Branch Circuits", "items": ["item1", "item2"], "estimatedHours": 80 },
    { "id": "C", "category": "Lighting", "items": ["item1", "item2"], "estimatedHours": 30 },
    { "id": "D", "category": "Low Voltage / Data", "items": ["item1"], "estimatedHours": 20 },
    { "id": "E", "category": "Fire Alarm", "items": ["item1"], "estimatedHours": 15 },
    { "id": "F", "category": "Site / Exterior", "items": ["item1"], "estimatedHours": 25 }
  ],
  "materials": [
    { "item": "200A Main Breaker Panel", "qty": 1, "unit": "EA", "estimatedCost": 1200 },
    { "item": "12 AWG THHN Wire", "qty": 2000, "unit": "LF", "estimatedCost": 800 }
  ],
  "rfis": [
    { "id": "RFI-001", "question": "Confirm service entrance size", "priority": "high", "section": "Service" },
    { "id": "RFI-002", "question": "Clarify exterior lighting fixture type", "priority": "medium", "section": "Lighting" }
  ],
  "laborEstimate": {
    "totalHours": 210,
    "foremenHours": 40,
    "journeymanHours": 130,
    "apprenticeHours": 40,
    "estimatedLaborCost": 42000,
    "notes": "Estimate based on plan sheet count and typical scope for this project type"
  },
  "riskFlags": [
    { "level": "high", "category": "Schedule", "description": "Short bid window may indicate fast-track project" },
    { "level": "medium", "category": "Scope", "description": "Verify fire alarm scope is included vs. separate contract" }
  ],
  "bidStrategy": {
    "recommendedMarkup": "18-22%",
    "competitivePosition": "moderate",
    "winProbabilityEstimate": "55-65%",
    "keyConsiderations": ["GC relationship", "Material lead times", "Labor availability"]
  }
}`;

      const message = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      });

      const rawText = message.content[0].type === 'text' ? message.content[0].text : '';

      // Extract JSON from response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);

      await pool.query(`
        INSERT INTO takeoff_results (bid_id, scope, materials, rfis, labor_estimate, risk_flags, raw_response, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'complete')
        ON CONFLICT (bid_id) DO UPDATE SET
          scope=$2, materials=$3, rfis=$4, labor_estimate=$5, risk_flags=$6, raw_response=$7, status='complete', created_at=now()
      `, [
        bidId,
        JSON.stringify(parsed.scope || []),
        JSON.stringify(parsed.materials || []),
        JSON.stringify(parsed.rfis || []),
        JSON.stringify(parsed.laborEstimate || {}),
        JSON.stringify(parsed.riskFlags || []),
        rawText,
      ]);
    } catch (err) {
      console.error('[takeoff] Analysis failed:', err);
      await pool.query(
        `UPDATE takeoff_results SET status='error' WHERE bid_id=$1`,
        [bidId]
      );
    }
  })();
});

export default router;
