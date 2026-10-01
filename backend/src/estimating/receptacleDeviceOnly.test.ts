// Gap-closing T7 — the receptacle device-only swap is decided by one predicate before and after generation.
import { describe, it, expect } from 'vitest';
import { takeoffRowsFrom, emitsBranchRaceway } from './bidEstimate';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';
import type { Library, LibraryItem, LibraryAssembly } from './library';
import { BRANCH_CATEGORY } from './footageAllowance';

const items: LibraryItem[] = SEED_ITEMS.map(i => ({ id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost, material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true }));
const byCode = new Map(items.map(i => [i.code, i]));
const assemblies: LibraryAssembly[] = SEED_ASSEMBLIES.map(a => ({ id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed', active: true,
  components: a.components.map(c => ({ item_id: c.itemCode, item_code: c.itemCode, item_name: byCode.get(c.itemCode)?.name ?? '', qty_per: c.qtyPer })) }));
const library: Library = { items, assemblies, factors: [] };
const agent2Raw = '```json\n' + JSON.stringify({ takeoff: [{ category: 'Branch Power', item: '20A duplex receptacle circuit, complete', spec: '20A duplex receptacle circuit, complete', qty: 6, unit: 'EA' }] }) + '\n```';
const branchRow = { category: BRANCH_CATEGORY, item: 'Branch conduit allowance — EMT', spec: '3/4" EMT (incl. couplings/straps)', qty: 400, unit: 'LF', confidence: 'APPROX', evidence: 'ratio' };

describe('receptacle device only (J9)', () => {
  const run = async (opts: { on: boolean; branch: boolean; priced?: boolean }) => {
    const boxSeen: boolean[] = [];
    const rows = await takeoffRowsFrom({ agent2Raw, agent1Raw: null, countResult: null, reviewItems: null, priced: opts.priced ?? true, receptacleDeviceOnly: opts.on }, library, args => {
      boxSeen.push(args.pointHasBox!({ category: 'Branch Power', item: '20A duplex receptacle circuit, complete', spec: '20A duplex receptacle circuit, complete', qty: 6, unit: 'EA' } as never));
      return { takeoff: args.takeoffRows as never, rows: (opts.branch ? [branchRow] : []) as never, summary: null };
    });
    return { row: rows.find(r => /receptacle/.test(r.item))!, boxSeen };
  };
  it('on + the allowance carries branch raceway → the bare device by code; the point gets its box from the allowance', async () => {
    const r = await run({ on: true, branch: true });
    expect(r.row.libraryCode).toBe('DEV-DUP');
    expect(r.row.evidence).toMatch(/Device only — raceway, wire and box carried by the branch allowance/);
    expect(r.boxSeen).toEqual([false]);
  });
  it('no branch raceway emitted → re-run with the swap off: the assembly (and its box) stay', async () => {
    const r = await run({ on: true, branch: false });
    expect(r.row.libraryCode ?? null).toBeNull();
    expect(r.boxSeen).toEqual([false, true]);
  });
  it('the setting off, or a bid not being estimated → no swap', async () => {
    expect((await run({ on: false, branch: true })).row.libraryCode ?? null).toBeNull();
    expect((await run({ on: true, branch: true, priced: false })).row.libraryCode ?? null).toBeNull();
  });
  it('emitsBranchRaceway', () => {
    expect(emitsBranchRaceway([branchRow])).toBe(true);
    expect(emitsBranchRaceway([{ ...branchRow, qty: 0 }])).toBe(false);
  });
});
