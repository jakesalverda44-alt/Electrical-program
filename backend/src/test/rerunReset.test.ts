// Re-run reset — "when we re-run the analysis it should clear out all the
// old outputs" (Jake, after the AutoZone re-run left 42 est_bid_lines,
// bid_estimates + bids.amount $23,173 and 5 AI-imported RFIs behind).
//
// Plus the analysis-input follow-up from the same live run: the previous
// proposal PDF went to Agent 1 as a drawing, and the plan set / spec book
// went twice each.
//
// The Anthropic SDK is mocked (every call fails fast), Drive is mocked, the
// key below is a dummy that lives only in this worker's env. No network, no
// email (Graph is muted under test).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({ finalMessage: async () => { throw new Error('mocked: no model calls in this file'); } }),
      create: async () => { throw new Error('mocked: no model calls in this file'); },
    };
  },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { beginAnalysisRun, gatherAnalysisInputs } from '../routes/preconstruction';
import { syncTakeoff } from '../estimating/bidEstimate';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); process.env.ANTHROPIC_API_KEY = 'test-dummy-not-a-key'; }, 30_000);

const AGENT2 = '```json\n' + JSON.stringify({
  takeoff: [
    { category: 'Lighting', item: '5.1', spec: 'Type A 2x4 LED troffer', qty: 40, unit: 'EA', confidence: 'FIRM' },
    { category: 'Lighting', item: '5.2', spec: 'Type B downlight', qty: 12, unit: 'EA', confidence: 'FIRM' },
    { category: 'Power', item: '6.1', spec: 'Duplex receptacle', qty: 30, unit: 'EA', confidence: 'APPROX' },
  ],
  rfis: [
    { item: 'A', risk: 'high', question: 'Confirm Type A fixture count on E-2.1?' },
    { item: 'SVC', risk: 'med', question: 'Is the service 800A or 1200A?' },
  ],
}) + '\n```';

const AGENT4 = { sections: [{ title: 'A. Service & Distribution', bullets: ['x'] }], exclusions: [], takeoff: [] };
const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n`);

interface Fixture {
  user: TestUser; bidId: string; run1: string; planDocId: string;
  keys: Record<string, string>;
  markers: Record<string, string>;
  docs: Record<string, string>;
}

async function insertDoc(bidId: string, name: string, category: string, extra: { generated?: boolean; runId?: string | null; bytes?: Buffer; gatePassed?: boolean; hash?: string | null } = {}): Promise<string> {
  const bytes = extra.bytes ?? PDF(name);
  const type = name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data,
                            gate_passed, takeoff_run_id, generated, compose_inputs_hash)
     VALUES ($1,'AutoZone','elec',$2,$2,$3,$4,$5,'test',$6,$7,$8,$9,$10) RETURNING id`,
    [bidId, name, category, bytes.length, type, bytes.toString('base64'),
     extra.gatePassed ?? !!extra.generated, extra.runId ?? null, !!extra.generated, extra.hash ?? null]
  );
  return rows[0].id as string;
}

/** A realistic AutoZone-shaped bid after one full analysis run and some
 *  estimator work — every category the reset clears or keeps. */
