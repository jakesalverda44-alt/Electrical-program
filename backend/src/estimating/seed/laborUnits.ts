// Estimating labor engine — Task 2 seed library.
//
// These are APT's own starting values, authored for this app: industry-typical
// ballpark labor hours and material costs an estimator would expect to see and
// then correct. They are NOT copied from the NECA Manual of Labor Units or any
// other copyrighted price book — every row here is marked `source: 'seed'` so
// the UI can flag it as unverified until Jake edits it or Task 6's calibration
// report adjusts it against real Accubid breakdown hours.
//
// material_cost is a ballpark 2026 figure; materialPriceDate is deliberately
// left out (NULL in the DB) on every seed row — "unverified" is the correct
// starting state, not a bug.
//
// Aliases are pulled from two real sources so the mapper (Task 4) actually
// matches real takeoff output:
//   - backend/src/test/fixtures/bidstd/bid_data.example.json (the canonical
//     Agent 4 output fixture every bidstd test renders against)
//   - common trade phrasing an estimator or Agent 2/4 would write for the same
//     scope of work
// — never the live database.
import { TAKEOFF_CATEGORIES } from '../../bidstd/boilerplate';

export type EstUnit = 'EA' | 'LF' | 'C' | 'M';
export type EstSource = 'seed' | 'accubid' | 'manual' | 'calibrated';

export const CAT = {
  SERVICE: TAKEOFF_CATEGORIES[0],   // 'Service & Distribution'
  INTLGT: TAKEOFF_CATEGORIES[1],    // 'Interior Lighting'
  EXTLGT: TAKEOFF_CATEGORIES[2],    // 'Exterior / Site Lighting'
  CONTROLS: TAKEOFF_CATEGORIES[3],  // 'Lighting Controls'
  BRANCH: TAKEOFF_CATEGORIES[4],    // 'Branch Power'
  SITE: TAKEOFF_CATEGORIES[5],      // 'Site / Underground / Allowances'
  LOWV: TAKEOFF_CATEGORIES[6],      // 'Low Voltage Infrastructure (Conduit & Boxes Only)'
  GROUND: TAKEOFF_CATEGORIES[7],    // 'Grounding'
} as const;

export interface SeedItem {
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  materialCost: number;
  laborHours: number;
  aliases: string[];
}

export interface SeedAssemblyComponent {
  itemCode: string;
  qtyPer: number;
}

export interface SeedAssembly {
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  aliases: string[];
  components: SeedAssemblyComponent[];
}

export interface SeedLaborFactor {
  code: string;
  label: string;
  pct: number;
  groupKey: string;
}

// ── Raceway & wire (per-100-ft `C` / per-1000-ft `M`, fittings/couplings/
// straps lumped into the per-unit price and hours rather than priced
// separately — an estimator reads "3/4" EMT" as one line, not three) ────────

interface SizeRow { size: string; suffix: string; material: number; hours: number }

function raceway(prefix: string, category: string, label: string, rows: SizeRow[]): SeedItem[] {
  return rows.map(r => ({
    code: `${prefix}-${r.suffix}`,
    name: `${r.size} ${label}`,
    category,
    unit: 'C',
    materialCost: r.material,
    laborHours: r.hours,
    aliases: [`${r.size} ${label.toLowerCase()}`],
  }));
}

const EMT_ROWS: SizeRow[] = [
  { size: '1/2"', suffix: '050', material: 45, hours: 3.5 },
  { size: '3/4"', suffix: '075', material: 60, hours: 4.0 },
  { size: '1"', suffix: '100', material: 85, hours: 5.0 },
  { size: '1-1/4"', suffix: '125', material: 115, hours: 6.0 },
  { size: '1-1/2"', suffix: '150', material: 145, hours: 7.0 },
  { size: '2"', suffix: '200', material: 195, hours: 8.5 },
  { size: '2-1/2"', suffix: '250', material: 320, hours: 11.0 },
  { size: '3"', suffix: '300', material: 410, hours: 13.0 },
  { size: '4"', suffix: '400', material: 560, hours: 17.0 },
];
const EMT_ITEMS = raceway('EMT', CAT.BRANCH, 'EMT (incl. couplings/straps)', EMT_ROWS);

const PVC_BRANCH_ROWS: SizeRow[] = [
  { size: '1/2"', suffix: '050', material: 18, hours: 3.0 },
  { size: '3/4"', suffix: '075', material: 25, hours: 3.5 },
  { size: '1"', suffix: '100', material: 35, hours: 4.3 },
  { size: '1-1/4"', suffix: '125', material: 48, hours: 5.2 },
  { size: '1-1/2"', suffix: '150', material: 60, hours: 6.0 },
];
const PVC_UNDERGROUND_ROWS: SizeRow[] = [
  { size: '2"', suffix: '200', material: 85, hours: 7.5 },
  { size: '2-1/2"', suffix: '250', material: 140, hours: 10.0 },
  { size: '3"', suffix: '300', material: 180, hours: 12.0 },
  { size: '4"', suffix: '400', material: 250, hours: 15.5 },
];
const PVC_ITEMS = [
  ...raceway('PVC', CAT.BRANCH, 'PVC Sch 40 (incl. fittings/glue)', PVC_BRANCH_ROWS),
  ...raceway('PVC', CAT.SITE, 'PVC Sch 40, underground (incl. fittings/glue)', PVC_UNDERGROUND_ROWS),
];

const RGD_ROWS: SizeRow[] = [
  { size: '3/4"', suffix: '075', material: 95, hours: 6.0 },
  { size: '1"', suffix: '100', material: 130, hours: 7.5 },
  { size: '1-1/4"', suffix: '125', material: 175, hours: 9.0 },
  { size: '1-1/2"', suffix: '150', material: 220, hours: 10.5 },
  { size: '2"', suffix: '200', material: 290, hours: 13.0 },
  { size: '2-1/2"', suffix: '250', material: 410, hours: 15.5 },
  { size: '3"', suffix: '300', material: 520, hours: 18.0 },
];
const RGD_ITEMS = raceway('RGD', CAT.SERVICE, 'rigid steel conduit (incl. fittings)', RGD_ROWS);

const LFMC_ROWS: SizeRow[] = [
  { size: '1/2"', suffix: '050', material: 55, hours: 4.5 },
  { size: '3/4"', suffix: '075', material: 75, hours: 5.2 },
];
const LFMC_ITEMS = raceway('LFMC', CAT.BRANCH, 'liquidtight flexible metal conduit', LFMC_ROWS);

