// Audit batch 3, Task 9 (audit data #10) — loadLinkedDocumentsAsAttachments
// used to select file_data (base64, up to a few MB per row) for every
// document up front, then check the size budget after every row was already
// in the Node heap. It now selects metadata first, decides the budget, and
// only fetches file_data for the documents that survive.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { loadLinkedDocumentsAsAttachments } from '../email/bidAttachments';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(name: string) {
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc) VALUES ($1, 'G') RETURNING id`, [name]
  );
  return rows[0].id as string;
}

async function makeDoc(bidId: string, opts: { name: string; fileSize: number; bytes: string }) {
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_type, file_size, file_data, uploaded_by)
     VALUES ($1, 'x', 'elec', $2, $2, 'plans', 'application/pdf', $3, $4, 'test')`,
    [bidId, opts.name, opts.fileSize, Buffer.from(opts.bytes).toString('base64')]
  );
}

// Neither file_data nor storage_url — fetchDocBytes returns null for this
// row with no exception, simulating a "failed fetch" (a missing/corrupted
// file) without needing to mock an HTTP/Drive call.
async function makeUnfetchableDoc(bidId: string, opts: { name: string; fileSize: number }) {
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_type, file_size, uploaded_by)
     VALUES ($1, 'x', 'elec', $2, $2, 'plans', 'application/pdf', $3, 'test')`,
    [bidId, opts.name, opts.fileSize]
  );
}

describe('loadLinkedDocumentsAsAttachments — two-pass budget (Task 9)', () => {
  it('never selects file_data for a document already over budget by its recorded file_size', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`Attach budget ${Date.now()}`);
    // file_size recorded as over-budget, even though the real bytes are tiny —
    // this proves the decision is made from metadata, not the real payload.
    await makeDoc(bidId, { name: 'huge.pdf', fileSize: 999_999_999, bytes: 'tiny actual bytes' });
    await makeDoc(bidId, { name: 'small.pdf', fileSize: 100, bytes: 'small actual bytes' });

    const querySpy = vi.spyOn(pool, 'query');
    const result = await loadLinkedDocumentsAsAttachments(bidId, { maxTotalBytes: 1000 });

    expect(result.skipped).toContain('huge.pdf');
    expect(result.attachedNames).toContain('small.pdf');

    // The metadata pass never asks for file_data at all.
    const metaCalls = querySpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('FROM documents') && c[0].includes('linked_id = $1')
    );
    expect(metaCalls.length).toBeGreaterThan(0);
    expect(metaCalls.every(c => !(c[0] as string).includes('file_data'))).toBe(true);

    // The file_data pass only asks for the surviving id — never huge.pdf's row.
    const dataCalls = querySpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('SELECT id, file_data')
    );
    expect(dataCalls.length).toBe(1);
    const idsFetched = dataCalls[0][1] as [string[]];
    expect(idsFetched[0]).toHaveLength(1); // only small.pdf's id
  });

  it('same output as before: attaches every document that fits, in order, skips what does not', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`Attach order ${Date.now()}`);
    await makeDoc(bidId, { name: 'a.pdf', fileSize: 400, bytes: 'a'.repeat(400) });
    await makeDoc(bidId, { name: 'b.pdf', fileSize: 400, bytes: 'b'.repeat(400) });
    await makeDoc(bidId, { name: 'c.pdf', fileSize: 400, bytes: 'c'.repeat(400) }); // pushes total over 1000

    const result = await loadLinkedDocumentsAsAttachments(bidId, { maxTotalBytes: 1000 });
    expect(result.attachedNames).toEqual(['a.pdf', 'b.pdf']);
    expect(result.skipped).toEqual(['c.pdf']);
  });

  // Post-review hardening (5d) — a document that survives the metadata
  // pre-filter but then fails to actually fetch must not have "used up" any
  // of the byte budget: a later document that DOES fetch successfully must
  // still get its fair shot at fitting.
  it('a document that fails to fetch does not evict a later attachment that would otherwise fit', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`Attach failed-fetch ${Date.now()}`);
    // Recorded file_size of 60 is well within the 100-byte budget, so this
    // survives the metadata pre-filter — but it has neither file_data nor a
    // storage_url, so fetchDocBytes returns null for it.
    await makeUnfetchableDoc(bidId, { name: 'broken.pdf', fileSize: 60 });
    // Only 60 real bytes — fits the 100-byte budget on its own, but would
    // NOT fit if broken.pdf's 60-byte estimate had already (wrongly) been
    // charged against the total.
    await makeDoc(bidId, { name: 'real.pdf', fileSize: 60, bytes: 'x'.repeat(60) });

    const result = await loadLinkedDocumentsAsAttachments(bidId, { maxTotalBytes: 100 });
    expect(result.skipped).toEqual(['broken.pdf']);
    expect(result.attachedNames).toEqual(['real.pdf']);
  });

  // Post-review hardening (5d) — skipped[] is built by walking the documents
  // in their original created_at order once (matching the pre-Task-9
  // single-pass behavior), not "every metadata-stage skip, then every
  // fetch-stage skip" grouped separately.
  it('skipped[] preserves original document order across both a metadata-stage skip and a fetch-stage skip', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`Attach skip order ${Date.now()}`);
    await makeDoc(bidId, { name: 'a-fits.pdf', fileSize: 50, bytes: 'a'.repeat(50) });
    await makeUnfetchableDoc(bidId, { name: 'b-fetch-fails.pdf', fileSize: 50 }); // fetch-stage skip
    await makeDoc(bidId, { name: 'c-over-budget.pdf', fileSize: 999_999, bytes: 'c'.repeat(50) }); // metadata-stage skip

    const result = await loadLinkedDocumentsAsAttachments(bidId, { maxTotalBytes: 100 });
    expect(result.attachedNames).toEqual(['a-fits.pdf']);
    expect(result.skipped).toEqual(['b-fetch-fails.pdf', 'c-over-budget.pdf']);
  });
});