async function analyzedBid(): Promise<Fixture> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id, amount) VALUES ($1, 'Summit GC', 'Kissimmee, FL', $2, 23173) RETURNING id`,
    [`AutoZone ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const bidId = rows[0].id as string;
  const { runId: run1 } = await beginAnalysisRun(bidId);
  await pool.query(
    `UPDATE takeoff_results SET status='complete', agent1_output='{"fixtureSchedule":[]}', agent2_output=$2, agent3_output='{}',
       count_result='{"targets":[],"sheets":[],"marks":[]}', review_status='clear',
       review_items=$3, account_terms='{"rule":"AutoZone"}', agent4_output=$4, agent4_price=23173, agent4_status='complete',
       agent4_run_id=run_id, draft_output=$4, draft_status='complete', draft_run_id=run_id, draft_inputs_hash='h1',
       manual_count_targets='[{"type":"X1","description":"Exit sign"}]'
     WHERE bid_id=$1`,
    [bidId, AGENT2,
     JSON.stringify([{ id: 'count:A', kind: 'count', title: 'Type A', detail: 'Counted 40', resolution: { action: 'confirm', answer: 'yes', reason: 'checked' } }]),
     JSON.stringify(AGENT4)]
  );

  const planDocId = await insertDoc(bidId, '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf', 'plans');
  const docs = {
    plan: planDocId,
    spec: await insertDoc(bidId, '2.0 - Kissimmee FL10077 FULL SPEC.pdf', 'plans'),
    proposalPdf: await insertDoc(bidId, 'Proposal - AutoZone - 2026-09-23.pdf', 'proposal', { generated: true, runId: run1 }),
    proposalDocx: await insertDoc(bidId, 'Proposal - AutoZone - 2026-09-23.docx', 'proposal', { generated: true, runId: run1 }),
    gcTakeoff: await insertDoc(bidId, 'Takeoff - AutoZone.xlsx', 'takeoff', { generated: true, runId: run1 }),
    prebidScope: await insertDoc(bidId, 'PreBid_Scope - AutoZone - 2026-09-23.docx', 'prebid_scope', { generated: true, runId: run1 }),
    prebidTakeoff: await insertDoc(bidId, 'PreBid_Takeoff - AutoZone - 2026-09-23.xlsx', 'prebid_takeoff', { generated: true, runId: run1 }),
    uploadedPhoto: await insertDoc(bidId, 'site-photo.pdf', 'photo'),
  };

  // Priced lines: [name, source, overrides]
  const lineDefs: Array<[string, string, Record<string, unknown>]> = [
    ['untouched', 'takeoff', { takeoff_key: 'Lighting||5.2', description: 'Type B downlight', qty: 12 }],
    ['vanished', 'takeoff', { takeoff_key: 'Power||9.9', description: '[No longer in takeoff] Old item', excluded: true, sync_excluded: true }],
    ['qtyOverride', 'takeoff', { takeoff_key: 'Power||6.1', description: 'Duplex receptacle', qty: 34, qty_overridden: true, qty_source: 'manual', evidence_note: 'Counted on the plans by hand, 34 not 30' }],
    ['materialOverride', 'takeoff', { takeoff_key: 'Power||6.2', description: 'GFCI receptacle', material_unit_override: 21.5 }],
    ['laborOverride', 'takeoff', { takeoff_key: 'Power||6.3', description: 'Floor box', labor_hours_override: 1.25 }],
    ['markup', 'takeoff', { takeoff_key: 'Lighting||5.1', description: 'Type A 2x4 LED troffer', synced_description: 'Type A 2x4 LED troffer', qty: 43, qty_overridden: true, qty_source: 'markup' }],
    ['userExcluded', 'takeoff', { takeoff_key: 'Site||7.1', description: 'Pole base', excluded: true, sync_excluded: false }],
    ['manualMatch', 'takeoff', { takeoff_key: 'Site||7.2', description: 'Site light pole', match_source: 'manual' }],
    ['manual', 'manual', { takeoff_key: null, description: 'Generator hookup allowance', material_unit_override: 1500, evidence_note: 'Verbal allowance per GC, no spec section on this job' }],
  ];
  const keys: Record<string, string> = {};
  let sort = 0;
  for (const [name, source, o] of lineDefs) {
    const { rows: l } = await pool.query(
      `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, takeoff_key, source, excluded, sync_excluded,
         qty_overridden, qty_source, material_unit_override, labor_hours_override, match_source, synced_description, evidence_note)
       VALUES ($1,$2,$3,$4,$5,'EA',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING line_key`,
      [bidId, sort++, String(o.takeoff_key ?? 'Misc||').split('||')[0] || 'Misc', o.description, o.qty ?? 1, o.takeoff_key ?? null, source,
       !!o.excluded, !!o.sync_excluded, !!o.qty_overridden, o.qty_source ?? 'takeoff',
       o.material_unit_override ?? null, o.labor_hours_override ?? null, o.match_source ?? null, o.synced_description ?? null, o.evidence_note ?? null]
    );
    keys[name] = l[0].line_key as string;
  }
  await pool.query(
    `INSERT INTO bid_estimates (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total)
     VALUES ($1, 12, 18, '[]', '{}', 18000, 2000, 3173, 23173)`, [bidId]
  );
  await pool.query(
    `INSERT INTO est_bid_settings (bid_id, labor_rate, overhead_pct, profit_pct) VALUES ($1, 41.50, 12, 18)`, [bidId]
  );

  // Markers
  const marker = async (status: string, source: string | null, lineKey: string | null, label: string) => {
    const { rows: m } = await pool.query(
      `INSERT INTO est_markups (bid_id, document_id, page_index, line_key, kind, points, status, label, created_by, source)
       VALUES ($1,$2,0,$3,'count','[{"x":10,"y":10}]',$4,$5,'test',$6) RETURNING id`,
      [bidId, planDocId, lineKey, status, label, source]
    );
    return m[0].id as string;
  };
  const markers = {
    aiSuggested1: await marker('suggested', 'ai_count', keys.markup, 'A'),
    aiSuggested2: await marker('suggested', 'ai_count', null, 'B'),
    aiConfirmed: await marker('confirmed', 'ai_count', keys.markup, 'A'),
    estimatorOnMarkupLine: await marker('confirmed', null, keys.markup, 'A'),
    estimatorOnUntouchedLine: await marker('confirmed', null, keys.untouched, 'B'),
  };

  // Workspace: 5 AI-imported RFIs (3 tagged, 1 legacy import id, 1 legacy
  // matched by question), 1 AI RFI already drafted to the GC, 2 typed ones.
  const rfis = [
    { id: '1790000000000.11', question: 'AI one', submitted: false, answer: '', origin: 'ai' },
    { id: '1790000000000.22', question: 'AI two', submitted: false, answer: '', origin: 'ai' },
    { id: '1790000000000.33', question: 'AI three', submitted: false, answer: '', origin: 'ai' },
    { id: '1790000000000.4412', question: 'Legacy import without origin', submitted: false, answer: '' },
    { id: '1790000000001', question: 'Is the service 800A or 1200A?', submitted: false, answer: '' },
    { id: '1790000000000.55', question: 'AI already drafted to the GC', submitted: true, answer: '', origin: 'ai' },
    { id: '1790000000002', question: 'Estimator: who furnishes the poles?', submitted: false, answer: '', origin: 'manual' },
    { id: '1790000000003', question: 'Estimator legacy typed RFI', submitted: false, answer: '' },
  ];
  await pool.query(
    `INSERT INTO bid_workspaces (bid_id, notes, scope, scope_meta, rfis, files, ai_done, proposal_generated, confirmed_service, overhead_pct, profit_pct, estimate_overrides)
     VALUES ($1, 'Jake: GC wants alt price for LED retrofit',
             '{"A":"• 800A service entrance (ECFECI)","B":"Jake: branch power per E-2.1, home runs only","C":"AI lighting text, then edited by Jake"}',
             '{"ai":{"A":"• 800A service entrance (ECFECI)","C":"AI lighting text"}}',
             $2, '[{"id":"f1","name":"FULL SET.pdf"}]', true, true,
             '{"voltage":"480/277","ampacity":"800","panel":"MDP","confirmed":true}', 12, 18, '{"Power||6.1":22}')`,
    [bidId, JSON.stringify(rfis)]
  );

  await pool.query(
    `INSERT INTO bid_scope_items (bid_id, kind, text, created_by) VALUES ($1,'include','F/A: conduit + pull strings only','test'),
       ($1,'exclude','600A MCC — not included','test')`, [bidId]
  );
  await pool.query(
    `INSERT INTO bid_scope_items (bid_id, kind, text, line_key, reason, created_by, flag_code)
     VALUES ($1,'override_non_electrical','Plumbing sleeve','L-1','Owner asked us to carry it','test','non_electrical')`, [bidId]
  );
  return { user, bidId, run1, planDocId, keys, markers, docs };
}

