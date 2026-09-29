// Fix round BL-2/3/4 — one source of truth per wiring scope (branch, feeder,
// site): the estimator's footage, else Agent 2's COMPLETE conduit + wire
// footage, else the ratio. Real inputs: the 36th Street run, Kissimmee's
// site allowance text.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { composeWiringRows, scopeOfText, ExistingLineLike, RATIO_ITEMS } from './wiringScopes';
import { computeFootageAllowance, DEFAULT_FOOTAGE_SETTINGS, BRANCH_CATEGORY } from './footageAllowance';
import { resolveRunParts } from './footageSpecPricing';
import { SEED_ITEMS } from './seed/laborUnits';
import { toLibraryCandidates } from './bidEstimate';
import { LibraryItem } from './library';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/36th-street-run-2026-09-29.json'), 'utf8'));
const items: LibraryItem[] = SEED_ITEMS.map(i => ({ id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost, material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true }));
const candidates = toLibraryCandidates({ items, assemblies: [], factors: [] });
const byId = new Map(items.map(i => [i.id, i]));
const resolveParts = (parts: Array<{ description: string; perFtOfRun: number }>) => resolveRunParts(parts, candidates, byId) != null;
const CAT = 'Site / Underground / Allowances';

function compose(opts: { takeoff?: typeof run.agent2.takeoff; allowances?: typeof run.agent2.allowances; existing?: ExistingLineLike[] }) {
  const takeoff = opts.takeoff ?? run.agent2.takeoff;
  const allowances = opts.allowances ?? run.agent2.allowances;
  const ratio = computeFootageAllowance({ takeoffRows: takeoff, agent1: run.agent1, agent2Allowances: allowances, settings: DEFAULT_FOOTAGE_SETTINGS, dropFt: 10, slackPct: 10 });
  return composeWiringRows({ takeoff, allowances, ratioRows: ratio.rows, existing: opts.existing ?? [], resolveParts, settings: DEFAULT_FOOTAGE_SETTINGS, conductors: ratio.summary.conductors, allowanceCategory: CAT });
}
const q = (rows: Array<{ item: string; qty: number | string }>, item: string) => Number(rows.find(r => r.item === item)?.qty);

describe('scopes', () => {
  it('classifies branch / feeder / site, and never low-voltage, control or grounding runs', () => {
    expect(scopeOfText('Branch circuit conduit/wire 1/2" EMT 2#12 1#10G')).toBe('branch');
    expect(scopeOfText('3/4" EMT (incl. couplings/straps)')).toBe('branch');
    expect(scopeOfText('#12 THHN/THWN copper conductor')).toBe('branch');
    expect(scopeOfText('12/2 MC cable')).toBe('mc');
    expect(scopeOfText('Fixture whip allowance — 12/2 MC')).toBe('mc');
    expect(scopeOfText('HVAC feeders 3/4" 3#6 1#10G')).toBe('feeder');
    expect(scopeOfText('#3/0 THHN/THWN copper conductor')).toBe('feeder');
    expect(scopeOfText('Site lighting underground conduit and wire to poles S1/S2')).toBe('site');
    expect(scopeOfText('3/4" empty control conduit through inaccessible locations')).toBeNull();
    expect(scopeOfText('Concrete encased electrode #2 CU at footing')).toBeNull();
    expect(scopeOfText('1/2" conduit for Venstar control wiring')).toBeNull();
  });
});

