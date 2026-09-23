// Takeoff accuracy — Agent 1 outputs in the REAL shape AGENT1_SYSTEM asks for
// (prompts.ts: project, service, panels, equipment, quantities, allowances,
// ecfeciItems, flags, scopeNotes, missingSheets + the four counting arrays),
// split into two batches the way the live pipeline batches a big set
// (schedule sheets first, then plans) and merged with the real
// mergeAgent1Batches — the same path runPipeline takes.
//
// KISSIMMEE_* mirrors the AutoZone #10077 Kissimmee FL audit (plan "Why"):
// Agent 1 returned 0 for every interior type on E-3, 0 devices, 8 type-D wall
// packs (audited 5) and no type L, poles S1 x2 + S2 x1 plus a separate
// "4 site lights" from E-7, GC extracted as the OWNER (AutoZone Stores LLC),
// the utility flagged not-found but marked VERIFIED, and missing sheets that
// are actually in the set.
import { mergeAgent1Batches } from '../../../ai/mergeAgent1';

const kissimmeeScheduleBatch = {
  project: {
    name: 'AutoZone #10077', address: 'Kissimmee, FL', gcName: 'AutoZone Stores LLC', gcContact: '', gcEmail: '',
    drawingDate: '2025-02-07', sheets: ['E-0.1', 'E-2', 'E-4'], projectType: 'retail', sqFt: 7381,
  },
  service: { voltage: '208Y/120', mainAmps: 400, phase: 3, utilityCompany: 'Not found on drawings', transformerKVA: '', confidence: 'VERIFIED' },
  panels: [
    { name: 'LP', amps: 225, voltage: '208/120', phase: 3, circuits: 42, location: 'Stockroom', fedFrom: 'Service disconnect', nemaRating: '1', confidence: 'VERIFIED' },
    { name: 'HP', amps: 225, voltage: '208/120', phase: 3, circuits: 42, location: 'Stockroom', fedFrom: 'Service disconnect', nemaRating: '1', confidence: 'VERIFIED' },
  ],
  equipment: [
    { tag: 'RTU-1', description: 'Rooftop unit', amps: 60, voltage: '208', phase: 3, ecfeci: false, confidence: 'VERIFIED' },
  ],
  quantities: [],
  allowances: [],
  ecfeciItems: ['Service entrance assembly', 'MDP'],
  flags: [{ item: 'Utility', issue: 'Utility company not found on drawings', risk: 'MEDIUM' }],
  scopeNotes: ['Owner furnishes fixtures via Graybar'],
  missingSheets: ['E-3', 'E-7'],
  fixtureSchedule: [
    { type: 'A', description: '4 ft LED linear wraparound', wattage: 32, voltage: '120', mounting: 'surface', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'rectangle with A tag', sourceSheet: 'E-0.1' },
    { type: 'B', description: '8 ft LED linear wraparound', wattage: '64W', voltage: '120', mounting: 'surface', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'long rectangle with B tag', sourceSheet: 'E-0.1' },
    { type: 'C', description: '4 ft LED vaportite', wattage: 38, voltage: '120', mounting: 'surface', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'rectangle with C tag', sourceSheet: 'E-0.1' },
    { type: 'M', description: '4 ft LED wraparound, restroom', wattage: 32, voltage: '120', mounting: 'surface', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'rectangle with M tag', sourceSheet: 'E-0.1' },
    { type: 'G', description: '6 in LED recessed downlight', wattage: 15, voltage: '120', mounting: 'recessed', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'small circle with G tag', sourceSheet: 'E-0.1' },
    { type: 'E', description: 'LED exit sign, battery', wattage: 3, voltage: '120', mounting: 'ceiling', location: 'interior', headsPerPole: 0, emergency: true, symbol: 'exit sign with arrows', sourceSheet: 'E-0.1' },
    { type: 'F', description: 'Exit/emergency combo', wattage: 5, voltage: '120', mounting: 'wall', location: 'interior', headsPerPole: 0, emergency: true, symbol: 'exit with two heads', sourceSheet: 'E-0.1' },
    { type: 'K', description: 'Emergency twin-head unit', wattage: 3, voltage: '120', mounting: 'wall', location: 'interior', headsPerPole: 0, emergency: true, symbol: 'two triangles', sourceSheet: 'E-0.1' },
    { type: 'J', description: 'Exterior emergency remote head', wattage: 2, voltage: '120', mounting: 'wall', location: 'interior', headsPerPole: 0, emergency: true, symbol: 'single triangle', sourceSheet: 'E-0.1' },
    { type: 'D', description: 'LED wall pack, full cutoff', wattage: 40, voltage: '120', mounting: 'wall 12 ft AFF', location: 'exterior_building', headsPerPole: 0, emergency: false, symbol: 'half circle on wall with D tag', sourceSheet: 'E-0.1' },
    { type: 'L', description: 'LED wall sconce, entrance', wattage: 18, voltage: '120', mounting: 'wall', location: 'exterior_building', headsPerPole: 0, emergency: false, symbol: 'small half circle with L tag', sourceSheet: 'E-0.1' },
    { type: 'S1', description: 'LED area light on 25 ft pole, single head', wattage: 150, voltage: '208', mounting: 'pole', location: 'site', headsPerPole: 1, emergency: false, symbol: 'square with one head', sourceSheet: 'E-0.1' },
    { type: 'S2', description: 'LED area light on 25 ft pole, twin head', wattage: 300, voltage: '208', mounting: 'pole', location: 'site', headsPerPole: 2, emergency: false, symbol: 'square with two heads', sourceSheet: 'E-0.1' },
  ],
  symbolLegend: [
    { symbol: 'GFI', description: 'GFCI duplex receptacle', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: '', description: 'Duplex receptacle', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'S', description: 'Single receptacle, dedicated', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'OS', description: 'Ceiling occupancy sensor', category: 'lighting_control', sourceSheet: 'E-0.1' },
  ],
  panelCircuits: [
    { panel: 'LP', circuit: '1', description: 'LIGHTING - SALES', loadVA: 2400, sourceSheet: 'E-4' },
    { panel: 'LP', circuit: '3', description: 'LIGHTING - SALES', loadVA: 2080, sourceSheet: 'E-4' },
    { panel: 'LP', circuit: '5', description: 'LIGHTING - STOCK/RR', loadVA: 250, sourceSheet: 'E-4' },
    { panel: 'LP', circuit: '7', description: 'EXIT / EM', loadVA: 80, sourceSheet: 'E-4' },
    { panel: 'LP', circuit: '9', description: 'WALL PACKS', loadVA: 0.25, sourceSheet: 'E-4' },
    { panel: 'HP', circuit: '1,3', description: 'POLE LIGHTS', loadVA: 600, sourceSheet: 'E-4' },
  ],
  furnishStatements: [
    { item: 'Power poles', furnishBy: 'GC', installBy: 'GC', sourceSheet: 'E-2', quote: 'POWER POLES FURNISHED, INSTALLED AND HARD-WIRED BY GC.' },
  ],
};