describe('re-run reset — beginAnalysisRun clears the previous run and keeps the estimator\'s work', () => {
  it('clears every AI-derived output of the AutoZone-shaped fixture, atomically with the new run id', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { runId: run2, reset } = await beginAnalysisRun(f.bidId);
    expect(run2).not.toBe(f.run1);

    // takeoff_results: analysis fields, counts, review items + answers, draft, Agent 4.
    const { rows: [tr] } = await pool.query('SELECT * FROM takeoff_results WHERE bid_id=$1', [f.bidId]);
    expect(tr).toMatchObject({
      run_id: run2, status: 'running', review_status: 'pending', reset_run_id: run2,
      agent1_output: null, agent2_output: null, agent3_output: null, count_result: null,
      review_items: null, account_terms: null, hygiene: null,
      agent4_output: null, agent4_price: null, agent4_status: null, agent4_run_id: null,
      draft_output: null, draft_status: null, draft_run_id: null, draft_inputs_hash: null,
    });
    // KEEP: the fixture types the estimator entered for counting.
    expect(tr.manual_count_targets).toEqual([{ type: 'X1', description: 'Exit sign' }]);
    expect(tr.reset_summary).toMatchObject({ runId: run2, previousRunId: f.run1 });

    // Priced lines: only untouched takeoff lines go.
    const { rows: lines } = await pool.query('SELECT line_key, source, recheck_run_id, qty FROM est_bid_lines WHERE bid_id=$1', [f.bidId]);
    const byKey = new Map(lines.map(l => [l.line_key as string, l]));
    expect(byKey.has(f.keys.untouched)).toBe(false);
    expect(byKey.has(f.keys.vanished)).toBe(false);
    for (const k of ['qtyOverride', 'materialOverride', 'laborOverride', 'markup', 'userExcluded', 'manualMatch']) {
      expect(byKey.get(f.keys[k])?.recheck_run_id, k).toBe(run2);
    }
    expect(byKey.get(f.keys.manual)).toMatchObject({ source: 'manual', recheck_run_id: null });
    expect(Number(byKey.get(f.keys.markup)!.qty)).toBe(43);

    // Saved estimate and the amount taken from it.
    const { rows: be } = await pool.query('SELECT 1 FROM bid_estimates WHERE bid_id=$1', [f.bidId]);
    expect(be).toHaveLength(0);
    const { rows: [bid] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [f.bidId]);
    expect(bid.amount).toBeNull();

    // Markers: AI suggestions soft-deleted; confirmed kept; a confirmed
    // marker on a cleared line moves to the unassigned bucket.
    const { rows: mk } = await pool.query('SELECT id, deleted_at, line_key FROM est_markups WHERE bid_id=$1', [f.bidId]);
    const m = new Map(mk.map(r => [r.id as string, r]));
    expect(m.get(f.markers.aiSuggested1)!.deleted_at).not.toBeNull();
    expect(m.get(f.markers.aiSuggested2)!.deleted_at).not.toBeNull();
    expect(m.get(f.markers.aiConfirmed)).toMatchObject({ deleted_at: null, line_key: f.keys.markup });
    expect(m.get(f.markers.estimatorOnMarkupLine)).toMatchObject({ deleted_at: null, line_key: f.keys.markup });
    expect(m.get(f.markers.estimatorOnUntouchedLine)).toMatchObject({ deleted_at: null, line_key: null });

    // Workspace: the 5 AI RFIs nobody acted on are gone.
    const { rows: [ws] } = await pool.query('SELECT * FROM bid_workspaces WHERE bid_id=$1', [f.bidId]);
    expect((ws.rfis as Array<{ question: string }>).map(r => r.question)).toEqual([
      'AI already drafted to the GC', 'Estimator: who furnishes the poles?', 'Estimator legacy typed RFI',
    ]);
    expect((ws.rfis as Array<{ origin: string }>).map(r => r.origin)).toEqual(['ai', 'manual', 'manual']);
    // Scope: only the untouched AI section goes; typed and edited ones stay, flagged.
    expect(ws.scope).toEqual({ B: 'Jake: branch power per E-2.1, home runs only', C: 'AI lighting text, then edited by Jake' });
    expect(ws.scope_meta).toEqual({ ai: {}, recheck: ['B', 'C'] });
    expect(reset.scopeCleared).toEqual(['A']);
    expect(ws.confirmed_service).toBeNull();
    expect(ws.ai_done).toBe(false);
    expect(ws.proposal_generated).toBe(false);

    // Filed GC / pre-bid documents: flagged superseded, never deleted.
    const { rows: docs } = await pool.query('SELECT id, deleted_at, superseded_at, superseded_by_run_id FROM documents WHERE linked_id=$1', [f.bidId]);
    const d = new Map(docs.map(r => [r.id as string, r]));
    expect(docs).toHaveLength(8);
    for (const k of ['proposalPdf', 'proposalDocx', 'gcTakeoff', 'prebidScope', 'prebidTakeoff']) {
      expect(d.get(f.docs[k]), k).toMatchObject({ deleted_at: null, superseded_by_run_id: run2 });
      expect(d.get(f.docs[k])!.superseded_at, k).not.toBeNull();
    }

    expect(reset.cleared).toEqual({
      takeoffLines: 2, suggestedMarkers: 2, aiRfis: 5, supersededDocuments: 5, reviewItems: 1, savedEstimate: true, bidAmount: true,
    });
    expect(reset.kept).toEqual({ manualLines: 1, recheckLines: 6, confirmedMarkers: 3, unassignedMarkers: 1, rfis: 3 });
    expect(reset.rfis).toHaveLength(3);
  });

  it('keeps the estimator\'s work: uploads, notes, scope list and overrides, settings, account rules', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { rows: [rulesBefore] } = await pool.query('SELECT count(*)::int AS n, max(updated_at) AS at FROM account_rules');
    await beginAnalysisRun(f.bidId);

    const { rows: docs } = await pool.query('SELECT id, superseded_at, deleted_at FROM documents WHERE id = ANY($1::uuid[])',
      [[f.docs.plan, f.docs.spec, f.docs.uploadedPhoto]]);
    expect(docs).toHaveLength(3);
    for (const doc of docs) expect(doc).toMatchObject({ superseded_at: null, deleted_at: null });

    const { rows: [ws] } = await pool.query('SELECT notes, files, overhead_pct, profit_pct, estimate_overrides FROM bid_workspaces WHERE bid_id=$1', [f.bidId]);
    expect(ws.notes).toBe('Jake: GC wants alt price for LED retrofit');
    expect(ws.files).toEqual([{ id: 'f1', name: 'FULL SET.pdf' }]);
    expect(Number(ws.overhead_pct)).toBe(12);
    expect(Number(ws.profit_pct)).toBe(18);
    expect(ws.estimate_overrides).toEqual({ 'Power||6.1': 22 });

    const { rows: scope } = await pool.query('SELECT kind, text, reason FROM bid_scope_items WHERE bid_id=$1 ORDER BY kind', [f.bidId]);
    expect(scope.map(s => s.kind)).toEqual(['exclude', 'include', 'override_non_electrical']);

    const { rows: [st] } = await pool.query('SELECT labor_rate, overhead_pct, profit_pct FROM est_bid_settings WHERE bid_id=$1', [f.bidId]);
    expect([Number(st.labor_rate), Number(st.overhead_pct), Number(st.profit_pct)]).toEqual([41.5, 12, 18]);

    const { rows: [rulesAfter] } = await pool.query('SELECT count(*)::int AS n, max(updated_at) AS at FROM account_rules');
    expect(rulesAfter).toEqual(rulesBefore);
  });

  it('a bid amount the estimator typed (no saved estimate, no Agent 4 price) is left alone', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id, amount) VALUES ('Typed amount', 'GC', $1, 5000) RETURNING id`, [user.id]);
    const { reset } = await beginAnalysisRun(rows[0].id);
    const { rows: [bid] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [rows[0].id]);
    expect(Number(bid.amount)).toBe(5000);
    expect(reset.cleared.bidAmount).toBe(false);
  });

  it('is atomic: if any part of the reset fails, the run is not started and nothing is cleared', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    // Sabotage one statement late in the reset (the markers step), for this bid only.
    const fn = `rerun_reset_sabotage_${Date.now()}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sabotaged'; END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON est_markups FOR EACH ROW WHEN (NEW.bid_id = '${f.bidId}'::uuid) EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(beginAnalysisRun(f.bidId)).rejects.toThrow(/sabotaged/);
    } finally {
      await pool.query(`DROP TRIGGER ${fn} ON est_markups`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    const { rows: [tr] } = await pool.query('SELECT run_id, agent4_output, review_items FROM takeoff_results WHERE bid_id=$1', [f.bidId]);
    expect(tr.run_id).toBe(f.run1);
    expect(tr.agent4_output).not.toBeNull();
    expect(tr.review_items).toHaveLength(1);
    const { rows: lines } = await pool.query('SELECT count(*)::int AS n FROM est_bid_lines WHERE bid_id=$1 AND recheck_run_id IS NULL', [f.bidId]);
    expect(lines[0].n).toBe(9);
    const { rows: be } = await pool.query('SELECT 1 FROM bid_estimates WHERE bid_id=$1', [f.bidId]);
    expect(be).toHaveLength(1);
  });
});

