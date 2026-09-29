// Remodel + footage round, B1 — Agent 2's allowances[] used to be dropped by
// parseAgent2Takeoff (only takeoff[] was read). Now each becomes a row: a
// priced line when it has footage, a visible 0-qty "NEEDS FOOTAGE" row when
// it doesn't. Real input: the 2026-09-29 36th Street live run's Agent 2.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAgent2Allowances, allowanceRows, DEFAULT_ALLOWANCE_CATEGORY } from './footageAllowanceDb';
import { parseAgent2Takeoff } from './bidEstimate';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/36th-street-run-2026-09-29.json'), 'utf8'));
const agent2Raw = '```json\n' + JSON.stringify(run.agent2) + '\n```';

describe('B1 — Agent 2 allowances are never dropped', () => {
  it('reads all three real 36th Street allowances (every one footage 0)', () => {
    const a = parseAgent2Allowances(agent2Raw);
    expect(a.map(x => x.item)).toEqual([
      'Branch circuit conduit/wire 1/2" EMT 2#12 1#10G',
      'HVAC feeders 3/4" 3#6 1#10G',
      '3/4" empty control conduit through inaccessible locations',
    ]);
    // parseAgent2Takeoff still reads only takeoff[] — the allowances come
    // from their own parser, not by changing what "takeoff" means.
    expect(parseAgent2Takeoff(agent2Raw).some(r => /allowance/i.test(r.item))).toBe(false);
  });

  it('footage 0 → a visible NEEDS FOOTAGE row at qty 0 with Agent 2\'s note as evidence', () => {
    const rows = allowanceRows(parseAgent2Allowances(agent2Raw));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.qty).toBe(0);
      expect(r.spec.startsWith('NEEDS FOOTAGE — ')).toBe(true);
      expect(r.category).toBe(DEFAULT_ALLOWANCE_CATEGORY);
      expect(r.unit).toBe('LF');
      expect(r.evidence).toMatch(/not priced until then/);
      expect(r.evidence).toMatch(/field measure/);
    }
    expect(rows[0].item).toBe('Allowance — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G');
  });

  it('footage > 0 → a priced row, category preserved, confidence APPROX (ESTIMATED), evidence = the note', () => {
    const raw = JSON.stringify({ takeoff: [], allowances: [
      { item: '1" PVC site lighting', footage: 240, unit: 'LF', notes: 'E1.1 site plan dimension', category: 'Exterior / Site Lighting' },
      { item: 'Service feeder', footage: '85', unit: 'ft' },
    ] });
    const rows = allowanceRows(parseAgent2Allowances(raw));
    expect(rows[0]).toMatchObject({ category: 'Exterior / Site Lighting', spec: '1" PVC site lighting', qty: 240, unit: 'LF', confidence: 'APPROX' });
    expect(rows[0].evidence).toBe('Agent 2 allowance, ESTIMATED: 240 LF — E1.1 site plan dimension');
    expect(rows[1]).toMatchObject({ category: DEFAULT_ALLOWANCE_CATEGORY, qty: 85, unit: 'LF' });
  });

  it('the label never carries the footage, so the takeoff key is stable when a re-run finds a length', () => {
    const zero = allowanceRows([{ item: 'Branch circuits', footage: 0 }])[0];
    const later = allowanceRows([{ item: 'Branch circuits', footage: 300 }])[0];
    expect(later.item).toBe(zero.item);
    expect(`${later.category}||${later.item}`).toBe(`${zero.category}||${zero.item}`);
  });

  it('malformed or missing input is an empty list, never a throw', () => {
    expect(parseAgent2Allowances(null)).toEqual([]);
    expect(parseAgent2Allowances('not json')).toEqual([]);
    expect(parseAgent2Allowances(JSON.stringify({ allowances: 'x' }))).toEqual([]);
    expect(parseAgent2Allowances(JSON.stringify({ allowances: [null, { footage: 3 }, { item: '  ' }] }))).toEqual([]);
  });
});
