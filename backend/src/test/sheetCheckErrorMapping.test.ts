// Plans-panel fix round, Task 2 — the sheet check's own error column (shown
// on the Documents step and echoed onto the Overview panel) runs through
// the same friendlyAnthropicError() mapper as the job profile.
//
// In practice, an Anthropic APIError during classification or reference
// reading is already caught and swallowed PER FILE (buildInventory's own
// design: "never throws for one file" — a rate-limited/overloaded classifier
// call just leaves that file "unclassified" rather than failing the whole
// check), so a raw JSON body was never actually reachable there. The one
// case that DOES escape to runSheetCheck's outer catch — a truncated model
// reply (AgentTruncatedError, re-thrown on purpose by buildInventory) —
// already carries an author-written, human message; this proves the mapper
// passes it through unchanged rather than replacing it with something less
// specific. No real Anthropic call is made.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({
        // A reply cut off at max_tokens — classifyPages' assertNotTruncated
        // throws AgentTruncatedError, which buildInventory re-throws instead
        // of swallowing (it is not a per-file classification miss).
        finalMessage: async () => ({ content: [{ type: 'text', text: '[' }], stop_reason: 'max_tokens', usage: { input_tokens: 0, output_tokens: 0 } }),
      }),
    };
  },
}));

import Anthropic from '@anthropic-ai/sdk';
import { dbAvailable } from './harness';
import { pool } from '../db/pool';
import { claimSheetCheck, runSheetCheck, loadSheetCheck } from '../services/sheetCheck';
import { buildTestPdf } from './fixtures/buildTestPdf';

describe('runSheetCheck — an already-friendly internal error is passed through unchanged', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); });

  it('a truncated classifier reply lands as its own human message, never raw JSON', async () => {
    if (!ok) return;
    const { rows } = await pool.query(
      `INSERT INTO bids (name, gc) VALUES ($1, 'Test GC') RETURNING id`,
      [`SheetCheckErr ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`]);
    const bidId = rows[0].id as string;
    const buf = buildTestPdf(['COVER SHEET\nTEST PROJECT']);
    const token = await claimSheetCheck(bidId, 'k');
    const client = new Anthropic({ apiKey: 'test-key-not-real' });
    await runSheetCheck(bidId, token, [{ originalname: 'plans.pdf', buffer: buf }], {
      client, classifierModel: 'claude-haiku-test', visionModel: 'claude-haiku-test', aiRefs: false,
    });
    const sc = await loadSheetCheck(bidId);
    expect(sc?.status).toBe('error');
    expect(sc?.error).toMatch(/ran out of room/);
    expect(sc?.error).not.toMatch(/\{|"type":"error"/);
    await pool.query('DELETE FROM bids WHERE id=$1', [bidId]);
  }, 30_000);
});
