// Price accuracy round, C5 — demolition units for the classes that had none
// (disconnect / equipment connection, device (other), site pole light,
// building-mounted exterior fixture, lighting control). NECA-style defaults,
// named "(default — confirm)"; the AI demolition reading's own line names
// (ai/remodel/demolition.ts demolitionItem) map to them.
import { describe, it, expect } from 'vitest';
import { SEED_ITEMS, SEED_ASSEMBLIES, DEMOLITION_DEFAULT_ITEMS } from './seed/laborUnits';
import { mapTakeoffLines, LibraryCandidate, fromLegacyTakeoff, demolitionClass, isLumpSumDemolition } from './mapper';
import { DEMO_CLASSES, demolitionItem } from '../ai/remodel/demolition';

const candidates: LibraryCandidate[] = [
  ...SEED_ASSEMBLIES.map(a => ({ kind: 'assembly' as const, id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed' })),
  ...SEED_ITEMS.map(i => ({ kind: 'item' as const, id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases, source: 'seed' })),
];
const map = (item: string, spec?: string) => mapTakeoffLines(fromLegacyTakeoff([{ category: 'Demolition', item, spec, qty: 3, unit: 'EA' }]), candidates)[0];

describe('C5 — demolition default units', () => {
  it('are $0 material, EA, in Demolition, and say "default — confirm"', () => {
    expect(DEMOLITION_DEFAULT_ITEMS.map(i => [i.code, i.laborHours])).toEqual([
      ['DEMO-EQUIP', 0.75], ['DEMO-DEVICE', 0.15], ['DEMO-SITEPOLE', 3.0], ['DEMO-EXTFIX', 0.5], ['DEMO-CONTROL', 0.25],
    ]);
    for (const i of DEMOLITION_DEFAULT_ITEMS) {
      expect(i.materialCost).toBe(0);
      expect(i.unit).toBe('EA');
      expect(i.category).toBe('Demolition');
      expect(i.name).toMatch(/\(default — confirm\)$/);
    }
  });

  it("the AI reading's own line names map to them (D4 coordinates by these names)", () => {
    const expected: Record<string, string> = {
      'DEMO-EQUIPMENT': 'DEMO-EQUIP', 'DEMO-DEVICE': 'DEMO-DEVICE', 'DEMO-SITE-POLE': 'DEMO-SITEPOLE',
      'DEMO-EXTERIOR': 'DEMO-EXTFIX', 'DEMO-CONTROL': 'DEMO-CONTROL',
      // The classes that already had units keep them.
      'DEMO-FIXTURE': 'DEMO-FLUOR24', 'DEMO-HIGHBAY': 'DEMO-HIDHB', 'DEMO-EXIT': 'DEMO-EXITEM', 'DEMO-RECEPTACLE': 'DEMO-RECEPT',
      'DEMO-SWITCH': 'DEMO-SW1P', 'DEMO-SWITCH3': 'DEMO-SW3W', 'DEMO-JBOX': 'DEMO-JBOX',
    };
    for (const c of DEMO_CLASSES) {
      const name = demolitionItem(c);
      const m = map(name, `Existing to be removed — counted`);
      expect(m.matchedCode, name).toBe(expected[c.key]);
      expect(m.matchConfidence === 'exact' || m.matchConfidence === 'alias', name).toBe(true);
      expect(isLumpSumDemolition('Demolition', name), name).toBe(false);
    }
  });

  it('the 36th demolition the estimator counted (10 disconnects / panels, 1 phone) prices', () => {
    expect(map('Demolition — equipment connection / disconnect').matchedCode).toBe('DEMO-EQUIP');
    expect(map('Demolition — device (other)').matchedCode).toBe('DEMO-DEVICE');
  });

  it('classes stay exclusive: a 1-pole switch is never a pole light, a time switch is a control, a disconnect never a switch', () => {
    expect(demolitionClass('Demolition - Switch 1 Pole')).toBe('switch');
    expect(demolitionClass('Demolition — time switch')).toBe('control');
    expect(demolitionClass('Demolition — 60A disconnect switch')).toBe('equipment');
    expect(demolitionClass('Demolition — wall pack')).toBe('exterior');
    expect(demolitionClass('Demolition — site pole light')).toBe('site-pole');
    expect(demolitionClass('Demolition — HID high bay fixture')).toBe('hid');
    expect(demolitionClass('Demolition — fluorescent fixture up to 2x4')).toBe('fixture');
    expect(demolitionClass('Demolition — receptacle and switch')).toBeNull();
  });
});
