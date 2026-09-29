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

function compose(opts: { takeoff?: typeof run.agent2.takeoff; allowances?: typeof run.agent2.allowances; existing?: ExistingLineLike[]; agent1?: unknown }) {
  const takeoff = opts.takeoff ?? run.agent2.takeoff;
  const allowances = opts.allowances ?? run.agent2.allowances;
  const ratio = computeFootageAllowance({ takeoffRows: takeoff, agent1: (opts.agent1 ?? run.agent1) as never, agent2Allowances: allowances, settings: DEFAULT_FOOTAGE_SETTINGS, dropFt: 10, slackPct: 10 });
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
    // NB-2 / NSF-2 — signal / LV / grounding runs, and no-material text, are no scope.
    for (const t of ['1" EMT telecom', '3/4" EMT for Cat6', 'CCTV conduit 3/4" EMT', 'Intercom wire', 'Speaker wire', 'Thermostat wire 18/2', 'Audio/visual conduit', 'TV conduit', 'Doorbell wire', 'Nurse call conduit', 'EMS/BAS conduit', '0-10V dimming wire #18', 'Paging conduit', 'Camera conduit 3/4" EMT', 'Single pole switch', '#4 CU GEC to water main', 'GEC #2 CU to water pipe and building steel', '(6) power poles #1-#6']) {
      expect(scopeOfText(t), t).toBeNull();
    }
    expect(scopeOfText('#8 THHN branch (voltage drop)')).toBe('branch');
    // Re-check 2 — "control" only excludes when nothing says power wiring.
    expect(scopeOfText('Motor control center feeder 2" EMT 4#1/0')).toBe('feeder');
    // Dedicated 120V power circuits for LV systems are branch power.
    for (const t of ['Controls power 120V 2#12 1#12G', 'Fire alarm panel 120V circuit 20A/1P', 'Security system power circuit 2#12 1#12G', 'Data rack dedicated circuit 2#10 1#10G', 'TV receptacle circuit 20A/1P']) {
      expect(scopeOfText(t), t).toBe('branch');
    }
    // EV chargers / equipment circuits at #8+ are their own scope.
    expect(scopeOfText('EV charger circuit 1-1/4" EMT 3#6')).toBe('equipment');
    expect(scopeOfText('Control wiring 18ga 4C + 22/2 plenum to each RTU')).toBeNull();
    // Final review SF-A — a conductor spec alone never makes an LV line power.
    for (const t of ['Fire alarm conduit 3/4" EMT 2#14 THHN (NAC)', 'Fire alarm 3/4" EMT, #14 THHN, FPLP', 'Low voltage lighting control 3/4" EMT #14 THHN']) {
      expect(scopeOfText(t), t).toBeNull();
    }
    expect(scopeOfText('Security cameras power 3/4" EMT 2#12 1#12G, 20A/1P breaker')).toBe('branch');
  });
});