const MC_ITEMS: SeedItem[] = [
  { code: 'MC-1202', name: '12/2 MC cable', category: CAT.BRANCH, unit: 'C', materialCost: 70, laborHours: 2.5, aliases: ['12/2 mc cable', '12-2 mc', 'mc cable 12/2'] },
  { code: 'MC-1203', name: '12/3 MC cable', category: CAT.BRANCH, unit: 'C', materialCost: 95, laborHours: 2.8, aliases: ['12/3 mc cable', '12-3 mc'] },
  { code: 'MC-1002', name: '10/2 MC cable', category: CAT.BRANCH, unit: 'C', materialCost: 110, laborHours: 3.0, aliases: ['10/2 mc cable', '10-2 mc'] },
  { code: 'MC-1003', name: '10/3 MC cable', category: CAT.BRANCH, unit: 'C', materialCost: 145, laborHours: 3.4, aliases: ['10/3 mc cable', '10-3 mc'] },
];

interface WireRow { gauge: string; suffix: string; material: number; hours: number }
function wire(category: string, rows: WireRow[]): SeedItem[] {
  return rows.map(r => ({
    code: `THHN-${r.suffix}`,
    name: `#${r.gauge} THHN/THWN copper conductor`,
    category,
    unit: 'M',
    materialCost: r.material,
    laborHours: r.hours,
    aliases: [`#${r.gauge} thhn`, `${r.gauge} awg thhn`, `#${r.gauge} thwn`],
  }));
}
const WIRE_BRANCH_ROWS: WireRow[] = [
  { gauge: '14', suffix: '14', material: 65, hours: 3.0 },
  { gauge: '12', suffix: '12', material: 95, hours: 3.5 },
  { gauge: '10', suffix: '10', material: 150, hours: 4.2 },
  { gauge: '8', suffix: '8', material: 240, hours: 5.5 },
];
const WIRE_FEEDER_ROWS: WireRow[] = [
  { gauge: '6', suffix: '6', material: 360, hours: 7.0 },
  { gauge: '4', suffix: '4', material: 560, hours: 8.5 },
  { gauge: '2', suffix: '2', material: 850, hours: 10.5 },
  { gauge: '1', suffix: '1', material: 1050, hours: 12.0 },
  { gauge: '1/0', suffix: '1_0', material: 1280, hours: 13.5 },
  { gauge: '2/0', suffix: '2_0', material: 1550, hours: 15.0 },
  { gauge: '3/0', suffix: '3_0', material: 1870, hours: 16.5 },
  { gauge: '4/0', suffix: '4_0', material: 2260, hours: 18.5 },
  { gauge: '250 kcmil', suffix: '250', material: 2650, hours: 21.0 },
  { gauge: '350 kcmil', suffix: '350', material: 3600, hours: 25.0 },
  { gauge: '500 kcmil', suffix: '500', material: 4950, hours: 30.0 },
  { gauge: '600 kcmil', suffix: '600', material: 5900, hours: 34.0 },
];
const WIRE_ITEMS = [
  ...wire(CAT.BRANCH, WIRE_BRANCH_ROWS),
  ...wire(CAT.SERVICE, WIRE_FEEDER_ROWS),
];

const FITTING_ITEMS: SeedItem[] = [
  { code: 'FIT-CONDBODY', name: 'Conduit body (LB/T), EMT or rigid', category: CAT.BRANCH, unit: 'EA', materialCost: 14, laborHours: 0.25, aliases: ['conduit body', 'lb fitting', 'condulet'] },
  { code: 'FIT-EXPANSION', name: 'Expansion fitting, conduit', category: CAT.BRANCH, unit: 'EA', materialCost: 45, laborHours: 0.4, aliases: ['expansion fitting', 'expansion joint conduit'] },
];

