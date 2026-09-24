import { describe, it, expect } from 'vitest';
import { tradeAssignmentOf, outsideAptInstall, describeAssignment, gcScopeFindings } from './tradeAssignment';

describe('tradeAssignmentOf — the Kissimmee legend strings (Decision 4: by G.C. = APT)', () => {
  it('"Simplex receptacle, G.C. furnished/installed" -> APT furnish & install', () => {
    const a = tradeAssignmentOf('Simplex receptacle, G.C. furnished/installed')!;
    expect(a).toMatchObject({ furnish: 'APT', install: 'APT', viaGc: true, aptScope: 'full' });
    expect(outsideAptInstall(a)).toBe(false);
    expect(describeAssignment(a)).toBe('by G.C. — APT scope (furnish & install)');
  });
  it('"Duplex receptacle / floor receptacle, G.C." -> APT (a bare trailing G.C.)', () => {
    expect(tradeAssignmentOf('Duplex receptacle / floor receptacle, G.C.')).toMatchObject({ furnish: 'APT', install: 'APT', viaGc: true, aptScope: 'full' });
  });
  it('"Exhaust fan recessed, installed by HVAC, wired by EC" -> another trade installs, APT connects', () => {
    const a = tradeAssignmentOf('Exhaust fan recessed, installed by HVAC, wired by EC')!;
    expect(a).toMatchObject({ install: 'OtherTrade', otherTrade: 'HVAC', aptConnects: true, aptScope: 'connection' });
    expect(outsideAptInstall(a)).toBe(true);
    expect(describeAssignment(a)).toBe('installed by HVAC; APT wires / connects it');
  });
  it('owner-furnished is still APT-installed; by others / N.I.C. is not APT\'s', () => {
    expect(tradeAssignmentOf('Retail power pole, furnished by owner')).toMatchObject({ furnish: 'Owner', aptScope: 'install' });
    expect(outsideAptInstall(tradeAssignmentOf('Retail power pole, furnished by owner'))).toBe(false);
    expect(tradeAssignmentOf('Security camera (by others)')).toMatchObject({ aptScope: 'none' });
    expect(tradeAssignmentOf('Kitchen hood, N.I.C.')).toMatchObject({ aptScope: 'none' });
    // Fix round S9 — a bare owner's-vendor is who FURNISHES it; APT installs.
    expect(tradeAssignmentOf("Data outlet (by owner's vendor)")).toMatchObject({ furnish: 'Vendor', install: null, aptScope: 'install' });
    expect(tradeAssignmentOf('Wash equipment furnished and installed by equipment vendor')).toMatchObject({ furnish: 'Vendor', install: 'Vendor', aptScope: 'none' });
    expect(tradeAssignmentOf('Water heater, furnished and installed by plumbing contractor, EC to connect')).toMatchObject({ aptScope: 'connection', otherTrade: 'plumbing' });
  });
  it('plain descriptions say nothing (APT by default)', () => {
    expect(tradeAssignmentOf('4 ft LED linear wraparound')).toBeNull();
    expect(tradeAssignmentOf('GFCI duplex receptacle')).toBeNull();
  });
});

describe('gcScopeFindings — never an exclusion', () => {
  const data = {
    exclusions: ['Receptacles by GC.', 'Fire alarm by others.', 'Power poles furnished by the GC.', 'Painting by the general contractor.'],
    takeoff: [{ name: 'Branch Power', items: [
      { item: 'Duplex receptacle', description: '20A', unit: 'EA', qty: 11, furnish_by: 'GC' },
      { item: 'Power pole', description: '', unit: 'EA', qty: 8, furnish_by: 'GC (EC installs)' },
      { item: 'GFCI receptacle', description: '', unit: 'EA', qty: 16 },
    ] }],
  } as never;
  it('flags electrical items put on the GC (exclusions and GC-furnished lines), not other trades or APT-installed lines', () => {
    const f = gcScopeFindings(data);
    expect(f.map(x => `${x.category}: ${x.line}`)).toEqual([
      'exclusions: Receptacles by GC.',
      'exclusions: Power poles furnished by the GC.',
      'Branch Power: Duplex receptacle',
    ]);
  });
  it('a term the rule / estimator really gave the GC is not a finding', () => {
    expect(gcScopeFindings(data, [/power\s*poles?/i]).map(x => x.line)).toEqual(['Receptacles by GC.', 'Duplex receptacle']);
  });
});

describe('fix round S9 / N10 / S8', () => {
  it('S9: a bare "BY OWNER" is owner-furnished, APT-installed — a zero count still blocks', () => {
    const a = tradeAssignmentOf('Type F pendant — BY OWNER')!;
    expect(a).toMatchObject({ furnish: 'Owner', install: null, aptScope: 'install' });
    expect(outsideAptInstall(a)).toBe(false);
    expect(tradeAssignmentOf("Security camera (by owner's vendor)")).toMatchObject({ furnish: 'Vendor', aptScope: 'install' });
    // explicit installs / others / trades / N.I.C. are information
    expect(outsideAptInstall(tradeAssignmentOf('Kiosk, furnished and installed by owner'))).toBe(true);
    expect(outsideAptInstall(tradeAssignmentOf('Phone outlet, by others'))).toBe(true);
    expect(outsideAptInstall(tradeAssignmentOf('Hood, N.I.C.'))).toBe(true);
    expect(outsideAptInstall(tradeAssignmentOf('Exhaust fan, installed by HVAC, wired by EC'))).toBe(true);
  });
  it('N10: "Signage by sign vendor, power by EC" is the vendor\'s sign with APT\'s connection; "BY GC/EC" is APT', () => {
    expect(tradeAssignmentOf('Signage by sign vendor, power by EC')).toMatchObject({ furnish: 'Vendor', install: 'Vendor', aptConnects: true, aptScope: 'connection' });
    expect(tradeAssignmentOf('Duplex receptacle BY GC/EC')).toMatchObject({ furnish: 'APT', install: 'APT', aptScope: 'full' });
  });
  it('S8: the phrasings the gate missed, per item, and scope bullets', () => {
    const data = {
      exclusions: ['GC to provide receptacles.', 'Temporary power by GC.', 'Low voltage cabling by GC.', 'Receptacles and lighting by GC.'],
      sections: [{ title: 'B. Branch Power', bullets: ['Floor boxes by the general contractor.'] }],
      takeoff: [],
    } as never;
    expect(gcScopeFindings(data).map(f => f.line)).toEqual([
      'GC to provide receptacles.', 'Temporary power by GC.', 'Low voltage cabling by GC.', 'Receptacles and lighting by GC.', 'Floor boxes by the general contractor.',
    ]);
    // Only lighting was really assigned to the GC: the mixed line still blocks (receptacles).
    const lightingOnly = gcScopeFindings(data, [/\blight(ing)?\b|fixtures?/i]);
    expect(lightingOnly.find(f => f.line === 'Receptacles and lighting by GC.')!.detail).toContain('(Receptacles)');
  });
});
