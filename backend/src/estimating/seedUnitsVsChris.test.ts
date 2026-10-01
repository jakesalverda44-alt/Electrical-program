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
      ['MC-1202', 2.5, 1.52], ['MC-1203', 2.8, 1.66],
      ['PVC-050', 3, 3.1], ['PVC-075', 3.5, 3.6], ['PVC-100', 4.3, 4.2], ['PVC-125', 5.2, 5], ['PVC-150', 6, 5.6], ['PVCB-200', 7, 6.8],
      ['RGD-100', 7.5, 6.2],
      ['THHN-1', 12, 13.5], ['THHN-2', 10.5, 12.4], ['THHN-3_0', 16.5, 18.8], ['THHN-6', 7, 8.9], ['THHN-600', 34, 42.4], ['THHN-8', 5.5, 7],
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
    // Policy: no existing library row changes this round (the five labor moves are deferred).
    expect([seed('DISC-30').laborHours, seed('DISC-60').laborHours, seed('DISC-200').laborHours, seed('LTG-POLE').laborHours, seed('LTG-POLEHEAD').laborHours]).toEqual([1.5, 2.0, 4.5, 4.5, 1.2]);
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