describe('re-run reset — the markup-sourced line is kept, flagged and re-binds on the next sync-takeoff', () => {
  it('re-binds by description when the new run renumbers the item, keeps the confirmed qty, and never excludes an unmatched carried line', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { runId: run2 } = await beginAnalysisRun(f.bidId);
    // The new run renumbers Type A from 5.1 to 5.4 and drops the GFCI line.
    const NEW_AGENT2 = JSON.stringify({ takeoff: [
      { category: 'Lighting', item: '5.4', spec: 'Type A 2x4 LED troffer', qty: 38, unit: 'EA', confidence: 'FIRM' },
      { category: 'Power', item: '6.1', spec: 'Duplex receptacle', qty: 28, unit: 'EA', confidence: 'FIRM' },
      { category: 'Lighting', item: '5.5', spec: 'Type C wall pack', qty: 6, unit: 'EA', confidence: 'FIRM' },
    ] });
    await pool.query(`UPDATE takeoff_results SET status='complete', agent2_output=$2 WHERE bid_id=$1`, [f.bidId, NEW_AGENT2]);

    const result = await syncTakeoff(f.bidId);
    const markup = result.lines.find(l => l.line_key === f.keys.markup)!;
    expect(markup).toMatchObject({ takeoff_key: 'Lighting||5.4', qty: 43, qty_source: 'markup', recheck_run_id: run2, excluded: false });
    const qty = result.lines.find(l => l.line_key === f.keys.qtyOverride)!;
    expect(qty).toMatchObject({ takeoff_key: 'Power||6.1', qty: 34, recheck_run_id: run2 });
    // GFCI (material override) has no match in the new takeoff: left alone, still priced and flagged.
    const gfci = result.lines.find(l => l.line_key === f.keys.materialOverride)!;
    expect(gfci).toMatchObject({ excluded: false, recheck_run_id: run2, material_unit_override: 21.5 });
    expect(gfci.description.startsWith('[No longer in takeoff]')).toBe(false);
    // The new row is added fresh (not flagged).
    const wallPack = result.lines.find(l => l.takeoff_key === 'Lighting||5.5')!;
    expect(wallPack).toMatchObject({ recheck_run_id: null, qty: 6 });
    expect(result.rebound).toBe(1);
    expect(result.unbound).toBe(4); // GFCI, floor box, pole base, site light pole
    // The confirmed markers still point at the (same) line_key.
    const { rows: mk } = await pool.query('SELECT line_key FROM est_markups WHERE id=$1', [f.markers.estimatorOnMarkupLine]);
    expect(mk[0].line_key).toBe(f.keys.markup);
    // sync-takeoff wrote a fresh estimate + amount again.
    const { rows: [bid] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [f.bidId]);
    expect(bid.amount).not.toBeNull();
  });

  it('the flag round-trips through GET / PUT and clears when the estimator marks the line checked', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { runId: run2 } = await beginAnalysisRun(f.bidId);
    const got = await request(app).get(`/api/estimating/${f.bidId}`).set(auth(f.user.token)).expect(200);
    const lines = got.body.lines as Array<Record<string, unknown>>;
    expect(lines.find(l => l.line_key === f.keys.markup)!.recheck_run_id).toBe(run2);

    // Save unchanged: flag survives. Then clear it on one line.
    await request(app).put(`/api/estimating/${f.bidId}`).set(auth(f.user.token)).send({ lines, settings: got.body.settings }).expect(200);
    const checked = lines.map(l => (l.line_key === f.keys.markup ? { ...l, recheck_run_id: null } : l));
    const saved = await request(app).put(`/api/estimating/${f.bidId}`).set(auth(f.user.token)).send({ lines: checked, settings: got.body.settings }).expect(200);
    const after = saved.body.lines as Array<Record<string, unknown>>;
    expect(after.find(l => l.line_key === f.keys.markup)!.recheck_run_id).toBeNull();
    expect(after.find(l => l.line_key === f.keys.qtyOverride)!.recheck_run_id).toBe(run2);
  });
});