const kissimmeePlanBatch = {
  project: { name: '', address: '', gcName: 'AutoZone Stores LLC', gcContact: '', gcEmail: '', drawingDate: '', sheets: ['E-1', 'E-3', 'E-7', 'PH0.1'], projectType: '', sqFt: 7350 },
  service: { voltage: '', mainAmps: 0, phase: 3, utilityCompany: '', transformerKVA: '', confidence: 'VERIFIED' },
  panels: [],
  equipment: [],
  quantities: [
    { category: 'Interior Lighting', item: 'Type A 4 ft LED wraparound', qty: 0, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'ASSUMED' },
    { category: 'Interior Lighting', item: 'Type B 8 ft LED wraparound', qty: 0, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'ASSUMED' },
    { category: 'Interior Lighting', item: 'LED exit sign', qty: 0, unit: 'EA', spec: 'Type E', sourceSheet: 'E-3', confidence: 'ASSUMED' },
    { category: 'Exterior Site Lighting', item: 'LED wall pack (D)', qty: 8, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'VERIFIED' },
    { category: 'Exterior Site Lighting', item: 'Pole light S1', qty: 2, unit: 'EA', spec: '', sourceSheet: 'E-1', confidence: 'VERIFIED' },
    { category: 'Exterior Site Lighting', item: 'Pole light S2', qty: 1, unit: 'EA', spec: '', sourceSheet: 'E-1', confidence: 'VERIFIED' },
    { category: 'Exterior Site Lighting', item: 'Site lights', qty: 4, unit: 'EA', spec: '', sourceSheet: 'E-7', confidence: 'VERIFIED' },
    { category: 'Branch Power', item: 'Duplex receptacle', qty: 0, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'ASSUMED' },
    { category: 'Service & Distribution', item: 'Panel LP 225A', qty: 1, unit: 'EA', spec: '', sourceSheet: 'E-4', confidence: 'VERIFIED' },
  ],
  allowances: [{ item: 'Site underground to poles', footage: 0, unit: 'LF', sourceSheet: 'E-1' }],
  ecfeciItems: [],
  flags: [],
  scopeNotes: ['Field verify existing utility'],
  missingSheets: ['E-3', 'E-5'],
};