describe('BL-2 / NB-2 — typed branch footage comes OFF the ratio (never double-counted, never zeroed outright)', () => {
  const typed: ExistingLineLike = {
    category: CAT, description: 'NEEDS FOOTAGE — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G', unit: 'LF', qty: 670,
    source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: `${CAT}||Allowance — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G`,
  };
  it('670 ft typed: EMT 521 − 670 → 0; wire 2,889 − 2,010 conductor-ft → 879 (split 53/47); MC (own scope) stays', () => {
    const base = compose({});
    const wireBefore = q(base.generated, RATIO_ITEMS.wire12) + q(base.generated, RATIO_ITEMS.wire10);
    const out = compose({ existing: [typed] });
    expect(out.scopes.branch.source).toBe(1);
    expect(q(out.generated, RATIO_ITEMS.emt)).toBe(0);
    expect(q(out.generated, RATIO_ITEMS.wire12) + q(out.generated, RATIO_ITEMS.wire10)).toBeCloseTo(wireBefore - 2010, -1);
    expect(out.generated.find(g => g.item === RATIO_ITEMS.emt)!.evidence).toMatch(/^Reduced by your entered\/measured footage in this scope \(NEEDS FOOTAGE — Branch circuit.*\): 521 − 670 = 0 ft\./);
    expect(q(out.generated, RATIO_ITEMS.mc)).toBe(213);
    expect(out.generated.some(g => `${g.category}||${g.item}` === typed.takeoff_key)).toBe(true);
    expect(out.scopes.feeder.source).toBe(3);
  });

  it('NB-2: a 20 ft extra EMT run takes 20 ft off; a 40 ft telecom run is not power wiring and takes nothing', () => {
    const base = compose({});
    const extra = compose({ existing: [{ category: 'Branch Power', description: '3/4" EMT', unit: 'LF', qty: 20, source: 'manual' }] });
    expect(q(extra.generated, RATIO_ITEMS.emt)).toBe(q(base.generated, RATIO_ITEMS.emt) - 20);
    expect(q(extra.generated, RATIO_ITEMS.wire12)).toBe(q(base.generated, RATIO_ITEMS.wire12));
    const telecom = compose({ existing: [{ category: 'Branch Power', description: '1" EMT telecom', unit: 'LF', qty: 40, source: 'manual' }] });
    expect(telecom.generated.map(g => [g.item, g.qty])).toEqual(base.generated.map(g => [g.item, g.qty]));
  });

  it('Kissimmee site: a typed site line with no library item takes nothing off (flagged "pick the library item"); once picked, it comes off the per-pole PVC', () => {
    const allowances = [{ item: 'Site lighting underground conduit and wire to poles S1/S2', footage: 0, unit: 'LF', notes: 'Routing and lengths not shown' }];
    const takeoff = [{ category: 'Exterior Site Lighting', item: 'Steel square pole on concrete base', qty: 3, unit: 'EA' }, { category: 'Branch Power', item: 'Duplex receptacle', qty: 10, unit: 'EA' }];
    const untouched = compose({ takeoff, allowances });
    expect(q(untouched.generated, RATIO_ITEMS.pvc)).toBe(390);
    const siteTyped: ExistingLineLike = { category: CAT, description: 'NEEDS FOOTAGE — Site lighting underground conduit and wire to poles S1/S2', unit: 'LF', qty: 300, source: 'takeoff', qty_overridden: true, takeoff_key: `${CAT}||Allowance — Site lighting underground conduit and wire to poles S1/S2` };
    const unpicked = compose({ takeoff, allowances, existing: [siteTyped] });
    expect(q(unpicked.generated, RATIO_ITEMS.pvc)).toBe(390);
    expect(unpicked.generated.find(g => g.item === RATIO_ITEMS.pvc)!.evidence).toMatch(/pick the library item; the allowance is unchanged until then/);
    const picked = compose({ takeoff, allowances, existing: [{ ...siteTyped, match_source: 'manual', item_name: '1" PVC Sch 40 (incl. fittings/glue)' }] });
    expect(q(picked.generated, RATIO_ITEMS.pvc)).toBe(90);
    expect(q(picked.generated, RATIO_ITEMS.emt)).toBe(q(untouched.generated, RATIO_ITEMS.emt)); // branch is a different scope
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
  it('manual 3/4" EMT 670 LF + #12 THHN 3,660 LF → branch EMT/wire ratio reduced to 0 (they exceed it); MC whips stay (own scope)', () => {
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
    expect(q(userMc.generated, RATIO_ITEMS.mc)).toBe(0); // 213 − 400 → 0
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

describe('NB-1 — an estimator override on an Agent 2 full-run row survives', () => {
  const run91 = { category: 'Branch Power', item: '9.1', spec: 'Branch circuits 3/4" EMT w/ 2#12 1#12G', qty: 500, unit: 'LF' };
  const partsOf = (out: ReturnType<typeof compose>) => out.takeoff.filter(r => String(r.item).startsWith('9.1 — ')).map(r => [r.item, r.qty, !!r.carryOverride]);
  it('an override on the original row drives every part (stable keys = original + part)', () => {
    const orig: ExistingLineLike = { category: 'Branch Power', description: 'Branch circuits 3/4" EMT w/ 2#12 1#12G', unit: 'LF', qty: 650, source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: 'Branch Power||9.1' };
    const out = compose({ takeoff: [run91], existing: [orig] });
    expect(partsOf(out)).toEqual([['9.1 — conduit', 650, true], ['9.1 — #12 wire ×2', 1300, true], ['9.1 — #12 wire ×1', 650, true]]);
    expect(out.scopes.branch.source).toBe(2);
  });
  it('next sync: the original line is excluded (never counts) and the carried part keeps 650 — no flip back to 500', () => {
    const excludedOrig: ExistingLineLike = { category: 'Branch Power', description: '[No longer in takeoff] Branch circuits', unit: 'LF', qty: 650, source: 'takeoff', qty_overridden: true, excluded: true, takeoff_key: 'Branch Power||9.1' };
    const conduit: ExistingLineLike = { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 650, source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: 'Branch Power||9.1 — conduit' };
    const wire: ExistingLineLike = { category: 'Branch Power', description: '#12 THHN/THWN copper conductor', unit: 'LF', qty: 1300, source: 'takeoff', qty_overridden: true, takeoff_key: 'Branch Power||9.1 — #12 wire ×2' };
    expect(partsOf(compose({ takeoff: [run91], existing: [excludedOrig, conduit, wire] }))).toEqual([['9.1 — conduit', 650, true], ['9.1 — #12 wire ×2', 1300, true], ['9.1 — #12 wire ×1', 650, true]]);
    // An override on a WIRE part alone drives the run too (÷ its count).
    expect(partsOf(compose({ takeoff: [run91], existing: [{ ...wire, qty: 1400 }] }))[0]).toEqual(['9.1 — conduit', 700, true]);
    // Only an excluded line → Agent 2's 500 (never the excluded 650).
    expect(partsOf(compose({ takeoff: [run91], existing: [excludedOrig] }))[0]).toEqual(['9.1 — conduit', 500, false]);
  });
});

describe('NB-3 — feeders are per run', () => {
  const hvac100 = run.agent2.allowances.map((a: { item: string }, i: number) => ({ ...a, footage: i === 1 ? 100 : 0 }));
  const agent1 = { ...run.agent1, panels: [{ name: 'B', fedFrom: '2"C 4#3/0 + #6G from MDP' }] };
  const hvacParts = (out: ReturnType<typeof compose>) => out.generated.filter(g => g.item.startsWith('Allowance — HVAC feeders')).map(g => [g.spec, g.qty]);

  it("the review's repro: typing 80 ft on Panel B's MEASURE line leaves Agent 2's HVAC feeder (100 ft) alone", () => {
    const base = compose({ allowances: hvac100, agent1 });
    const pb = base.generated.find(g => g.feeder?.part === 'conduit')!;
    expect(pb.item).toBe('MEASURE FEEDER — 2" conduit, 4#3/0 + 1#6G — Panel B');
    const typed: ExistingLineLike = { category: pb.category, description: pb.spec, unit: 'LF', qty: 80, source: 'takeoff', qty_overridden: true, takeoff_key: `${pb.category}||${pb.item}` };
    const out = compose({ allowances: hvac100, agent1, existing: [typed] });
    expect(hvacParts(out)).toEqual([['3/4" EMT (incl. couplings/straps)', 100], ['#6 THHN/THWN copper conductor', 300], ['#10 THHN/THWN copper conductor', 100]]);
    // …and that feeder's own wire lines follow its typed run (80 × 4 / × 1).
    expect(out.generated.filter(g => g.feeder?.id === pb.feeder!.id && g.feeder.part === 'wire').map(g => g.qty)).toEqual([320, 80]);
  });

  it('a typed line naming the SAME feeder replaces only that feeder', () => {
    const same: ExistingLineLike = { category: 'Service & Distribution', description: 'HVAC feeder 3/4" EMT 3#6 1#10G', unit: 'LF', qty: 120, source: 'manual' };
    const out = compose({ allowances: hvac100, agent1, existing: [same] });
    expect(hvacParts(out).map(p => p[1])).toEqual([0, 0, 0]);
    expect(out.generated.find(g => g.item.startsWith('Allowance — HVAC feeders'))!.evidence).toMatch(/^Replaced by your entered\/measured footage for this feeder \(HVAC feeder 3\/4" EMT 3#6 1#10G 120 LF\)/);
  });

  it("Kissimmee's 3 feeder groups are separate: typing one run drives only that feeder's wire lines", () => {
    const k = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/realrun/kissimmee-live-2026-09-28.json'), 'utf8'));
    const base = compose({ agent1: k.agent1, allowances: [] });
    const conduits = base.generated.filter(g => g.feeder?.part === 'conduit');
    expect(conduits.map(c => c.item)).toEqual([
      'MEASURE FEEDER — 2" conduit, 4#3/0 + 1#6G — DISCON A, DISCON B',
      'MEASURE FEEDER — 2" conduit ×2 (parallel sets), 8#3/0 — METER',
      'MEASURE FEEDER — 3/4" conduit, 3#6 + 1#10G — RTU-1, RTU-2',
    ]);
    const rtu = conduits[2];
    const out = compose({ agent1: k.agent1, allowances: [], existing: [{ category: rtu.category, description: rtu.spec, unit: 'LF', qty: 150, source: 'takeoff', qty_overridden: true, takeoff_key: `${rtu.category}||${rtu.item}` }] });
    const wires = (id: string) => out.generated.filter(g => g.feeder?.id === id && g.feeder.part === 'wire').map(g => g.qty);
    expect(wires(rtu.feeder!.id)).toEqual([450, 150]);
    expect(wires(conduits[0].feeder!.id)).toEqual([0, 0]);
    expect(wires(conduits[1].feeder!.id)).toEqual([0]);
    // METER: (2)4#3/0 2"C — 2 parallel raceways. 180 conduit-ft typed = 90 ft of route × 8#3/0.
    const meter = conduits[1];
    const typed = compose({ agent1: k.agent1, allowances: [], existing: [{ category: meter.category, description: meter.spec, unit: 'LF', qty: 180, source: 'takeoff', qty_overridden: true, takeoff_key: `${meter.category}||${meter.item}` }] });
    expect(typed.generated.filter(g => g.feeder?.id === meter.feeder!.id && g.feeder.part === 'wire').map(g => g.qty)).toEqual([720]);
  });
});

describe('equipment circuits scope', () => {
  it("an EV charger circuit (#6) never comes off the #12/#10 branch allowance", () => {
    const base = compose({});
    const out = compose({ existing: [{ category: 'Branch Power', description: 'EV charger circuit 1-1/4" EMT 3#6', unit: 'LF', qty: 200, source: 'manual' }] });
    expect(out.generated.filter(g => g.category === BRANCH_CATEGORY).map(g => [g.item, g.qty])).toEqual(base.generated.filter(g => g.category === BRANCH_CATEGORY).map(g => [g.item, g.qty]));
    expect(out.scopes.equipment.source).toBe(1);
  });
});

describe('lump-sum demolition', () => {
  it('passes through with an evidence note asking for the breakdown', () => {
    const out = compose({ takeoff: [...run.agent2.takeoff, { category: 'Demolition', item: 'Demo all existing lighting, receptacles and switches', qty: 1, unit: 'LOT' }] });
    const row = out.takeoff.find(r => r.item === 'Demo all existing lighting, receptacles and switches')!;
    expect(row.evidence).toMatch(/^Lump-sum demolition — not priced as any one device\. Break it down/);
  });
});