// ── Devices ──────────────────────────────────────────────────────────────────
const DEVICE_ITEMS: SeedItem[] = [
  { code: 'DEV-DUP', name: '20A 125V duplex receptacle, spec grade', category: CAT.BRANCH, unit: 'EA', materialCost: 6, laborHours: 0.35, aliases: ['duplex receptacle, spec grade', 'duplex receptacle', '20a 125v duplex receptacle'] },
  { code: 'DEV-GFCI', name: 'GFCI receptacle', category: CAT.BRANCH, unit: 'EA', materialCost: 22, laborHours: 0.4, aliases: ['gfci receptacle', 'gfi receptacle'] },
  { code: 'DEV-WPGFCI', name: 'GFCI receptacle, weatherproof w/ in-use cover', category: CAT.BRANCH, unit: 'EA', materialCost: 45, laborHours: 0.55, aliases: ['weatherproof gfci', 'wp gfci receptacle', 'in-use cover gfci'] },
  { code: 'DEV-QUAD', name: 'Quad receptacle', category: CAT.BRANCH, unit: 'EA', materialCost: 14, laborHours: 0.45, aliases: ['quad receptacle'] },
  { code: 'DEV-DED20', name: 'Dedicated 20A circuit receptacle', category: CAT.BRANCH, unit: 'EA', materialCost: 10, laborHours: 0.5, aliases: ['dedicated circuit receptacle', 'dedicated 20a receptacle', 'equipment connection'] },
  { code: 'DEV-TL30', name: '30A twist-lock receptacle', category: CAT.BRANCH, unit: 'EA', materialCost: 35, laborHours: 0.7, aliases: ['30a twist-lock receptacle', 'twist lock receptacle'] },
  { code: 'DEV-RANGE50', name: '50A range/dryer receptacle', category: CAT.BRANCH, unit: 'EA', materialCost: 40, laborHours: 0.8, aliases: ['50a range receptacle', 'dryer receptacle'] },
  { code: 'DEV-FLRBOX', name: 'Floor box, device + box', category: CAT.BRANCH, unit: 'EA', materialCost: 85, laborHours: 1.5, aliases: ['floor box'] },
  { code: 'SW-1P', name: 'Single-pole switch, spec grade', category: CAT.BRANCH, unit: 'EA', materialCost: 6, laborHours: 0.3, aliases: ['single pole switch', '1-pole switch', 'switch, spec grade'] },
  { code: 'SW-2P', name: 'Double-pole switch, spec grade', category: CAT.BRANCH, unit: 'EA', materialCost: 9, laborHours: 0.35, aliases: ['double pole switch', '2-pole switch'] },
  { code: 'SW-3W', name: '3-way switch, spec grade', category: CAT.BRANCH, unit: 'EA', materialCost: 9, laborHours: 0.35, aliases: ['3-way switch', 'three way switch'] },
  { code: 'SW-4W', name: '4-way switch, spec grade', category: CAT.BRANCH, unit: 'EA', materialCost: 14, laborHours: 0.4, aliases: ['4-way switch', 'four way switch'] },
  { code: 'SW-DIM', name: 'Dimmer switch', category: CAT.BRANCH, unit: 'EA', materialCost: 28, laborHours: 0.45, aliases: ['dimmer switch', 'dimmer'] },
  { code: 'SW-COMBO', name: 'Combination switch/receptacle device', category: CAT.BRANCH, unit: 'EA', materialCost: 12, laborHours: 0.4, aliases: ['switch/receptacle combo', 'combination device'] },
  { code: 'BOX-4116', name: '4-11/16" square device box', category: CAT.BRANCH, unit: 'EA', materialCost: 8, laborHours: 0.3, aliases: ['4-11/16" box', '4-11/16 square box'] },
  { code: 'BOX-4SQ', name: '4" square device box', category: CAT.BRANCH, unit: 'EA', materialCost: 5, laborHours: 0.25, aliases: ['4" square box', 'j-box'] },
  { code: 'DISC-30', name: 'Disconnect switch, 30A', category: CAT.SERVICE, unit: 'EA', materialCost: 95, laborHours: 1.5, aliases: ['30a disconnect', 'disconnect switch, 30a'] },
  { code: 'DISC-60', name: 'Disconnect switch, 60A', category: CAT.SERVICE, unit: 'EA', materialCost: 145, laborHours: 2.0, aliases: ['60a disconnect', 'disconnect switch, 60a'] },
  { code: 'DISC-100', name: 'Disconnect switch, 100A', category: CAT.SERVICE, unit: 'EA', materialCost: 240, laborHours: 3.0, aliases: ['100a disconnect', 'disconnect switch, 100a'] },
  { code: 'DISC-200', name: 'Disconnect switch, 200A', category: CAT.SERVICE, unit: 'EA', materialCost: 420, laborHours: 4.5, aliases: ['200a disconnect', 'disconnect switch, 200a'] },
  { code: 'DISC-400', name: 'Disconnect switch, 400A', category: CAT.SERVICE, unit: 'EA', materialCost: 950, laborHours: 7.0, aliases: ['400a disconnect', 'disconnect switch, 400a'] },
  // B3: added alongside the ASM-SVCENT-800 fix below — that assembly was
  // built on DISC-400 (a 400A disconnect) despite being an 800A service,
  // which the review flagged as pricing LESS than the 400A service entrance
  // assembly it's supposed to be larger than.
  { code: 'DISC-800', name: 'Disconnect switch, 800A', category: CAT.SERVICE, unit: 'EA', materialCost: 1850, laborHours: 10.5, aliases: ['800a disconnect', 'disconnect switch, 800a'] },
];

// ── Lighting controls ────────────────────────────────────────────────────────
const CONTROLS_ITEMS: SeedItem[] = [
  { code: 'LC-OCCSW', name: 'Occupancy sensor, wall-switch type', category: CAT.CONTROLS, unit: 'EA', materialCost: 35, laborHours: 0.4, aliases: ['wall switch occupancy sensor', 'occupancy sensor switch'] },
  { code: 'LC-OCCCEIL', name: 'Ceiling-mount occupancy sensor w/ power pack', category: CAT.CONTROLS, unit: 'EA', materialCost: 65, laborHours: 0.6, aliases: ['ceiling-mount occupancy sensor w/ power pack', 'ceiling occupancy sensor'] },
  { code: 'LC-PHOTO', name: 'Photocell', category: CAT.CONTROLS, unit: 'EA', materialCost: 30, laborHours: 0.4, aliases: ['photocell', 'photo control'] },
  { code: 'LC-CONTACTOR', name: 'Lighting contactor', category: CAT.CONTROLS, unit: 'EA', materialCost: 180, laborHours: 2.0, aliases: ['lighting contactor'] },
  { code: 'LC-RELAYPANEL', name: 'Lighting relay/control panel', category: CAT.CONTROLS, unit: 'EA', materialCost: 650, laborHours: 4.0, aliases: ['lighting control panel', 'relay panel'] },
];

// ── Lighting fixtures ────────────────────────────────────────────────────────
const INTERIOR_LIGHTING_ITEMS: SeedItem[] = [
  { code: 'LTG-TROF24', name: '2x4 LED recessed troffer', category: CAT.INTLGT, unit: 'EA', materialCost: 95, laborHours: 0.75, aliases: ['type a - 2x4 led recessed troffer', '2x4 led troffer', '2x4 troffer'] },
  { code: 'LTG-TROF24E', name: '2x4 LED troffer w/ emergency battery pack', category: CAT.INTLGT, unit: 'EA', materialCost: 165, laborHours: 0.9, aliases: ['type ae - 2x4 led troffer w/ emergency battery pack', '2x4 troffer w/ emergency battery'] },
  { code: 'LTG-TROF22', name: '2x2 LED troffer', category: CAT.INTLGT, unit: 'EA', materialCost: 85, laborHours: 0.7, aliases: ['2x2 led troffer', '2x2 troffer'] },
  { code: 'LTG-DOWN', name: 'LED downlight/can', category: CAT.INTLGT, unit: 'EA', materialCost: 55, laborHours: 0.6, aliases: ['led downlight', 'recessed can light', 'downlight'] },
  { code: 'LTG-STRIP4', name: 'LED strip fixture, 4ft', category: CAT.INTLGT, unit: 'EA', materialCost: 60, laborHours: 0.65, aliases: ['led strip fixture', '4ft strip light', 'strip fixture'] },
  { code: 'LTG-HIBAY', name: 'LED high-bay fixture', category: CAT.INTLGT, unit: 'EA', materialCost: 210, laborHours: 1.4, aliases: ['led high-bay fixture', 'high bay light'] },
  { code: 'LTG-VAPOR', name: 'LED vapor-tight fixture', category: CAT.INTLGT, unit: 'EA', materialCost: 110, laborHours: 0.8, aliases: ['vapor tight fixture', 'vapor-tight light'] },
  { code: 'LTG-PENDANT', name: 'LED linear pendant fixture', category: CAT.INTLGT, unit: 'EA', materialCost: 180, laborHours: 1.1, aliases: ['linear pendant', 'pendant fixture'] },
  { code: 'LTG-TRACK', name: 'Track lighting head', category: CAT.INTLGT, unit: 'EA', materialCost: 65, laborHours: 0.5, aliases: ['track light head', 'track lighting'] },
  { code: 'LTG-EXIT', name: 'Exit sign, LED, battery backup', category: CAT.INTLGT, unit: 'EA', materialCost: 55, laborHours: 0.6, aliases: ['exit sign', 'led exit sign'] },
  { code: 'LTG-EM', name: 'Emergency egress light, wall-mount, battery', category: CAT.INTLGT, unit: 'EA', materialCost: 65, laborHours: 0.6, aliases: ['emergency egress light', 'emergency light'] },
  { code: 'LTG-EMCOMBO', name: 'Combination exit/emergency light unit', category: CAT.INTLGT, unit: 'EA', materialCost: 95, laborHours: 0.75, aliases: ['exit/emergency combo unit', 'combo exit emergency light'] },
];