describe('re-run reset — stale documents can never be sent', () => {
  async function completeAndClear(bidId: string) {
    await pool.query(`UPDATE takeoff_results SET status='complete', agent2_output='{}', review_status='clear', review_items='[]' WHERE bid_id=$1`, [bidId]);
  }

  it('the previous run\'s proposal and pre-bid package are refused after a re-run (409)', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    await beginAnalysisRun(f.bidId);
    await completeAndClear(f.bidId);
    const gc = await request(app).post(`/api/bids/${f.bidId}/draft-proposal`).set(auth(f.user.token)).send({ to: ['gc@example.com'], markSubmitted: false });
    expect(gc.status).toBe(409);
    expect(gc.body.error).toMatch(/No proposal PDF from the current analysis/);
    const chris = await request(app).post(`/api/bids/${f.bidId}/email-prebid-chris`).set(auth(f.user.token)).send({});
    expect(chris.status).toBe(409);
    expect(chris.body.error).toMatch(/No pre-bid package from the current analysis/);
  });

  it('the inputs-hash guard still refuses a file stamped with the current run but stale inputs (409 Regenerate)', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { runId: run2 } = await beginAnalysisRun(f.bidId);
    await completeAndClear(f.bidId);
    await insertDoc(f.bidId, 'Proposal - AutoZone - rerun.pdf', 'proposal', { generated: true, runId: run2, hash: 'hash-from-before-the-rerun' });
    await insertDoc(f.bidId, 'PreBid_Scope - rerun.docx', 'prebid_scope', { generated: true, runId: run2, hash: 'hash-from-before-the-rerun' });
    const gc = await request(app).post(`/api/bids/${f.bidId}/draft-proposal`).set(auth(f.user.token)).send({ to: ['gc@example.com'], markSubmitted: false });
    expect(gc.status).toBe(409);
    expect(gc.body.error).toMatch(/^Regenerate — inputs changed since this file was made/);
    const chris = await request(app).post(`/api/bids/${f.bidId}/email-prebid-chris`).set(auth(f.user.token)).send({});
    expect(chris.status).toBe(409);
    expect(chris.body.error).toMatch(/^Regenerate/);
  });

  it('a superseded file is never attached, even if it carries the current run id', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { runId: run2 } = await beginAnalysisRun(f.bidId);
    await completeAndClear(f.bidId);
    const id = await insertDoc(f.bidId, 'Proposal - AutoZone - odd.pdf', 'proposal', { generated: true, runId: run2 });
    await pool.query('UPDATE documents SET superseded_at=now() WHERE id=$1', [id]);
    const gc = await request(app).post(`/api/bids/${f.bidId}/draft-proposal`).set(auth(f.user.token)).send({ to: ['gc@example.com'], markSubmitted: false });
    expect(gc.status).toBe(409);
    expect(gc.body.error).toMatch(/No proposal PDF from the current analysis/);
  });

  it('the documents list reports generated / superseded so the Files panel can badge them', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    await beginAnalysisRun(f.bidId);
    const r = await request(app).get('/api/documents').query({ linked_id: f.bidId }).set(auth(f.user.token)).expect(200);
    const byId = new Map((r.body as Array<Record<string, unknown>>).map(d => [d.id as string, d]));
    expect(byId.get(f.docs.proposalPdf)).toMatchObject({ generated: true });
    expect(byId.get(f.docs.proposalPdf)!.superseded_at).not.toBeNull();
    expect(byId.get(f.docs.plan)).toMatchObject({ generated: false, superseded_at: null });
  });
});

describe('POST /analyze — the reset runs with the run and the response carries it', () => {
  it('returns the reset summary and the surviving RFIs; the old outputs are gone', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(f.user.token))
      .field('bidId', f.bidId).field('document_ids', f.docs.plan);
    expect(res.status).toBe(200);
    expect(res.body.runId).toBeTruthy();
    expect(res.body.reset.cleared).toMatchObject({ takeoffLines: 2, aiRfis: 5, supersededDocuments: 5, savedEstimate: true, bidAmount: true });
    expect(res.body.reset.rfis.map((r: { question: string }) => r.question)).toEqual([
      'AI already drafted to the GC', 'Estimator: who furnishes the poles?', 'Estimator legacy typed RFI',
    ]);
    const { rows } = await pool.query('SELECT run_id, reset_run_id FROM takeoff_results WHERE bid_id=$1', [f.bidId]);
    expect(rows[0].reset_run_id).toBe(res.body.runId);
  });

  it('a request that never starts a run (no files) resets nothing', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(f.user.token))
      .field('bidId', f.bidId).field('document_ids', f.docs.proposalPdf);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CRM-generated proposals/);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM est_bid_lines WHERE bid_id=$1', [f.bidId]);
    expect(rows[0].n).toBe(9);
    const { rows: [tr] } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id=$1', [f.bidId]);
    expect(tr.run_id).toBe(f.run1);
  });
});

