// Real-run fix 3 — why the live Kissimmee run expanded no power-pole outlet,
// on its own data: (1) every pole package was bound to its PP#n EQUIPMENT
// type and the S1 assembly rule swallowed the outlets; (2) PP#1 / PP#6 were
// counted one pole per CIRCUIT from Panel A (3 and 2 poles); (3) the tester
// pole's tag (B20,24) was counted under the legend's "POWER POLE TAG 1-6", so
// PP#4 had no host count. The expansion itself is proven on the replay.
import { describe, it, expect } from 'vitest';
import { isAssemblyPackage, expandTypicals } from './typicals';
import { bindHostTagMarks, consolidateTargets } from './consolidate';
import { scheduleCounts } from './schedules';
import { dropCircuitRepeats, type SheetMarkResolution } from './viewportResolve';
import { buildCountTargets } from '../countTargets';
import { loadKissimmeeLive } from '../../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive();
const cons = consolidateTargets(buildCountTargets(live.agent1).targets);
const pkg = (id: string) => live.countResult.evidence.typicals.find(t => t.id.endsWith(id))!;

describe('real-run fix 3 — power-pole typicals', () => {
  it('an equipment host (a power pole) never swallows its outlets; the display baseflex (a device symbol) still does', () => {
    for (const id of ['@9#1', '@9#2', '@9#3', '@9#4', '@9#5']) expect(isAssemblyPackage(pkg(id), cons.targets), id).toBe(false);
    expect(isAssemblyPackage(pkg('@5#1'), cons.targets)).toBe(true); // FLEX+J: J-box, flex, receptacle in the kick plate
  });

  it('circuits a pole\'s own description cites feed ONE pole (PP#1 A-30/32/36 = 1, PP#6 A-40/42 = 1); "(2)" parts pods = 2', () => {
    const sc = scheduleCounts(cons.targets, live.countResult.evidence.tables);
    expect([sc.get('PP#1')?.qty, sc.get('PP#3')?.qty, sc.get('PP#6')?.qty]).toEqual([1, 2, 1]);
    expect(sc.get('PP#6')!.note).toContain('feed one PP#6');
    // Named rows still count one each (5 battery chargers on B-15 … 23).
    expect(sc.get('BATTERY CHARGER')?.qty).toBe(5);
  });

  it('the legend\'s pole-tag marks bind to their member by the circuit the live counter read; no circuit -> never guessed', () => {
    const sheet = { status: 'counted', sheet: { key: `${live.countResult.sheets[2].key}` }, placed: live.countResult.marks.filter(m => m.sheetKey.endsWith('#50')).map(m => ({ ...m })) };
    const b = bindHostTagMarks(cons.targets, [sheet], new Map([['PP#1', new Set(['A30', 'A32', 'A36'])]]));
    expect(b.map(x => `${x.member}:${x.circuit}`)).toEqual(['PP#3:A33', 'PP#6:A40,42', 'PP#4:B20,24', 'PP#3:A35', 'PP#2:A29']);
    // The two tags with no circuit (the office pole #1 and the data/security pipes #5) stay the legend's.
    expect(sheet.placed.filter(p => p.typeKey === 'POWER POLE TAG 1-6').length).toBe(2);
  });

  it('pole #2 on the main plan and again on the #11 office plan (both A29) is one pole', () => {
    const res: SheetMarkResolution = {
      counted: [
        { typeKey: 'PP#2', x: 1057.44, y: 2102.63, circuit: 'A29', viewportId: 'v@1', viewportKind: 'main_plan' },
        { typeKey: 'PP#2', x: 139.78, y: 494.96, circuit: 'A29', viewportId: 'v@11', viewportKind: 'enlarged_plan' },
        // Receptacles: one circuit feeds several — never matched this way.
        { typeKey: 'SIMPLEX', x: 1, y: 1, circuit: 'A30', viewportId: 'v@1', viewportKind: 'main_plan' },
        { typeKey: 'SIMPLEX', x: 331.97, y: 607.11, circuit: 'A30', viewportId: 'v@11', viewportKind: 'enlarged_plan' },
      ],
      excluded: [], enlarged: [{ viewportId: 'v@11', viewportLabel: '#11', typeKey: 'PP#2', enlarged: 1, mainInArea: 0, mainTotal: 1, decision: 'take_enlarged', note: 'x' }], pending: [], notes: [],
    };
    expect(dropCircuitRepeats(res, new Set(['PP#2']))).toBe(1);
    expect(res.counted.map(m => `${m.typeKey}@${m.viewportId}`)).toEqual(['PP#2@v@1', 'SIMPLEX@v@1', 'SIMPLEX@v@11']);
    expect(res.enlarged[0].enlarged).toBe(0);
  });

  it('never guessed: a pole type with no host count expands nothing and asks (the tester, live)', () => {
    const r = expandTypicals([pkg('@9#4')].map(p => ({ ...p, hostTargetKey: 'PP#4', devices: p.devices.map(d => ({ ...d, targetKey: d.targetKey === 'DUPLEX' ? 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE' : d.targetKey })) })),
      new Map([['PP#4', { count: null, sheets: [], marks: [], reason: 'no tester power pole was found on the plans' }]]), [], cons.targets);
    expect(r.expansions.map(e => [e.status, e.expanded])).toEqual([['no_multiplier', 0], ['no_multiplier', 0]]);
  });
});