export const KISSIMMEE_AGENT1_BATCHES = [kissimmeeScheduleBatch, kissimmeePlanBatch];

/** The merged object runPipeline would hold after batching (fresh copy). */
export function kissimmeeAgent1(): Record<string, unknown> {
  return mergeAgent1Batches(JSON.parse(JSON.stringify(KISSIMMEE_AGENT1_BATCHES)));
}

/** A car-wash-style job: an equipment connection schedule and a short fixture
 *  schedule, no device legend (common on car-wash sets). */
export function carWashAgent1(): Record<string, unknown> {
  return mergeAgent1Batches([JSON.parse(JSON.stringify({
    project: { name: 'Big Dan\'s Car Wash', address: '', gcName: 'Bay To Bay', gcContact: '', gcEmail: '', drawingDate: '', sheets: ['E1.0', 'E2.0', 'E3.0'], projectType: 'car_wash', sqFt: 4200 },
    service: { voltage: '480Y/277', mainAmps: 800, phase: 3, utilityCompany: 'Duke Energy', transformerKVA: '', confidence: 'VERIFIED' },
    panels: [{ name: 'MDP', amps: 800, voltage: '480/277', phase: 3, circuits: 42, location: 'Equipment room', fedFrom: 'Utility', nemaRating: '1', confidence: 'VERIFIED' }],
    equipment: [
      { tag: 'EQ-1', description: 'Dryer producer, 15 HP', amps: 21, voltage: '480', phase: 3, ecfeci: false, confidence: 'VERIFIED' },
      { tag: 'EQ-2', description: 'High pressure pump station, 10 HP', amps: 14, voltage: '480', phase: 3, ecfeci: false, confidence: 'VERIFIED' },
      { tag: 'VAC-1', description: 'Central vacuum producer, 20 HP', amps: 27, voltage: '480', phase: 3, ecfeci: false, confidence: 'VERIFIED' },
      { tag: '', description: 'Misc. controls', amps: 0, voltage: '', phase: 1, ecfeci: false, confidence: 'ASSUMED' },
    ],
    quantities: [{ category: 'Branch Power', item: 'Equipment connections', qty: 3, unit: 'EA', spec: '', sourceSheet: 'E3.0', confidence: 'VERIFIED' }],
    allowances: [], ecfeciItems: [], flags: [], scopeNotes: [], missingSheets: [],
    fixtureSchedule: [
      { type: 'W1', description: 'Tunnel vapor-tight LED strip', wattage: 60, voltage: '277', mounting: 'surface', location: 'interior', headsPerPole: 0, emergency: false, symbol: 'rectangle W1', sourceSheet: 'E1.0' },
      { type: 'WP', description: 'LED wall pack', wattage: 40, voltage: '277', mounting: 'wall', location: '', headsPerPole: 0, emergency: false, symbol: 'half circle', sourceSheet: 'E1.0' },
    ],
    symbolLegend: [],
    panelCircuits: [],
    furnishStatements: [{ item: 'Wash equipment', furnishBy: 'Equipment vendor', installBy: 'Equipment vendor', sourceSheet: 'E3.0', quote: 'WASH EQUIPMENT FURNISHED AND SET BY EQUIPMENT VENDOR; EC TO PROVIDE POWER CONNECTIONS.' }],
  }))]);
}