describe('analysis inputs — never the CRM\'s own documents, never a file twice', () => {
  it('a filed proposal PDF plus the plan set attached both as a workspace upload and as a document: the plan set goes once, no proposal', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const planBytes = Buffer.from((await pool.query('SELECT file_data FROM documents WHERE id=$1', [f.docs.plan])).rows[0].file_data, 'base64');
    const upload = { fieldname: 'files', originalname: '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf', encoding: '7bit',
      mimetype: 'application/pdf', buffer: planBytes, size: planBytes.length } as Express.Multer.File;
    const info = vi.spyOn(logger, 'info');
    const { files, excluded } = await gatherAnalysisInputs(f.bidId, [upload], [f.docs.proposalPdf, f.docs.plan, f.docs.plan, f.docs.prebidTakeoff]);
    expect(files.map(x => x.originalname)).toEqual(['1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf']);
    expect((files[0] as Express.Multer.File & { documentId?: string }).documentId).toBe(f.docs.plan);
    expect(excluded).toEqual([
      { name: 'Proposal - AutoZone - 2026-09-23.pdf', documentId: f.docs.proposalPdf, reason: 'crm_generated', detail: 'a CRM-generated proposal document, not a drawing' },
      { name: f.docs.plan, documentId: f.docs.plan, reason: 'duplicate', detail: 'the same document was selected twice' },
      { name: 'PreBid_Takeoff - AutoZone - 2026-09-23.xlsx', documentId: f.docs.prebidTakeoff, reason: 'crm_generated', detail: 'a CRM-generated prebid_takeoff document, not a drawing' },
      { name: '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf', documentId: undefined, reason: 'duplicate', detail: 'same content as "1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf"' },
    ]);
    // The log line lists what was excluded and why.
    const call = info.mock.calls.find(c => typeof c[1] === 'string' && (c[1] as string).startsWith('[takeoff] analysis inputs'));
    expect(call).toBeTruthy();
    expect(call![0]).toMatchObject({ bidId: f.bidId, sent: ['1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf'] });
    expect((call![0] as { excluded: unknown[] }).excluded).toHaveLength(4);
    info.mockRestore();
  });

  it('an upload that is a downloaded copy of a generated proposal is dropped (by content hash, else name + size)', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const proposalBytes = Buffer.from((await pool.query('SELECT file_data FROM documents WHERE id=$1', [f.docs.proposalPdf])).rows[0].file_data, 'base64');
    // Fixture rows have no content_sha256 (as for rows filed before migration 121): name + size decides.
    const upload = { fieldname: 'files', originalname: 'Proposal - AutoZone - 2026-09-23.pdf', encoding: '7bit',
      mimetype: 'application/pdf', buffer: proposalBytes, size: proposalBytes.length } as Express.Multer.File;
    const plan = { ...upload, originalname: 'E-2.1.pdf', buffer: PDF('E-2.1 sheet'), size: 30 } as Express.Multer.File;
    const r1 = await gatherAnalysisInputs(f.bidId, [upload, plan], []);
    expect(r1.files.map(x => x.originalname)).toEqual(['E-2.1.pdf']);
    expect(r1.excluded[0]).toMatchObject({ reason: 'crm_generated' });
    // With a stored hash, a renamed copy is still caught.
    const crypto = await import('crypto');
    await pool.query('UPDATE documents SET content_sha256=$2 WHERE id=$1', [f.docs.proposalPdf, crypto.createHash('sha256').update(proposalBytes).digest('hex')]);
    const renamed = { ...upload, originalname: 'az-final.pdf' } as Express.Multer.File;
    const r2 = await gatherAnalysisInputs(f.bidId, [renamed, plan], []);
    expect(r2.files.map(x => x.originalname)).toEqual(['E-2.1.pdf']);
  });

  it('POST /analyze reports the excluded inputs and counts the plan set once', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const planBytes = Buffer.from((await pool.query('SELECT file_data FROM documents WHERE id=$1', [f.docs.plan])).rows[0].file_data, 'base64');
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(f.user.token))
      .field('bidId', f.bidId)
      .field('document_ids', f.docs.proposalPdf)
      .field('document_ids', f.docs.plan)
      .attach('files', planBytes, '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf');
    expect(res.status).toBe(200);
    expect(res.body.totalFiles).toBe(1);
    expect(res.body.excludedInputs.map((e: { reason: string }) => e.reason)).toEqual(['crm_generated', 'duplicate']);
  });

  it('each run records its input documents (an upload maps to its filed copy by hash) so the next re-run can pre-select them', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const crypto = await import('crypto');
    const specBytes = Buffer.from((await pool.query('SELECT file_data FROM documents WHERE id=$1', [f.docs.spec])).rows[0].file_data, 'base64');
    await pool.query('UPDATE documents SET content_sha256=$2 WHERE id=$1', [f.docs.spec, crypto.createHash('sha256').update(specBytes).digest('hex')]);
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(f.user.token))
      .field('bidId', f.bidId)
      .field('document_ids', f.docs.plan)
      .field('document_ids', f.docs.proposalPdf)
      .attach('files', specBytes, 'spec-uploaded-this-session.pdf');
    expect(res.status).toBe(200);
    const { rows: [tr] } = await pool.query('SELECT input_document_ids, run_id FROM takeoff_results WHERE bid_id=$1', [f.bidId]);
    expect(tr.run_id).toBe(res.body.runId);
    expect(tr.input_document_ids).toEqual([f.docs.plan, f.docs.spec]);
    const results = await request(app).get(`/api/preconstruction/${f.bidId}/results`).set(auth(f.user.token)).expect(200);
    expect(results.body.input_document_ids).toEqual([f.docs.plan, f.docs.spec]);
  });

  it('storeDocument marks generate-* output as generated and records the content hash', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const { storeDocument } = await import('../utils/storeDocument');
    const bytes = PDF('generated');
    const gen = await storeDocument({ file: { buffer: bytes, originalname: 'Proposal.pdf', mimetype: 'application/pdf', size: bytes.length } as Express.Multer.File,
      linkedId: f.bidId, linkedName: 'x', div: 'elec', category: 'proposal', uploadedBy: 'test', gatePassed: true, takeoffRunId: f.run1 });
    const up = await storeDocument({ file: { buffer: bytes, originalname: 'plans.pdf', mimetype: 'application/pdf', size: bytes.length } as Express.Multer.File,
      linkedId: f.bidId, linkedName: 'x', div: 'elec', category: 'plans', uploadedBy: 'test' });
    const { rows } = await pool.query('SELECT id, generated, content_sha256 FROM documents WHERE id = ANY($1::uuid[])', [[gen.id, up.id]]);
    const m = new Map(rows.map(r => [r.id as string, r]));
    expect(m.get(gen.id)!.generated).toBe(true);
    expect(m.get(up.id)!.generated).toBe(false);
    expect(m.get(up.id)!.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('migration 121 backfill', () => {
  it('tags existing RFIs ai/manual (import-shaped id or an Agent 2 question) and generated documents', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ('Backfill', 'GC', $1) RETURNING id`, [user.id]);
    const bidId = rows[0].id as string;
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent2_output) VALUES ($1, 'complete', $2)`, [bidId, AGENT2]);
    await pool.query(`INSERT INTO bid_workspaces (bid_id, rfis) VALUES ($1, $2)`, [bidId, JSON.stringify([
      { id: '1790000000000.123', question: 'Imported', submitted: false, answer: '' },
      { id: '1790000000005', question: '  confirm TYPE A fixture count on E-2.1? ', submitted: false, answer: '' },
      { id: '1790000000006', question: 'Typed by Jake', submitted: false, answer: '' },
      { id: '1790000000007', question: 'Already tagged', submitted: false, answer: '', origin: 'manual' },
    ])]);
    const gp = await insertDoc(bidId, 'old-proposal.pdf', 'proposal', { generated: false, gatePassed: true });
    const bd = await insertDoc(bidId, 'x_bid_data.json', 'bid_data', { generated: false, gatePassed: false });
    const plan = await insertDoc(bidId, 'plans.pdf', 'plans', { generated: false, gatePassed: false });

    const sql = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/121_rerun_reset.sql'), 'utf8');
    await pool.query(sql);

    const { rows: [ws] } = await pool.query('SELECT rfis FROM bid_workspaces WHERE bid_id=$1', [bidId]);
    expect((ws.rfis as Array<{ origin: string }>).map(r => r.origin)).toEqual(['ai', 'ai', 'manual', 'manual']);
    const { rows: docs } = await pool.query('SELECT id, generated FROM documents WHERE linked_id=$1', [bidId]);
    const g = new Map(docs.map(d => [d.id as string, d.generated]));
    expect([g.get(gp), g.get(bd), g.get(plan)]).toEqual([true, true, false]);
  });
});

