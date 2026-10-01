// Price accuracy round, decision 2 — Jake's standing rule: labor units match
// Chris's Accubid. Reads every wire / MC / conduit labor unit off Chris's
// five BOMs and compares it with the seed item a takeoff line would price
// from. #12 / #10 THHN now match (the change this round); the rest are the
// follow-up list in the C report, pinned here so it can't drift silently.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import { SEED_ITEMS } from './seed/laborUnits';

const DIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const JOBS = ['36th-street', 'kissimmee', 'north-port', 'orlando-clubhouse', 'rockledge'];

/** Chris's labor unit per seed code (converted to the seed item's unit). */
function chrisUnits(): Map<string, number> {
  const out = new Map<string, number>();
  for (const j of JOBS) for (const r of parseAccubidBom(fs.readFileSync(path.join(DIR, `${j}-bom.txt`), 'utf8')).rows) {
    const d = r.description.replace(/\s+/g, ' ');
    if (r.laborUnit == null) continue;
    let code: string | null = null;
    let perSeedUnit = r.laborUnit;
    const wire = d.match(/^#(\d+(?:\/0)?|\d{3})\s+(?:Black|Green|White|Red|Blue)?\s*Wire THHN/i);
    if (wire) code = `THHN-${wire[1].replace('/', '_')}`;
    const mc = d.match(/^#12\/(2|3)C MC Cable/i);
    if (mc) { code = `MC-120${mc[1]}`; perSeedUnit = r.laborUnit / 10; } // Chris per M, seed per C
    const cond = d.match(/^((?:\d+-)?\d+(?:\/\d+)?)" Conduit - (EMT|PVC|RMC|LFMC)/i);
    if (cond) {
      const size = cond[1];
      const kind = cond[2].toUpperCase();
      code = SEED_ITEMS.find(i => i.unit === 'C' && i.name.startsWith(`${size}" `) && (kind === 'EMT' ? /EMT/.test(i.name) : kind === 'PVC' ? /PVC/.test(i.name) && !/underground/.test(i.name) : kind === 'RMC' ? /rigid/.test(i.name) : /liquidtight/.test(i.name)))?.code ?? null;
    }
    if (code && SEED_ITEMS.some(i => i.code === code)) out.set(code, perSeedUnit);
  }
  return out;
}

describe('decision 2 — seed labor units vs Chris\'s BOMs', () => {
  const chris = chrisUnits();
  const diffs = [...chris.entries()]
    .map(([code, c]) => ({ code, seed: SEED_ITEMS.find(i => i.code === code)!.laborHours, chris: Math.round(c * 1000) / 1000 }))
    .filter(d => Math.abs(d.seed - d.chris) > 1e-9)
    .sort((a, b) => a.code.localeCompare(b.code));

  it('#12 and #10 THHN match Chris (5.15 / 5.65 h per M)', () => {
    expect(chris.get('THHN-12')).toBe(5.15);
    expect(chris.get('THHN-10')).toBe(5.65);
    expect(SEED_ITEMS.find(i => i.code === 'THHN-12')!.laborHours).toBe(5.15);
    expect(SEED_ITEMS.find(i => i.code === 'THHN-10')!.laborHours).toBe(5.65);
  });

  it('pins the follow-up list (seed ≠ Chris) the report quotes', () => {
    // eslint-disable-next-line no-console
    console.log('[seed vs Chris]', diffs.map(d => `${d.code} seed ${d.seed} / Chris ${d.chris}`).join('; '));
    expect(diffs.map(d => [d.code, d.seed, d.chris])).toEqual([
      ['EMT-050', 3.5, 2.78], ['EMT-075', 4, 3.2], ['EMT-100', 5, 4.05],
      ['LFMC-075', 5.2, 4.95],
      ['MC-1203', 2.8, 1.66], // MC-1202 moved to Chris's 1.52 (gap-closing J10, migration 166)
      ['PVC-050', 3, 3.1], ['PVC-075', 3.5, 3.6], ['PVC-100', 4.3, 4.2], ['PVC-125', 5.2, 5], ['PVC-150', 6, 5.6], ['PVCB-200', 7, 6.8],
      ['RGD-100', 7.5, 6.2],
      ['THHN-1', 12, 13.5], ['THHN-2', 10.5, 12.4], ['THHN-600', 34, 42.4], ['THHN-8', 5.5, 7], // THHN-3_0 / THHN-6 moved (gap-closing J5)
    ]);
  });
});

// Accuracy round D3 / D4 + Jake's decision 1 — the new / moved units are
// Chris's own BOM rows (cited), and migration 158 agrees with the seed TS.
describe('accuracy round — D3 / D4 units vs Chris and migration 158', () => {
  const bomRows = JOBS.flatMap(j => parseAccubidBom(fs.readFileSync(path.join(DIR, `${j}-bom.txt`), 'utf8')).rows.map(r => ({ job: j, ...r })));
  const chrisUnit = (job: string, re: RegExp) => bomRows.find(r => r.job === job && re.test(r.description))?.laborUnit;
  const seed = (code: string) => SEED_ITEMS.find(i => i.code === code)!;
  it('each Chris-sourced unit equals the BOM row it cites', () => {
    const cites: Array<[string, string, RegExp, number]> = [
      ['TERM-10', 'north-port', /^#10 Motor Termination/, 1], ['TERM-8', 'orlando-clubhouse', /^#8 Motor Termination/, 1],
      ['TERM-6', 'kissimmee', /^#6 Motor Termination/, 1], ['TERM-2', 'north-port', /^#2 Motor Termination/, 1], ['TERM-1', 'rockledge', /^#1 Motor Termination/, 1],
      ['DISC-200F', 'kissimmee', /^200A Safety Switch .*Fusible/, 1], ['LTG-POLE-LAB', 'kissimmee', /^20' H .*Pole Round/, 1], ['LTG-POLEHEAD-LAB', 'kissimmee', /Pole Top\/Arm Mount/, 1],
      ['FUSE-200', 'kissimmee', /^200A Fuse/, 1], ['PP-SET', 'kissimmee', /^Power Poles/, 1], ['FAN-CEIL', 'kissimmee', /^Hang Fans/, 1],
      ['LTG-POLE-30', 'north-port', /^30' H .*Pole Round/, 1],
    ];
    for (const [code, job, re] of cites) expect(seed(code).laborHours, `${code} vs ${job}`).toBe(chrisUnit(job, re));
    // Simplex = single receptacle 20 h/C + its wallplate 3 h/C; anchor set = template 0.7 + 4 × bolt 0.12.
    expect(seed('DEV-SIMPLEX').laborHours).toBeCloseTo((chrisUnit('kissimmee', /^20A 125V 3W Ivory Single Receptacle/)! + chrisUnit('kissimmee', /Single Receptacle Wallplate/)!) / 100, 6);
    expect(seed('POLE-ANCHOR').laborHours).toBeCloseTo(chrisUnit('kissimmee', /^Anchor Bolt Template/)! + 4 * chrisUnit('kissimmee', /Anchor Bolt - Steel/)!, 6);
    // B5 — the labor-only twins carry Chris's pole / head labor with $0 material (owner-furnished = his Quoted).
    expect([seed('LTG-POLE-LAB').materialCost, seed('LTG-POLEHEAD-LAB').materialCost]).toEqual([0, 0]);
    // Policy: no existing library row changed in the accuracy round; the five labor moves were deferred to the
    // gap-closing round (migration 166, after the library history of 164) — Chris's units now.
    expect([seed('DISC-30').laborHours, seed('DISC-60').laborHours, seed('DISC-200').laborHours, seed('LTG-POLE').laborHours, seed('LTG-POLEHEAD').laborHours]).toEqual([1.1, 1.55, 3.1, 4.8, 2.2]);
    expect(fs.readFileSync(path.join(__dirname, '../../../database/migrations/158_accuracy_round_units.sql'), 'utf8')).not.toMatch(/SET labor_hours/);
    for (const c of ['TERM-4', 'TERM-1_0', 'RISER-PIPEPOLE']) expect(seed(c).name).toMatch(/default — confirm/);
  });
  it('migration 158 inserts / updates exactly the seed TS values', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/158_accuracy_round_units.sql'), 'utf8');
    for (const m of sql.matchAll(/\('([A-Z0-9_-]+)', '((?:[^']|'')*)', '[^']*', '(EA|LF|C|M)', ([\d.]+), NULL, ([\d.]+),/g)) {
      const s = seed(m[1]);
      expect([m[2].replace(/''/g, "'"), Number(m[4]), Number(m[5])], m[1]).toEqual([s.name, s.materialCost, s.laborHours]);
    }
    for (const m of sql.matchAll(/SET labor_hours = ([\d.]+), updated_at = now\(\)\n WHERE code = '([A-Z0-9_-]+)'/g)) expect(seed(m[2]).laborHours, m[2]).toBe(Number(m[1]));
    expect([...sql.matchAll(/INSERT INTO est_items/g)].length).toBe(17);
  });
});

// Gap-closing round — migration 165's new items and 166's moves are Chris's BOM rows (cited), and the SQL, the seed
// TS and the replay mirror agree.
describe('gap-closing — 165 items / 166 moves vs Chris and the seed TS', () => {
  const bom = (job: string) => parseAccubidBom(fs.readFileSync(path.join(DIR, `${job}-bom.txt`), 'utf8')).rows;
  const unit = (job: string, re: RegExp) => bom(job).find(r => re.test(r.description.replace(/\s+/g, ' ')))!;
  const seed = (code: string) => SEED_ITEMS.find(i => i.code === code)!;
  it('165: each new item is the BOM row it cites', () => {
    expect([seed('TAP-POLARIS').laborHours, seed('TAP-POLARIS').materialCost]).toEqual([unit('kissimmee', /Polaris Taps/).laborUnit, 45]);
    expect([seed('SVC-GUTTER').laborHours, seed('SVC-GUTTER').materialCost]).toEqual([unit('kissimmee', /Service Gutter/).laborUnit, 600]);
    expect([seed('GND-SVC').laborHours, seed('GND-SVC').materialCost]).toEqual([unit('kissimmee', /Grounding Materials/).laborUnit, 890]);
    expect([seed('BKBD-FRT').laborHours, seed('BKBD-FRT').materialCost]).toEqual([unit('kissimmee', /Fire Rated Playwood/).laborUnit, 250]);
    expect(seed('LUG-6').laborHours).toBeCloseTo(unit('kissimmee', /Wire Lug Compression/).laborUnit! / 100, 6);
    expect(seed('LTG-WM175').laborHours).toBe(unit('kissimmee', /175W= Luminaire Wall Mount/).laborUnit);
    expect(seed('LTG-WM250').laborHours).toBe(unit('kissimmee', /250W= Luminaire Wall Mount/).laborUnit);
    expect([seed('LV-CMP244').laborHours, seed('LV-CMP244').materialCost]).toEqual([unit('kissimmee', /^CMP #24-4 Pair/).laborUnit, 230]);
    expect([seed('ALW-MISC').laborHours, seed('ALW-MISC').materialCost]).toEqual([unit('kissimmee', /Misc Materials/).laborUnit, 1500]);
    expect(seed('METER-SKT').laborHours).toBe(1.5);
    const conn = unit('kissimmee', /MC Connector Saddle/);
    expect(seed('ALW-FIT-MCLUM').laborHours).toBeCloseTo(Math.round((conn.qty / 144) * 100) / 100 * (conn.laborUnit! / 100), 4);
  });
  it('166: every moved unit is the BOM unit it cites', () => {
    const u = (job: string, re: RegExp, per = 1) => unit(job, re).laborUnit! / per;
    expect(seed('THHN-3_0').laborHours).toBe(u('kissimmee', /^#3\/0 Black Wire THHN/));
    expect(seed('THHN-6').laborHours).toBe(u('kissimmee', /^#6 Black Wire THHN/));
    expect(seed('PNL-225').laborHours).toBe(u('kissimmee', /225A 42-Circuit/));
    expect(seed('LTG-STRIP4').laborHours).toBe(u('kissimmee', /Luminaire Linear Wraparound/));
    expect(seed('LTG-DOWN').laborHours).toBe(u('kissimmee', /Luminaire Recessed Downlight/));
    expect(seed('LTG-EXIT').laborHours).toBe(u('kissimmee', /Exit Light Single Face/));
    expect(seed('MC-1202').laborHours).toBeCloseTo(u('kissimmee', /^#12\/2C MC Cable/) / 10, 6);
    expect(seed('DEV-DUP').laborHours).toBeCloseTo((u('kissimmee', /Duplex Receptacle - Commercial/) + u('kissimmee', /Duplex Receptacle Wallplate/)) / 100, 6);
    expect(seed('DEV-GFCI').laborHours).toBeCloseTo((u('kissimmee', /GFCI Duplex Receptacle/) + 3) / 100, 6);
    expect(seed('SW-1P').laborHours).toBeCloseTo((u('36th-street', /^20A .*Toggle Switch Single Pole/) + u('36th-street', /Toggle Switch Wallplate/)) / 100, 6);
    expect(seed('SW-3W').laborHours).toBeCloseTo((u('orlando-clubhouse', /Toggle Switch Three Way/) + 3) / 100, 6);
    expect(seed('DISC-60').laborHours).toBe(u('kissimmee', /^60A Safety Switch/));
    expect(seed('DISC-200').laborHours).toBe(u('kissimmee', /^200A Safety Switch .*Fusible/));
    expect(seed('LTG-POLE').laborHours).toBe(u('kissimmee', /^20' H .*Pole Round/));
    expect(seed('LTG-POLEHEAD').laborHours).toBe(u('kissimmee', /Pole Top\/Arm Mount/));
  });
  it('the SQL of 165 / 166, the seed TS, the pre-round view and the replay mirror agree', async () => {
    const { GAP_UNIT_MOVES, GAP_INSERT_CODES } = await import('../eval/gapMigrations');
    const { GAP_ROUND_PREVIOUS_LABOR, GAP_CLOSING_ITEMS } = await import('./seed/laborUnits');
    const s165 = fs.readFileSync(path.join(__dirname, '../../../database/migrations/165_gap_closing_items.sql'), 'utf8');
    const s166 = fs.readFileSync(path.join(__dirname, '../../../database/migrations/166_gap_closing_unit_moves.sql'), 'utf8');
    const ins = [...s165.matchAll(/\('([A-Z0-9_-]+)', '((?:[^']|'')*)', '([^']*)', '(EA|LF|C|M)', ([\d.]+), NULL, ([\d.]+),/g)];
    expect(ins.map(m => m[1]).sort()).toEqual([...GAP_INSERT_CODES].sort());
    for (const m of ins) { const g = GAP_CLOSING_ITEMS.find(i => i.code === m[1])!; expect([m[2].replace(/''/g, "'"), m[3], m[4], Number(m[5]), Number(m[6])], m[1]).toEqual([g.name, g.category, g.unit, g.materialCost, g.laborHours]); }
    const moves = [...s166.matchAll(/SET labor_hours = ([\d.]+), updated_at = now\(\)\n WHERE code = '([A-Z0-9_-]+)' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> ([\d.]+);/g)];
    expect(moves.map(m => [m[2], Number(m[1])])).toEqual(GAP_UNIT_MOVES.map(m => [m.code, m.to]));
    for (const m of GAP_UNIT_MOVES) { expect(seed(m.code).laborHours, m.code).toBe(m.to); expect(GAP_ROUND_PREVIOUS_LABOR[m.code], m.code).toBe(m.from); }
    expect(Object.keys(GAP_ROUND_PREVIOUS_LABOR).sort()).toEqual(GAP_UNIT_MOVES.map(m => m.code).sort());
  });
});
