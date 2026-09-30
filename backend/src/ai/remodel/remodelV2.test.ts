// Price accuracy round D1-D4 — pure rules (no I/O).
import { describe, it, expect } from 'vitest';
import { conventionScope, inScope, typeScopeClass, unionScope } from './statusScope';
import type { CountTarget } from '../countTargets';

const t = (key: string, category: CountTarget['category'], description: string): CountTarget => ({
  type: key, key, description, symbolHint: '', wattage: null, category, source: 'legend', sourceSheet: 'E1.0', headsPerPole: null, emergency: false,
});
const q = (quote: string) => ({ quote, source: 'counter' as const });

describe('D1 — a printed rule covers only what it names', () => {
  it('the real 36th rule (misspelt "RECEPTICLE") covers receptacles only', () => {
    const s = conventionScope(q('SHADED SYMBOL DENOTES NEW RECEPTICLE'));
    expect(s).toEqual(new Set(['receptacle']));
    // the real 36th types
    const types = [
      t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('GFI', 'device', 'Duplex receptacle w/ ground fault interrupter'),
      t('42', 'device', 'Duplex receptacle at 42" AFF'), t('WP', 'device', 'Duplex receptacle weather protected'),
    ];
    for (const x of types) expect([x.key, inScope(s, x)]).toEqual([x.key, true]);
    const others = [
      t('DISCONNECT', 'equipment', 'Disconnect'), t('ELECTRICAL PANEL', 'equipment', 'Electrical panel'), t('$', 'lighting_control', 'Single pole switch'),
      t('AHU #1', 'equipment', 'Air Handler Unit #1'), t('COMP #1', 'equipment', 'A/C Comp Unit #1'), t('DISC-A', 'equipment', 'Disconnect, warehouse north wall'),
      t('TRIANGLE', 'device', 'Telephone'), t('A', 'interior_lighting', '2X4 LED recessed troffer'),
    ];
    for (const x of others) expect([x.key, inScope(s, x)]).toEqual([x.key, false]);
  });
  it('fixtures / devices / switches / equipment / unqualified', () => {
    expect(conventionScope(q('SHADED FIXTURES ARE NEW'))).toEqual(new Set(['fixture']));
    expect(conventionScope(q('DASHED DEVICES TO BE REMOVED'))).toEqual(new Set(['receptacle', 'switch', 'control', 'device']));
    expect(conventionScope(q('BOLD SWITCHES ARE NEW'))).toEqual(new Set(['switch']));
    expect(conventionScope(q('(E) EXISTING EQUIPMENT TO REMAIN'))).toEqual(new Set(['equipment']));
    expect(conventionScope(q('(E) = EXISTING'))).toBe('all');
    expect(conventionScope(q('BOLD LINES INDICATE NEW WORK'))).toBe('all');
    expect(conventionScope({ quote: 'Estimator: shaded / filled symbols are new; open symbols are existing', source: 'estimator' })).toBe('all');
    expect(unionScope([q('SHADED RECEPTACLES ARE NEW'), q('(E) = EXISTING')])).toBe('all');
    expect(inScope(null, t('X', 'device', 'Duplex receptacle'))).toBe(false);
  });
  it('type classes', () => {
    expect(typeScopeClass(t('S3', 'lighting_control', 'Three way switch'))).toBe('switch');
    expect(typeScopeClass(t('OS', 'lighting_control', 'Occupancy sensor'))).toBe('control');
    expect(typeScopeClass(t('EXIT', 'interior_lighting', 'Exit sign'))).toBe('fixture');
    expect(typeScopeClass(t('J', 'equipment', 'Junction box'))).toBe('equipment');
  });
});