// ── Fix round (review 2026-09-24-rerun-reset-review.md) ─────────────────────

async function keptLineBid(line: { description: string; key: string; unit?: string; qty?: number; material?: number | null }, rows: Array<Record<string, unknown>>) {
  const user = await makeUser('owner');
  const { rows: b } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`FR ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const bidId = b[0].id as string;
  await pool.query(
    `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, takeoff_key, source, qty_overridden, qty_source, material_unit_override, synced_description)
     VALUES ($1, 0, $2, $3, $4, $5, $6, 'takeoff', true, 'manual', $7, $3)`,
    [bidId, line.key.split('||')[0], line.description, line.qty ?? 34, line.unit ?? 'EA', line.key, line.material ?? 9.5]
  );
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent2_output) VALUES ($1, 'complete', '{}')`, [bidId]);
  const { runId } = await beginAnalysisRun(bidId);
  await pool.query(`UPDATE takeoff_results SET status='complete', agent2_output=$2 WHERE bid_id=$1`, [bidId, JSON.stringify({ takeoff: rows })]);
  return { bidId, runId };
}

describe('fix round B1 — a kept line re-binds only on category + unit + description', () => {
  it('the reviewer\'s Duplex/GFCI repro: the renumbered key is NOT enough — no bind, flagged, GFCI keeps its own numbers', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, runId } = await keptLineBid({ description: 'Duplex receptacle', key: 'Power||6.1' }, [
      { category: 'Power', item: '6.1', spec: 'GFCI receptacle, weather-resistant', qty: 10, unit: 'EA' },
      { category: 'Power', item: '6.4', spec: 'Duplex receptacle, 20A', qty: 30, unit: 'EA' },
    ]);
    const r = await syncTakeoff(bidId);
    const kept = r.lines.find(l => l.recheck_run_id === runId)!;
    expect(kept).toMatchObject({ description: 'Duplex receptacle', qty: 34, material_unit_override: 9.5, takeoff_key: 'Power||6.1', recheck_reason: 'no_confident_match', excluded: false });
    const gfci = r.lines.find(l => l.description.startsWith('GFCI'))!;
    expect(gfci).toMatchObject({ qty: 10, material_unit_override: null, recheck_run_id: null, qty_overridden: false });
    expect(r.lines.filter(l => l.description.startsWith('Duplex receptacle, 20A'))).toHaveLength(1);
    expect(r).toMatchObject({ rebound: 0, unbound: 1 });
  });

  it('an exact match re-binds and supersedes the new row: one line, no double pricing, the estimator\'s description and qty kept', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, runId } = await keptLineBid({ description: 'Duplex receptacle', key: 'Power||6.1' }, [
      { category: 'Power', item: '6.1', spec: 'GFCI receptacle, weather-resistant', qty: 10, unit: 'EA' },
      { category: 'Power', item: '6.4', spec: 'Duplex  RECEPTACLE', qty: 30, unit: 'ea' },
    ]);
    const r = await syncTakeoff(bidId);
    const duplex = r.lines.filter(l => /duplex/i.test(l.description));
    expect(duplex).toHaveLength(1);
    expect(duplex[0]).toMatchObject({ description: 'Duplex receptacle', qty: 34, takeoff_key: 'Power||6.4', recheck_run_id: runId, recheck_reason: null, material_unit_override: 9.5 });
    expect(r.lines).toHaveLength(2);
    expect(r).toMatchObject({ rebound: 1, unbound: 0, added: 1 });
  });

  it('a different unit is not a match', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await keptLineBid({ description: 'EMT 3/4"', key: 'Raceway||2.1', unit: 'LF' }, [
      { category: 'Raceway', item: '2.1', spec: 'EMT 3/4"', qty: 12, unit: 'EA' },
    ]);
    const r = await syncTakeoff(bidId);
    expect(r.lines.find(l => l.qty_overridden)!.recheck_reason).toBe('no_confident_match');
    expect(r.unbound).toBe(1);
  });

  it('N1 — two equal candidates: never picks, flags ambiguous', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await keptLineBid({ description: 'Duplex receptacle', key: 'Power||6.1' }, [
      { category: 'Power', item: '6.2', spec: 'Duplex receptacle', qty: 12, unit: 'EA' },
      { category: 'Power', item: '6.3', spec: 'Duplex receptacle', qty: 18, unit: 'EA' },
    ]);
    const r = await syncTakeoff(bidId);
    const kept = r.lines.find(l => l.qty_overridden)!;
    expect(kept).toMatchObject({ recheck_reason: 'ambiguous_match', takeoff_key: 'Power||6.1', qty: 34 });
    expect(r.unbound).toBe(1);
  });

  it('the reason round-trips through a save and clears with "checked"', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await keptLineBid({ description: 'Duplex receptacle', key: 'Power||6.1' }, [
      { category: 'Power', item: '6.1', spec: 'GFCI receptacle', qty: 10, unit: 'EA' },
    ]);
    const user = await makeUser('owner');
    await syncTakeoff(bidId);
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(user.token)).expect(200);
    const lines = got.body.lines as Array<Record<string, unknown>>;
    expect(lines.find(l => l.qty_overridden)!.recheck_reason).toBe('no_confident_match');
    const saved = await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({ lines, settings: got.body.settings }).expect(200);
    expect((saved.body.lines as Array<Record<string, unknown>>).find(l => l.qty_overridden)!.recheck_reason).toBe('no_confident_match');
    const checked = lines.map(l => (l.qty_overridden ? { ...l, recheck_run_id: null, recheck_reason: null } : l));
    const after = await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({ lines: checked, settings: got.body.settings }).expect(200);
    expect((after.body.lines as Array<Record<string, unknown>>).find(l => l.qty_overridden)).toMatchObject({ recheck_run_id: null, recheck_reason: null });
  });
});

