// Evidence round 4.6 — facility checklists: punch-list items for job types
// whose scope regularly includes things a symbol/schedule count alone won't
// catch (a canopy's own lighting circuit, a vacuum island's power, a
// self-storage site's several buildings, a national retail prototype's
// signage package). These are NOT evidence-driven counts — they are the
// same kind of "did you check this?" prompt an estimator keeps on a sticky
// note, put on the SAME review queue (non-blocking: 'confirm' items) so
// nothing about the job type is only in someone's head. Pure.
export type FacilityKind = 'fuel_cstore' | 'car_wash' | 'storage' | 'prototype_retail';

export interface FacilityChecklistDef { id: string; text: string }

const CHECKLISTS: Record<FacilityKind, FacilityChecklistDef[]> = {
  fuel_cstore: [
    { id: 'canopy-lighting', text: "Canopy lighting and canopy column power scoped separately from the c-store building's own count." },
    { id: 'dispenser-power', text: 'Dispenser power, comm and card-reader conduit/circuits scoped per island, from the equipment schedule.' },
    { id: 'stp', text: 'Submersible turbine pump (STP) power circuits scoped, one per tank.' },
    { id: 'tank-monitoring', text: 'Tank monitoring / leak-detection system power and comm scoped.' },
    { id: 'price-sign', text: 'Price sign / pylon sign power and comm scoped, furnish/install checked against the account rule.' },
  ],
  car_wash: [
    { id: 'vacuum-islands', text: 'Vacuum island power (and payment/comm, if any) scoped per island, not as one lump sum.' },
    { id: 'tunnel-equipment', text: 'Tunnel equipment (conveyor, blowers, dryers, pumps) power scoped from the equipment schedule, never by symbol counting.' },
    { id: 'pay-station', text: 'Pay station / kiosk power and comm scoped.' },
    { id: 'reclaim', text: 'Water reclaim / treatment system power scoped.' },
  ],
  storage: [
    { id: 'unit-lighting', text: 'Per-unit interior lighting and receptacles counted per BUILDING, not assumed identical across the whole site.' },
    { id: 'gate-access', text: 'Gate operator and keypad/access-control power and comm scoped.' },
    { id: 'exterior-per-building', text: 'Exterior building-mounted lighting counted per building — self-storage sites are often several buildings on one sheet.' },
  ],
  prototype_retail: [
    { id: 'signage-package', text: "The full signage package (pylon, wall, monument) checked against the account rule's furnish/install defaults." },
    { id: 'prototype-revision', text: "This set's revision checked against the national account's current prototype electrical standard, if one is on file." },
  ],
};

const KEYWORDS: Record<FacilityKind, RegExp> = {
  fuel_cstore: /\bc-?store|convenience\s*store|fuel(?:ing)?|gas\s*station|dispenser|fuel\s*canopy\b/i,
  car_wash: /\bcar\s*wash\b|\bcarwash\b|tunnel\s*wash/i,
  storage: /\bself[- ]?storage\b|\bmini[- ]?storage\b|storage\s*facility/i,
  prototype_retail: /\bprototype\b/i,
};

/** Which facility checklists apply, from the bid's project type. More than
 *  one may apply (a fuel c-store is also often a national-account
 *  prototype, when project_type says so explicitly — "prototype" is never
 *  inferred just from having a brand: most branded jobs are ordinary retail
 *  buildouts, not a repeated national prototype). */
export function facilityKindsFor(projectType: string | null | undefined, _brand?: string | null): FacilityKind[] {
  const text = `${projectType ?? ''}`;
  return (Object.keys(KEYWORDS) as FacilityKind[]).filter(k => KEYWORDS[k].test(text));
}

export interface FacilityChecklistItem { kind: FacilityKind; id: string; text: string }

export function facilityChecklistItems(projectType: string | null | undefined, brand?: string | null): FacilityChecklistItem[] {
  return facilityKindsFor(projectType, brand).flatMap(k => CHECKLISTS[k].map(c => ({ kind: k, ...c })));
}