const EXTERIOR_LIGHTING_ITEMS: SeedItem[] = [
  { code: 'LTG-WPACK', name: 'Wall pack, LED', category: CAT.EXTLGT, unit: 'EA', materialCost: 145, laborHours: 1.0, aliases: ['wall pack', 'led wall pack'] },
  { code: 'LTG-CANOPY', name: 'Canopy light, LED (fuel canopy)', category: CAT.EXTLGT, unit: 'EA', materialCost: 320, laborHours: 1.8, aliases: ['canopy light', 'fuel canopy light'] },
  { code: 'LTG-POLEHEAD', name: 'Area/pole light fixture head, LED', category: CAT.EXTLGT, unit: 'EA', materialCost: 385, laborHours: 1.2, aliases: ['type j1 - led area light', 'led area light', 'pole light fixture head'] },
  { code: 'LTG-POLE', name: 'Steel light pole on concrete base (base by others)', category: CAT.EXTLGT, unit: 'EA', materialCost: 950, laborHours: 4.5, aliases: ['steel square pole on concrete base', 'light pole, base by others'] },
  { code: 'LTG-BOLLARD', name: 'Bollard light', category: CAT.EXTLGT, unit: 'EA', materialCost: 220, laborHours: 1.3, aliases: ['bollard light', 'bollard fixture'] },
  { code: 'LTG-STEP', name: 'Step/path light', category: CAT.EXTLGT, unit: 'EA', materialCost: 65, laborHours: 0.6, aliases: ['step light', 'path light'] },
  { code: 'LTG-FLOOD', name: 'Flood light, LED', category: CAT.EXTLGT, unit: 'EA', materialCost: 110, laborHours: 0.9, aliases: ['led flood light', 'flood light'] },
];