describe('fix round B2 — bids.amount is cleared only when it IS the cleared estimate / Agent 4 price', () => {
  async function amountBid(amount: number | null, grandTotal: number | null, agent4Price: number | null) {
    const user = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id, amount) VALUES ('Amt', 'GC', $1, $2) RETURNING id`, [user.id, amount]);
    const bidId = rows[0].id as string;
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent4_price) VALUES ($1, 'complete', $2)`, [bidId, agent4Price]);
    if (grandTotal != null) {
      await pool.query(`INSERT INTO bid_estimates (bid_id, overhead_pct, profit_pct, line_items, subtotals, total_direct, total_overhead, total_profit, grand_total)
        VALUES ($1, 10, 15, '[]', '{}', 0, 0, 0, $2)`, [bidId, grandTotal]);
    }
    const { reset } = await beginAnalysisRun(bidId);
    const { rows: [b] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    return { amount: b.amount == null ? null : Number(b.amount), reset };
  }

  it('the reviewer\'s repro: estimate 23,173, amount typed as 25,000 -> kept', async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await amountBid(25000, 23173, null);
    expect(r.amount).toBe(25000);
    expect(r.reset.cleared.bidAmount).toBe(false);
    expect(r.reset.amount).toEqual({ before: 25000, kept: true });
  });

  it('equal to the cent to the estimate -> cleared; a cent off -> kept', async (ctx) => {
    if (!ok) return ctx.skip();
    expect((await amountBid(23173.45, 23173.45, null)).amount).toBeNull();
    expect((await amountBid(23173.46, 23173.45, null)).amount).toBe(23173.46);
  });

  it('equal to the Agent 4 price being cleared -> cleared', async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await amountBid(81485.6, 80000, 81485.6);
    expect(r.amount).toBeNull();
    expect(r.reset.amount).toEqual({ before: 81485.6, kept: false });
  });
});

describe('fix round S1 — only the generated flag excludes an input', () => {
  it('a person\'s PDF filed under Takeoff or Proposal is still analysed', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const userTakeoff = await insertDoc(f.bidId, 'E-series takeoff plans.pdf', 'takeoff', { generated: false });
    const userProposal = await insertDoc(f.bidId, 'GC scope sketch.pdf', 'proposal', { generated: false });
    const { files, excluded } = await gatherAnalysisInputs(f.bidId, [], [userTakeoff, userProposal, f.docs.proposalPdf]);
    expect(files.map(x => x.originalname)).toEqual(['E-series takeoff plans.pdf', 'GC scope sketch.pdf']);
    expect(excluded.map(e => e.documentId)).toEqual([f.docs.proposalPdf]);
  });
});

describe('fix round S4 — scope sections', () => {
  it('without scope_meta (sections filled before it existed) a section equal to Agent 2\'s scope still clears', async () => {
    const { resetScope } = await import('../services/rerunReset');
    const agent2 = JSON.stringify({ scopeOfWork: { A_ServiceDistribution: ['800A service entrance', 'MDP'], B_BranchPower: ['Receptacles'] } });
    const r = resetScope({ A: '• 800A service entrance\n• MDP', B: 'Receptacles per E-2 — added by Jake' }, {}, agent2);
    expect(r).toEqual({ scope: { B: 'Receptacles per E-2 — added by Jake' }, meta: { ai: {}, recheck: ['B'] }, cleared: ['A'] });
  });
});

describe('fix round N2 — replaceExisting soft-deletes, and never a generated file', () => {
  it('import re-filing a category soft-deletes the old upload and leaves generated files alone', async (ctx) => {
    if (!ok) return ctx.skip();
    const f = await analyzedBid();
    const oldUpload = await insertDoc(f.bidId, 'old import.pdf', 'proposal', { generated: false });
    const { storeDocument } = await import('../utils/storeDocument');
    const bytes = PDF('new import');
    await storeDocument({ file: { buffer: bytes, originalname: 'new import.pdf', mimetype: 'application/pdf', size: bytes.length } as Express.Multer.File,
      linkedId: f.bidId, linkedName: 'x', div: 'elec', category: 'proposal', uploadedBy: 'test', replaceExisting: true });
    const { rows } = await pool.query('SELECT id, deleted_at FROM documents WHERE id = ANY($1::uuid[])', [[oldUpload, f.docs.proposalPdf, f.docs.proposalDocx]]);
    const m = new Map(rows.map(r => [r.id as string, r.deleted_at]));
    expect(rows).toHaveLength(3); // nothing hard-deleted
    expect(m.get(oldUpload)).not.toBeNull();
    expect(m.get(f.docs.proposalPdf)).toBeNull();
    expect(m.get(f.docs.proposalDocx)).toBeNull();
  });
});

describe('fix round N8 — a small pool per test worker', () => {
  it('caps the pool under test so the full suite stays under max_connections', async () => {
    const { POOL_MAX } = await import('../db/pool');
    expect(POOL_MAX).toBe(5);
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(5);
  });
});