describe('BL-2 — typed footage on the branch NEEDS FOOTAGE line is the ONLY branch source', () => {
  const typed: ExistingLineLike = {
    category: CAT, description: 'NEEDS FOOTAGE — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G', unit: 'LF', qty: 670,
    source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: `${CAT}||Allowance — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G`,
  };
  it('ratio EMT / #12 / #10 go to 0 with "replaced by your entered/measured footage"; the MC whip allowance is its own scope and stays', () => {
    const out = compose({ existing: [typed] });
    expect(out.scopes.branch.source).toBe(1);
    expect(out.scopes.mc.source).toBe(3);
    expect(q(out.generated, RATIO_ITEMS.mc)).toBe(213);
    for (const item of [RATIO_ITEMS.emt, RATIO_ITEMS.wire12, RATIO_ITEMS.wire10]) {
      const r = out.generated.find(g => g.item === item)!;
      expect(r.qty, item).toBe(0);
      expect(r.evidence).toMatch(/^Replaced by your entered\/measured footage in this scope \(NEEDS FOOTAGE — Branch circuit/);
    }
    // The typed line keeps its key (the sync keeps the typed 670).
    expect(out.generated.some(g => `${g.category}||${g.item}` === typed.takeoff_key)).toBe(true);
    // Feeder / site scopes are untouched.
    expect(out.scopes.feeder.source).toBe(3);
  });

  it('Kissimmee site: a typed site NEEDS FOOTAGE line replaces the per-pole PVC line', () => {
    const allowances = [{ item: 'Site lighting underground conduit and wire to poles S1/S2', footage: 0, unit: 'LF', notes: 'Routing and lengths not shown' }];
    const takeoff = [{ category: 'Exterior Site Lighting', item: 'Steel square pole on concrete base', qty: 3, unit: 'EA' }, { category: 'Branch Power', item: 'Duplex receptacle', qty: 10, unit: 'EA' }];
    const untouched = compose({ takeoff, allowances });
    expect(q(untouched.generated, RATIO_ITEMS.pvc)).toBe(390);
    const siteTyped: ExistingLineLike = { category: CAT, description: 'NEEDS FOOTAGE — Site lighting underground conduit and wire to poles S1/S2', unit: 'LF', qty: 450, source: 'takeoff', qty_overridden: true, takeoff_key: `${CAT}||Allowance — Site lighting underground conduit and wire to poles S1/S2` };
    const out = compose({ takeoff, allowances, existing: [siteTyped] });
    expect(out.scopes.site.source).toBe(1);
    expect(q(out.generated, RATIO_ITEMS.pvc)).toBe(0);
    expect(q(out.generated, RATIO_ITEMS.emt)).toBeGreaterThan(0); // branch is a different scope
  });
});

describe('BL-3 — Agent 2 footage expands into a COMPLETE conduit + wire set (never drops the wire)', () => {
  const allowances = run.agent2.allowances.map((a: { item: string }, i: number) => ({ ...a, footage: i === 0 ? 670 : i === 1 ? 100 : 0 }));
  it('branch 670 ft → 1/2" EMT 670 + #12 1,340 + #10 670; HVAC 100 ft → 3/4" EMT 100 + #6 300 + #10 100; ratio EMT/wire 0, MC kept', () => {
    const out = compose({ allowances });
    const b = 'Allowance — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G';
    const h = 'Allowance — HVAC feeders 3/4" 3#6 1#10G';
    expect(out.generated.filter(g => g.item.startsWith(b)).map(g => [g.spec, g.qty])).toEqual([
      ['1/2" EMT (incl. couplings/straps)', 670], ['#12 THHN/THWN copper conductor', 1340], ['#10 THHN/THWN copper conductor', 670],
    ]);
    expect(out.generated.filter(g => g.item.startsWith(h)).map(g => [g.spec, g.qty])).toEqual([
      ['3/4" EMT (incl. couplings/straps)', 100], ['#6 THHN/THWN copper conductor', 300], ['#10 THHN/THWN copper conductor', 100],
    ]);
    expect(out.scopes.branch.source).toBe(2);
    expect(q(out.generated, RATIO_ITEMS.emt)).toBe(0);
    expect(q(out.generated, RATIO_ITEMS.wire12)).toBe(0);
    expect(q(out.generated, RATIO_ITEMS.mc)).toBe(213);
  });

  it("a spec that can't be matched completely falls back to the ratio (flagged), never a conduit-only price", () => {
    const out = compose({ allowances: [{ item: 'Branch circuits 3/4" EMT 2#12 1#10G', footage: 500 }], });
    // resolvable → expands; now make one part unresolvable:
    const bad = composeWiringRows({ takeoff: run.agent2.takeoff, allowances: [{ item: 'Branch circuits 3/4" FOO 2#12 1#10G', footage: 500 }], ratioRows: computeFootageAllowance({ takeoffRows: run.agent2.takeoff, settings: DEFAULT_FOOTAGE_SETTINGS, dropFt: 10, slackPct: 10 }).rows, existing: [], resolveParts: () => false, settings: DEFAULT_FOOTAGE_SETTINGS, conductors: 3, allowanceCategory: CAT });
    expect(out.scopes.branch.source).toBe(2);
    expect(bad.scopes.branch.source).toBe(3);
    const row = bad.generated.find(g => g.item === 'Allowance — Branch circuits 3/4" FOO 2#12 1#10G')!;
    expect(row.qty).toBe(0);
    expect(row.spec.startsWith('NEEDS FOOTAGE — ')).toBe(true);
    expect(q(bad.generated, RATIO_ITEMS.wire12)).toBeGreaterThan(0);
    expect(bad.generated.find(g => g.item === RATIO_ITEMS.emt)!.evidence).toMatch(/not a complete conduit \+ wire set/);
  });
});

describe('BL-4 — estimator-entered branch wiring is the only source', () => {
  it('manual 3/4" EMT 670 LF + #12 THHN 3,660 LF → branch EMT/wire ratio 0; MC whips stay (own scope)', () => {
    const existing: ExistingLineLike[] = [
      { category: 'Branch Power', description: '3/4" EMT', unit: 'LF', qty: 670, source: 'manual' },
      { category: 'Branch Power', description: '#12 THHN', unit: 'LF', qty: 3660, source: 'manual' },
    ];
    const out = compose({ existing });
    expect(out.scopes.branch.source).toBe(1);
    expect(out.generated.filter(g => g.category === BRANCH_CATEGORY && g.item !== RATIO_ITEMS.mc).every(g => g.qty === 0)).toBe(true);
    expect(q(out.generated, RATIO_ITEMS.mc)).toBe(213);
  });

  it('MC scope: only an estimator MC line or an Agent 2 MC row replaces the whip allowance', () => {
    const userMc = compose({ existing: [{ category: 'Branch Power', description: '12/2 MC cable', unit: 'LF', qty: 400, source: 'manual' }] });
    expect(userMc.scopes.mc.source).toBe(1);
    expect(q(userMc.generated, RATIO_ITEMS.mc)).toBe(0);
    expect(q(userMc.generated, RATIO_ITEMS.emt)).toBeGreaterThan(0);
    const agentMc = compose({ takeoff: [...run.agent2.takeoff, { category: 'Branch Power', item: '12/2 MC cable whips', qty: 350, unit: 'LF' }] });
    expect(agentMc.scopes.mc.source).toBe(2);
    expect(q(agentMc.generated, RATIO_ITEMS.mc)).toBe(0);
    expect(q(agentMc.generated, RATIO_ITEMS.emt)).toBeGreaterThan(0);
  });

  it("Agent 2 LF takeoff rows with conduit AND wire in the scope are source 2; conduit-only is not (ratio stays, flagged)", () => {
    const withBoth = compose({ takeoff: [...run.agent2.takeoff, { category: 'Branch Power', item: '3/4" EMT', qty: 600, unit: 'LF' }, { category: 'Branch Power', item: '#12 THHN', qty: 3000, unit: 'LF' }] });
    expect(withBoth.scopes.branch.source).toBe(2);
    expect(q(withBoth.generated, RATIO_ITEMS.emt)).toBe(0);
    const conduitOnly = compose({ takeoff: [...run.agent2.takeoff, { category: 'Branch Power', item: '3/4" EMT', qty: 600, unit: 'LF' }] });
    expect(conduitOnly.scopes.branch.source).toBe(3);
    expect(q(conduitOnly.generated, RATIO_ITEMS.wire12)).toBeGreaterThan(0);
  });
});

describe('SF-3 — a measured EMT run carries the wire with it', () => {
  it('wire = measured EMT × 5.54 split 53/47', () => {
    const emt: ExistingLineLike = { category: BRANCH_CATEGORY, description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 600, source: 'takeoff', qty_overridden: true, qty_source: 'markup', takeoff_key: `${BRANCH_CATEGORY}||${RATIO_ITEMS.emt}` };
    const out = compose({ existing: [emt] });
    expect(out.scopes.branch.source).toBe(3);
    expect(q(out.generated, RATIO_ITEMS.wire10)).toBe(Math.round(600 * 5.54 * 0.47));
    expect(q(out.generated, RATIO_ITEMS.wire12)).toBe(Math.round(600 * 5.54 * 0.53));
    expect(out.generated.find(g => g.item === RATIO_ITEMS.wire12)!.evidence).toMatch(/^Derived from your measured\/entered EMT run: 600 ft/);
  });
});