// ── Distribution ─────────────────────────────────────────────────────────────
const DISTRIBUTION_ITEMS: SeedItem[] = [
  { code: 'PNL-100', name: 'Panelboard, 100A, up to 24 circuits', category: CAT.SERVICE, unit: 'EA', materialCost: 650, laborHours: 5.0, aliases: ['100a panelboard', 'panelboard, 100a'] },
  { code: 'PNL-225', name: 'Panelboard, 225A MLO, up to 42 circuits', category: CAT.SERVICE, unit: 'EA', materialCost: 1450, laborHours: 8.0, aliases: ['225a mlo branch panelboard, 42-circuit', '225a panelboard', 'panelboard, 225a'] },
  { code: 'PNL-400', name: 'Panelboard, 400A, up to 84 circuits', category: CAT.SERVICE, unit: 'EA', materialCost: 2650, laborHours: 12.0, aliases: ['400a panelboard', 'panelboard, 400a'] },
  { code: 'PNL-SUB100', name: 'Sub-panel / load center, 100A', category: CAT.SERVICE, unit: 'EA', materialCost: 320, laborHours: 3.5, aliases: ['sub panel, 100a', 'load center'] },
  { code: 'XFMR-15', name: 'Transformer, dry-type, 15 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 1100, laborHours: 4.0, aliases: ['15 kva transformer', 'dry-type transformer, 15kva'] },
  { code: 'XFMR-30', name: 'Transformer, dry-type, 30 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 1650, laborHours: 5.0, aliases: ['30 kva transformer'] },
  { code: 'XFMR-45', name: 'Transformer, dry-type, 45 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 2200, laborHours: 6.0, aliases: ['45 kva transformer'] },
  { code: 'XFMR-75', name: 'Transformer, dry-type, 75 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 3400, laborHours: 8.0, aliases: ['75 kva transformer'] },
  { code: 'XFMR-112', name: 'Transformer, dry-type, 112.5 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 4600, laborHours: 10.0, aliases: ['112.5 kva transformer', '112 kva transformer'] },
  { code: 'XFMR-150', name: 'Transformer, dry-type, 150 kVA', category: CAT.SERVICE, unit: 'EA', materialCost: 5800, laborHours: 12.0, aliases: ['150 kva transformer'] },
  { code: 'METERCT', name: 'Meter base / CT cabinet', category: CAT.SERVICE, unit: 'EA', materialCost: 450, laborHours: 3.0, aliases: ['meter base', 'ct cabinet'] },
  { code: 'METERCT-MULTI', name: 'Metering CT cabinet, multi-tenant', category: CAT.SERVICE, unit: 'EA', materialCost: 1450, laborHours: 6.0, aliases: ['multi-tenant meter cabinet', 'multi-metering cabinet'] },
  { code: 'SWBD-ALLOW', name: 'Switchboard allowance', category: CAT.SERVICE, unit: 'EA', materialCost: 8500, laborHours: 20.0, aliases: ['switchboard allowance', 'switchboard'] },
  { code: 'ATS-200', name: 'Automatic transfer switch, 200A', category: CAT.SERVICE, unit: 'EA', materialCost: 3200, laborHours: 6.0, aliases: ['ats, 200a', 'automatic transfer switch'] },
  { code: 'GEN-RECEPT', name: 'Generator receptacle/connection box', category: CAT.SERVICE, unit: 'EA', materialCost: 650, laborHours: 3.5, aliases: ['generator receptacle', 'generator connection box'] },
  { code: 'SPD-PNL', name: 'Surge protective device, panel-mounted', category: CAT.SERVICE, unit: 'EA', materialCost: 380, laborHours: 1.0, aliases: ['surge protective device', 'spd'] },
  { code: 'BUS-100SEC', name: 'Busway, 10ft section (100A)', category: CAT.SERVICE, unit: 'EA', materialCost: 420, laborHours: 1.5, aliases: ['busway section', 'busway 100a'] },
];

// ── Site / underground / allowances ─────────────────────────────────────────
const SITE_ITEMS: SeedItem[] = [
  { code: 'SITE-TRENCH', name: 'Trenching & backfill allowance', category: CAT.SITE, unit: 'LF', materialCost: 2.5, laborHours: 0.08, aliases: ['trenching allowance', 'trench and backfill', 'service feeder allowance'] },
  { code: 'SITE-BORE', name: 'Directional bore allowance', category: CAT.SITE, unit: 'LF', materialCost: 4.0, laborHours: 0.05, aliases: ['directional bore', 'bore allowance'] },
  { code: 'SITE-PB1212', name: 'Pull box, underground, 12x12', category: CAT.SITE, unit: 'EA', materialCost: 180, laborHours: 2.0, aliases: ['12x12 pull box', 'underground pull box, 12x12'] },
  { code: 'SITE-PB2424', name: 'Pull box, underground, 24x24', category: CAT.SITE, unit: 'EA', materialCost: 420, laborHours: 3.5, aliases: ['24x24 pull box', 'underground pull box, 24x24'] },
  { code: 'SITE-HH', name: 'Handhole, precast', category: CAT.SITE, unit: 'EA', materialCost: 650, laborHours: 4.0, aliases: ['handhole', 'precast handhole'] },
  { code: 'SITE-PAD', name: 'Concrete pad, equipment (small)', category: CAT.SITE, unit: 'EA', materialCost: 320, laborHours: 3.0, aliases: ['equipment pad', 'concrete equipment pad'] },
  { code: 'SITE-TRCOVER', name: 'Traffic-rated cover, pull box', category: CAT.SITE, unit: 'EA', materialCost: 140, laborHours: 0.5, aliases: ['traffic rated cover', 'traffic lid'] },
  { code: 'SITE-DUCTRACK', name: 'Underground duct spacer/rack, per 100 LF', category: CAT.SITE, unit: 'C', materialCost: 60, laborHours: 1.0, aliases: ['duct spacer', 'duct rack'] },
];

// ── Low voltage / fire alarm rough-in ────────────────────────────────────────
const LOWV_ITEMS: SeedItem[] = [
  { code: 'LV-DATA', name: 'Data outlet rough-in (box + ring + pull string)', category: CAT.LOWV, unit: 'EA', materialCost: 18, laborHours: 0.5, aliases: ['3/4" emt + 4-11/16" box w/ pull string, data outlet', 'data outlet rough-in', 'data box rough-in'] },
  { code: 'LV-FA', name: 'Fire alarm device rough-in', category: CAT.LOWV, unit: 'EA', materialCost: 16, laborHours: 0.5, aliases: ['fire alarm rough-in', 'fa device rough-in'] },
  { code: 'LV-FACP', name: 'Fire alarm control panel power connection', category: CAT.LOWV, unit: 'EA', materialCost: 45, laborHours: 1.5, aliases: ['facp connection', 'fire alarm panel power'] },
  { code: 'LV-AV', name: 'CATV/AV rough-in', category: CAT.LOWV, unit: 'EA', materialCost: 16, laborHours: 0.45, aliases: ['catv rough-in', 'av rough-in'] },
  { code: 'LV-ACCESS', name: 'Access control device rough-in (reader/maglock)', category: CAT.LOWV, unit: 'EA', materialCost: 22, laborHours: 0.6, aliases: ['access control rough-in', 'card reader rough-in', 'maglock rough-in'] },
  { code: 'LV-CAMERA', name: 'Security camera rough-in', category: CAT.LOWV, unit: 'EA', materialCost: 20, laborHours: 0.55, aliases: ['camera rough-in', 'security camera rough-in'] },
  { code: 'LV-INTERCOM', name: 'Intercom/paging rough-in', category: CAT.LOWV, unit: 'EA', materialCost: 18, laborHours: 0.5, aliases: ['intercom rough-in', 'paging rough-in'] },
];

// ── Special / equipment connections ──────────────────────────────────────────
const SPECIAL_ITEMS: SeedItem[] = [
  { code: 'SPEC-FUEL', name: 'Fuel dispenser/ESO rough-in', category: CAT.BRANCH, unit: 'EA', materialCost: 85, laborHours: 2.0, aliases: ['fuel dispenser rough-in', 'eso rough-in', 'emergency shut-off rough-in'] },
  { code: 'SPEC-CARWASH', name: 'Car wash equipment connection', category: CAT.BRANCH, unit: 'EA', materialCost: 65, laborHours: 1.8, aliases: ['car wash equipment connection'] },
  { code: 'SPEC-GATE', name: 'Gate operator rough-in', category: CAT.BRANCH, unit: 'EA', materialCost: 55, laborHours: 1.5, aliases: ['gate operator rough-in', 'gate operator connection'] },
  { code: 'SPEC-EV', name: 'EV charger rough-in', category: CAT.BRANCH, unit: 'EA', materialCost: 75, laborHours: 1.6, aliases: ['ev charger rough-in', 'electric vehicle charger rough-in'] },
  { code: 'SPEC-EVFINAL', name: 'EV charger final connection', category: CAT.BRANCH, unit: 'EA', materialCost: 120, laborHours: 1.2, aliases: ['ev charger final connection', 'ev charger hookup'] },
  { code: 'SPEC-KITCHEN', name: 'Equipment connection — kitchen equipment schedule', category: CAT.BRANCH, unit: 'EA', materialCost: 45, laborHours: 1.4, aliases: ['equipment connection - kitchen equipment schedule', 'kitchen equipment connection'] },
  { code: 'SPEC-MOTOR', name: 'Motor combination starter/disconnect connection', category: CAT.BRANCH, unit: 'EA', materialCost: 320, laborHours: 3.0, aliases: ['motor starter connection', 'combination starter/disconnect'] },
];

// ── Grounding ────────────────────────────────────────────────────────────────
const GROUNDING_ITEMS: SeedItem[] = [
  { code: 'GND-ROD', name: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', category: CAT.GROUND, unit: 'EA', materialCost: 45, laborHours: 1.0, aliases: ['5/8" x 10\' copper-clad ground rod w/ exothermic connection', 'ground rod', 'copper-clad ground rod'] },
  { code: 'GND-BAR', name: 'Ground bar, panel', category: CAT.GROUND, unit: 'EA', materialCost: 35, laborHours: 0.5, aliases: ['ground bar', 'panel ground bar'] },
  { code: 'GND-BOND', name: 'Bonding jumper, equipment', category: CAT.GROUND, unit: 'EA', materialCost: 12, laborHours: 0.3, aliases: ['bonding jumper', 'equipment bonding jumper'] },
  { code: 'GND-RING', name: 'Ground ring conductor, bare copper', category: CAT.GROUND, unit: 'C', materialCost: 220, laborHours: 4.0, aliases: ['ground ring', 'bare copper ground ring conductor'] },
  { code: 'GND-UFER', name: 'Ufer ground (concrete-encased electrode) connection', category: CAT.GROUND, unit: 'EA', materialCost: 25, laborHours: 1.0, aliases: ['ufer ground', 'concrete-encased electrode'] },
  { code: 'GND-LPS', name: 'Lightning protection air terminal allowance', category: CAT.GROUND, unit: 'EA', materialCost: 65, laborHours: 1.0, aliases: ['lightning protection air terminal', 'lps allowance'] },
];

export const SEED_ITEMS: SeedItem[] = [
  ...EMT_ITEMS, ...PVC_ITEMS, ...RGD_ITEMS, ...LFMC_ITEMS, ...MC_ITEMS, ...WIRE_ITEMS, ...FITTING_ITEMS,
  ...DEVICE_ITEMS, ...CONTROLS_ITEMS,
  ...INTERIOR_LIGHTING_ITEMS, ...EXTERIOR_LIGHTING_ITEMS,
  ...DISTRIBUTION_ITEMS, ...SITE_ITEMS, ...LOWV_ITEMS, ...SPECIAL_ITEMS, ...GROUNDING_ITEMS,
];

// ── Assemblies: composite deliverables built from the items above ───────────
// qtyPer is "how much of that item does one assembly unit consume" — e.g. the
// 800A service entrance assembly below consumes 0.4 "C" (40 LF) of 3" rigid
// conduit per assembly (one assembly = one service entrance).
export const SEED_ASSEMBLIES: SeedAssembly[] = [
  {
    code: 'ASM-SVCENT-400', name: '400A 3PH service entrance assembly, NEMA 3R',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['400a service entrance assembly', 'service entrance assembly, 400a'],
    components: [
      { itemCode: 'METERCT', qtyPer: 1 },
      { itemCode: 'DISC-400', qtyPer: 1 },
      { itemCode: 'RGD-300', qtyPer: 0.3 },
      { itemCode: 'THHN-4_0', qtyPer: 0.12 },
      { itemCode: 'GND-ROD', qtyPer: 2 },
    ],
  },
  {
    code: 'ASM-SVCENT-800', name: '800A 120/208V 3PH 4W service entrance assembly, NEMA 3R',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['800a 120/208v 3ph 4w service entrance assembly, nema 3r', '800a service entrance assembly'],
    components: [
      { itemCode: 'METERCT-MULTI', qtyPer: 1 },
      { itemCode: 'DISC-800', qtyPer: 1 },
      { itemCode: 'RGD-300', qtyPer: 0.5 },
      { itemCode: 'THHN-500', qtyPer: 0.16 },
      { itemCode: 'GND-ROD', qtyPer: 3 },
    ],
  },
  {
    code: 'ASM-FEEDER-300KCMIL', name: 'Service feeder run, 3-1/2" conduit, 4#300 KCMIL + #2/0 GND (100 LF)',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['service feeder, 3-1/2" conduit, 4#300 kcmil + #2/0 gnd', 'feeder run 300 kcmil'],
    components: [
      { itemCode: 'RGD-300', qtyPer: 1 },
      { itemCode: 'THHN-250', qtyPer: 0.4 },
      { itemCode: 'THHN-2_0', qtyPer: 0.1 },
    ],
  },
  {
    code: 'ASM-PNL-225', name: '225A MLO branch panelboard, 42-circuit, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['225a mlo branch panelboard, 42-circuit (ecfeci)', '225a panelboard installed'],
    components: [
      { itemCode: 'PNL-225', qtyPer: 1 },
      { itemCode: 'DISC-200', qtyPer: 1 },
      { itemCode: 'RGD-200', qtyPer: 0.2 },
      { itemCode: 'THHN-2_0', qtyPer: 0.08 },
    ],
  },
  {
    code: 'ASM-PNL-400', name: '400A panelboard, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['400a panelboard installed'],
    components: [
      { itemCode: 'PNL-400', qtyPer: 1 },
      { itemCode: 'DISC-400', qtyPer: 1 },
      { itemCode: 'RGD-300', qtyPer: 0.25 },
      { itemCode: 'THHN-4_0', qtyPer: 0.1 },
    ],
  },
  {
    code: 'ASM-XFMR-75', name: 'Transformer, 75 kVA, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['75 kva transformer installed'],
    components: [
      { itemCode: 'XFMR-75', qtyPer: 1 },
      { itemCode: 'DISC-100', qtyPer: 2 },
      { itemCode: 'RGD-150', qtyPer: 0.15 },
      { itemCode: 'THHN-2', qtyPer: 0.06 },
    ],
  },
  {
    code: 'ASM-XFMR-150', name: 'Transformer, 150 kVA, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['150 kva transformer installed'],
    components: [
      { itemCode: 'XFMR-150', qtyPer: 1 },
      { itemCode: 'DISC-200', qtyPer: 2 },
      { itemCode: 'RGD-200', qtyPer: 0.2 },
      { itemCode: 'THHN-4_0', qtyPer: 0.08 },
    ],
  },
  {
    code: 'ASM-ATS-200', name: 'ATS, 200A, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['ats 200a installed', 'automatic transfer switch installed'],
    components: [
      { itemCode: 'ATS-200', qtyPer: 1 },
      { itemCode: 'RGD-150', qtyPer: 0.1 },
      { itemCode: 'THHN-2_0', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-SWBD', name: 'Switchboard allowance, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['switchboard allowance installed'],
    components: [
      { itemCode: 'SWBD-ALLOW', qtyPer: 1 },
      { itemCode: 'RGD-300', qtyPer: 0.4 },
    ],
  },
  {
    code: 'ASM-DISC-100', name: 'Disconnect switch, 100A, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['100a disconnect installed'],
    components: [
      { itemCode: 'DISC-100', qtyPer: 1 },
      { itemCode: 'RGD-100', qtyPer: 0.08 },
      { itemCode: 'THHN-1', qtyPer: 0.03 },
    ],
  },
  {
    code: 'ASM-DISC-200', name: 'Disconnect switch, 200A, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['200a disconnect installed'],
    components: [
      { itemCode: 'DISC-200', qtyPer: 1 },
      { itemCode: 'RGD-150', qtyPer: 0.1 },
      { itemCode: 'THHN-2_0', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-METERCT', name: 'Meter base / CT cabinet, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['meter base installed', 'ct cabinet installed'],
    components: [
      { itemCode: 'METERCT', qtyPer: 1 },
      { itemCode: 'GND-ROD', qtyPer: 1 },
    ],
  },
  {
    code: 'ASM-BUS-SECTION', name: 'Busway section, installed',
    category: CAT.SERVICE, unit: 'EA',
    aliases: ['busway section installed'],
    components: [
      { itemCode: 'BUS-100SEC', qtyPer: 1 },
    ],
  },
  {
    code: 'ASM-DUPLEX', name: '20A duplex receptacle circuit, complete',
    category: CAT.BRANCH, unit: 'EA',
    // N5: "receptacle", "duplex" and "outlet" phrasings should all default to
    // this plain device-plus-box assembly. A bare 'receptacle' or 'outlet'
    // alias is deliberately NOT added here — those single words also appear
    // in GFCI/quad/twist-lock/range receptacle names and the data-outlet
    // assembly, and a bare-word alias would token-subset-match (and steal)
    // all of them. 'duplex' alone is safe (no other candidate uses that
    // word); the qualified two-word phrases cover the common ways an
    // estimator/Agent 2 writes "outlet" without colliding with those.
    aliases: [
      '20a 125v duplex receptacle, spec grade', 'duplex receptacle circuit',
      'duplex', 'duplex outlet', 'receptacle outlet', 'standard receptacle',
    ],
    components: [
      { itemCode: 'DEV-DUP', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-050', qtyPer: 0.25 },
      { itemCode: 'THHN-12', qtyPer: 0.075 },
    ],
  },
  {
    code: 'ASM-GFCI', name: 'GFCI receptacle circuit, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['gfci receptacle circuit'],
    components: [
      { itemCode: 'DEV-GFCI', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-050', qtyPer: 0.25 },
      { itemCode: 'THHN-12', qtyPer: 0.075 },
    ],
  },
  {
    code: 'ASM-WPGFCI', name: 'Weatherproof GFCI receptacle circuit, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['weatherproof gfci circuit'],
    components: [
      { itemCode: 'DEV-WPGFCI', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.25 },
      { itemCode: 'THHN-12', qtyPer: 0.075 },
    ],
  },
  {
    code: 'ASM-KITCHEN-EQUIP', name: 'Equipment connection — kitchen equipment schedule, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['equipment connection - kitchen equipment schedule'],
    components: [
      { itemCode: 'SPEC-KITCHEN', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.2 },
      { itemCode: 'THHN-10', qtyPer: 0.06 },
    ],
  },
  {
    code: 'ASM-FLOORBOX', name: 'Floor box circuit, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['floor box circuit'],
    components: [
      { itemCode: 'DEV-FLRBOX', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.3 },
      { itemCode: 'THHN-12', qtyPer: 0.09 },
    ],
  },
  {
    code: 'ASM-DATA-OUTLET', name: 'Data outlet rough-in, complete',
    category: CAT.LOWV, unit: 'EA',
    aliases: ['3/4" emt + 4-11/16" box w/ pull string, data outlet', 'data outlet rough-in complete'],
    components: [
      { itemCode: 'LV-DATA', qtyPer: 1 },
      { itemCode: 'BOX-4116', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.15 },
    ],
  },
  {
    code: 'ASM-FA-DEVICE', name: 'Fire alarm device rough-in, complete',
    category: CAT.LOWV, unit: 'EA',
    aliases: ['fa device rough-in complete'],
    components: [
      { itemCode: 'LV-FA', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.1 },
    ],
  },
  {
    code: 'ASM-ACCESS', name: 'Access control device rough-in, complete',
    category: CAT.LOWV, unit: 'EA',
    aliases: ['access control device rough-in complete'],
    components: [
      { itemCode: 'LV-ACCESS', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.15 },
    ],
  },
  {
    code: 'ASM-CAMERA', name: 'Security camera rough-in, complete',
    category: CAT.LOWV, unit: 'EA',
    aliases: ['security camera rough-in complete'],
    components: [
      { itemCode: 'LV-CAMERA', qtyPer: 1 },
      { itemCode: 'BOX-4SQ', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.15 },
    ],
  },
  {
    code: 'ASM-OCC-CEIL', name: 'Ceiling-mount occupancy sensor w/ power pack, complete',
    category: CAT.CONTROLS, unit: 'EA',
    aliases: ['ceiling-mount occupancy sensor w/ power pack'],
    components: [
      { itemCode: 'LC-OCCCEIL', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.03 },
    ],
  },
  {
    code: 'ASM-TROFFER-24', name: '2x4 LED troffer, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['type a - 2x4 led recessed troffer', '2x4 led troffer installed'],
    components: [
      { itemCode: 'LTG-TROF24', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.03 },
    ],
  },
  {
    code: 'ASM-TROFFER-24E', name: '2x4 LED troffer w/ emergency battery pack, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['type ae - 2x4 led troffer w/ emergency battery pack'],
    components: [
      { itemCode: 'LTG-TROF24E', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.03 },
    ],
  },
  {
    code: 'ASM-HIBAY', name: 'LED high-bay fixture, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['led high-bay fixture installed'],
    components: [
      { itemCode: 'LTG-HIBAY', qtyPer: 1 },
      { itemCode: 'THHN-10', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-DOWNLIGHT', name: 'LED downlight, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['led downlight installed'],
    components: [
      { itemCode: 'LTG-DOWN', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.02 },
    ],
  },
  {
    code: 'ASM-STRIP4', name: 'LED strip fixture, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['led strip fixture installed'],
    components: [
      { itemCode: 'LTG-STRIP4', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.02 },
    ],
  },
  {
    code: 'ASM-VAPOR', name: 'LED vapor-tight fixture, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['vapor tight fixture installed'],
    components: [
      { itemCode: 'LTG-VAPOR', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.03 },
    ],
  },
  {
    code: 'ASM-EXIT', name: 'Exit sign, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['exit sign installed'],
    components: [
      { itemCode: 'LTG-EXIT', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.02 },
    ],
  },
  {
    code: 'ASM-EMLIGHT', name: 'Emergency egress light, installed',
    category: CAT.INTLGT, unit: 'EA',
    aliases: ['emergency egress light installed'],
    components: [
      { itemCode: 'LTG-EM', qtyPer: 1 },
      { itemCode: 'THHN-12', qtyPer: 0.02 },
    ],
  },
  {
    code: 'ASM-WPACK', name: 'Wall pack, installed',
    category: CAT.EXTLGT, unit: 'EA',
    aliases: ['wall pack installed'],
    components: [
      { itemCode: 'LTG-WPACK', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.1 },
      { itemCode: 'THHN-10', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-CANOPY', name: 'Canopy light, installed',
    category: CAT.EXTLGT, unit: 'EA',
    aliases: ['fuel canopy light installed'],
    components: [
      { itemCode: 'LTG-CANOPY', qtyPer: 1 },
      { itemCode: 'RGD-075', qtyPer: 0.15 },
      { itemCode: 'THHN-10', qtyPer: 0.05 },
    ],
  },
  {
    code: 'ASM-POLE-LIGHT', name: '17\' square steel pole on concrete base, w/ area light fixture',
    category: CAT.EXTLGT, unit: 'EA',
    aliases: ['17\' square steel pole on 3\' concrete base (base by others)', 'pole light assembly'],
    components: [
      { itemCode: 'LTG-POLE', qtyPer: 1 },
      { itemCode: 'LTG-POLEHEAD', qtyPer: 1 },
      { itemCode: 'RGD-100', qtyPer: 0.15 },
      { itemCode: 'THHN-10', qtyPer: 0.06 },
      { itemCode: 'GND-ROD', qtyPer: 1 },
    ],
  },
  {
    code: 'ASM-BOLLARD', name: 'Bollard light, installed',
    category: CAT.EXTLGT, unit: 'EA',
    aliases: ['bollard light installed'],
    components: [
      { itemCode: 'LTG-BOLLARD', qtyPer: 1 },
      { itemCode: 'PVC-100', qtyPer: 0.1 },
      { itemCode: 'THHN-10', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-FLOOD', name: 'Flood light, installed',
    category: CAT.EXTLGT, unit: 'EA',
    aliases: ['flood light installed'],
    components: [
      { itemCode: 'LTG-FLOOD', qtyPer: 1 },
      { itemCode: 'EMT-075', qtyPer: 0.1 },
      { itemCode: 'THHN-10', qtyPer: 0.04 },
    ],
  },
  {
    code: 'ASM-EV-ROUGHIN', name: 'EV charger rough-in, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['ev charger rough-in complete'],
    components: [
      { itemCode: 'SPEC-EV', qtyPer: 1 },
      { itemCode: 'PVC-100', qtyPer: 0.4 },
      { itemCode: 'THHN-8', qtyPer: 0.12 },
    ],
  },
  {
    code: 'ASM-FUEL-ROUGHIN', name: 'Fuel dispenser/ESO rough-in, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['fuel dispenser rough-in complete', 'eso rough-in complete'],
    components: [
      { itemCode: 'SPEC-FUEL', qtyPer: 1 },
      { itemCode: 'PVC-100', qtyPer: 0.3 },
      { itemCode: 'THHN-10', qtyPer: 0.08 },
    ],
  },
  {
    code: 'ASM-CARWASH', name: 'Car wash equipment connection, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['car wash equipment connection complete'],
    components: [
      { itemCode: 'SPEC-CARWASH', qtyPer: 1 },
      { itemCode: 'EMT-100', qtyPer: 0.2 },
      { itemCode: 'THHN-8', qtyPer: 0.06 },
    ],
  },
  {
    code: 'ASM-GATE', name: 'Gate operator rough-in, complete',
    category: CAT.BRANCH, unit: 'EA',
    aliases: ['gate operator rough-in complete'],
    components: [
      { itemCode: 'SPEC-GATE', qtyPer: 1 },
      { itemCode: 'PVC-100', qtyPer: 0.25 },
      { itemCode: 'THHN-12', qtyPer: 0.06 },
    ],
  },
  {
    code: 'ASM-GROUND-ROD', name: '5/8" x 10\' copper-clad ground rod w/ exothermic connection, complete',
    category: CAT.GROUND, unit: 'EA',
    aliases: ['5/8" x 10\' copper-clad ground rod w/ exothermic connection'],
    components: [
      { itemCode: 'GND-ROD', qtyPer: 1 },
      { itemCode: 'GND-BOND', qtyPer: 1 },
    ],
  },
];

// ── Labor factors: named multipliers applied to hours ───────────────────────
export const SEED_LABOR_FACTORS: SeedLaborFactor[] = [
  { code: 'HEIGHT-10-14', label: 'Working height 10–14 ft', pct: 10, groupKey: 'height' },
  { code: 'HEIGHT-14-20', label: 'Working height 14–20 ft', pct: 20, groupKey: 'height' },
  { code: 'HEIGHT-20-PLUS', label: 'Working height 20+ ft', pct: 35, groupKey: 'height' },
  { code: 'OCCUPIED', label: 'Occupied building / renovation', pct: 15, groupKey: 'occupied' },
  { code: 'CONGESTED-CEILING', label: 'Congested ceiling / above-ceiling obstructions', pct: 10, groupKey: 'congested' },
  { code: 'NIGHT-WORK', label: 'Night / after-hours work', pct: 15, groupKey: 'schedule' },
  { code: 'MULTI-STORY', label: 'Multi-story (per floor above 2)', pct: 3, groupKey: 'multistory' },
  { code: 'REMOTE-ACCESS', label: 'Remote / restricted site access', pct: 5, groupKey: 'access' },
  { code: 'PREVAILING-WAGE', label: 'Prevailing wage (placeholder)', pct: 0, groupKey: 'wage' },
];
