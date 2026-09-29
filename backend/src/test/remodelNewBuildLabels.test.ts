// Re-check N1 — a printed LABEL on a new build's electrical sheet never
// switches remodel mode on. A real text-layer plan set (vector PDF: E0.1
// "SITE POWER PLAN" with the reviewer's four labels in its notes, D0.1 a
// site "Demolition Plan"), through the REAL counting stage with a fake
// client: no remodel mode, no extra calls, D0.1 never counted.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSymbolPdf, type SymbolPage } from './fixtures/takeoff/buildSymbolPdf';
import { fakeAnthropic, systemText, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { runCountingStage } from '../ai/countingStage';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { textConventions } from '../ai/remodel/status';
import type { InventoryPage } from '../ai/countSheets';

const FILE = 'new-build.pdf';
const LABELS = ['(E) EXISTING UTILITY POLE TO REMAIN', 'CONNECT TO (E) EXISTING FPL TRANSFORMER', '(N) NEW 200A SERVICE', 'BOLD LINES INDICATE NEW WORK'];
const NOTES = [
  'GENERAL NOTES: 1. ALL WORK SHALL COMPLY WITH THE NATIONAL ELECTRICAL CODE AND LOCAL AMENDMENTS.',
  '2. CONTRACTOR SHALL COORDINATE ALL SERVICE WORK WITH THE SERVING UTILITY BEFORE BID.',
  '3. ALL CONDUCTORS COPPER THHN/THWN, MINIMUM #12 AWG UNLESS NOTED OTHERWISE ON PLANS.',
];

function pdf(labels: string[]): Buffer {
  const page = (texts: string[], symbols: SymbolPage['symbols']): SymbolPage => ({
    mediaBox: [0, 0, 2592, 1728], symbols,
    texts: texts.map((text, i) => ({ x: 150, y: 1500 - i * 30, size: 14, text })),
  });
  return buildSymbolPdf([
    page([...NOTES, ...labels, 'SITE POWER PLAN'], [{ type: 'A', x: 900, y: 700 }, { type: 'A', x: 1200, y: 700 }]),
    page(['DEMOLITION PLAN', 'EXISTING BUILDING TO BE DEMOLISHED BY SITEWORK CONTRACTOR', ...NOTES], []),
  ]);
}

const INVENTORY: InventoryPage[] = [
  { file: FILE, page: 1, sheetNo: 'E0.1', title: 'Site Power Plan', discipline: 'electrical', cls: 'plan', included: true },
  { file: FILE, page: 2, sheetNo: 'D0.1', title: 'Demolition Plan', discipline: 'architectural', cls: 'plan', included: false },
];
const AGENT1 = {
  project: { name: 'New store', projectType: 'retail' },
  fixtureSchedule: [{ type: 'A', description: 'LED area light 25 ft pole', wattage: 150, location: 'site', headsPerPole: 1, emergency: false, symbol: 'square', sourceSheet: 'E0.1' }],
  symbolLegend: [], panelCircuits: [], equipment: [], quantities: [], scopeNotes: [], flags: [], panels: [],
};

async function run(labels: string[]) {
  const { client, calls } = fakeAnthropic((req: FakeRequest) => {
    const sys = systemText(req);
    if (sys.includes('counting symbols on ONE electrical plan sheet')) return { text: '{"marks":[],"unreadable":[],"notes":[]}' };
    if (sys.includes('DRAWING VIEWPORTS')) return { text: '{"viewports":[]}' };
    if (sys.includes('TYPICAL DEVICE PACKAGES')) return { text: '{"packages":[]}' };
    throw new Error(`unexpected model call: ${sys.slice(0, 80)} / ${userText(req).slice(0, 60)}`);
  });
  const stage = await runCountingStage({
    client, model: 'claude-opus-5-5', maxTokens: 32000, agent1: AGENT1, inventory: INVENTORY,
    pdfs: new Map([[FILE, pdf(labels)]]),
    evidence: { model: 'claude-sonnet-5', maxTokens: 16000 },
    remodel: { buildType: null, answer: null },
  });
  return { stage, calls };
}

let have = false;
beforeAll(async () => { have = await isPdftoppmAvailable(); });

describe('re-check N1 — new-build labels never make a remodel', () => {
  it('the labels ARE read as conventions by the text reader (so the test means something)', () => {
    expect(textConventions(LABELS.join(' . '), { key: 'k', label: 'E0.1' }).length).toBeGreaterThan(0);
  });

  it('E0.1 with the four labels: no remodel mode, the same model calls as without them, D0.1 never counted', async (ctx) => {
    if (!have) return ctx.skip();
    const plain = await run([]);
    const labelled = await run(LABELS);
    expect(labelled.stage.countResult.remodel).toBeUndefined();
    expect(labelled.calls.length).toBe(plain.calls.length);
    expect(labelled.calls.some(c => userText(c).includes('STATUS (remodel job)') || systemText(c).includes('DRAWING TITLES'))).toBe(false);
    expect(labelled.stage.countResult.sheets.map(s => s.label)).toEqual(['E0.1 "Site Power Plan"']);
    expect((labelled.stage.agent1.quantities as Array<Record<string, unknown>>).some(q => q.category === 'Demolition')).toBe(false);
  }, 300_000);
});
