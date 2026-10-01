// Accuracy round D1–D4 — the pre-mapping decisions on real rows of both jobs.
import { describe, it, expect } from 'vitest';
import { decideRows, circuitsOf, isCircuitRefOnly, noteKindOfEvidence } from './equipmentConnection';
import { isCircuitListRow } from './mapper';
import { holdReasonOf } from './bidEstimate';
import { priceBid } from './pricing';
import { loadKissimmeeLive0930, load36th0930 } from '../test/fixtures/realrun/live0930';

type Row = { category: string; item: string; spec?: string | null; qty: number | string; unit: string; note?: string | null; libraryCode?: string | null; holdReason?: string | null; evidence?: string | null };
const k = loadKissimmeeLive0930();
const s = load36th0930();
const kRows = k.agent2.takeoff as Row[];
const sRows = s.agent2.takeoff as Row[];
const kDecided = decideRows(kRows, { equipment: (k.agent1 as { equipment: never[] }).equipment });
const sDecided = decideRows(sRows, { equipment: (s.agent1 as { equipment: never[] }).equipment });
const kd = (re: RegExp) => kDecided.find(r => re.test(r.item))!;
const sd = (re: RegExp) => sDecided.find(r => re.test(r.item))!;

describe('D1 — circuit lists are notes', () => {
  it('the live wording', () => {
    for (const d of ['Panel A 20/1 circuits per E-4 schedule', 'Panel B 20/1 circuits', '20/1 circuits', '(12) 20A/1P circuits']) expect(isCircuitListRow({ description: d, altText: null, unit: 'EA' }), d).toBe(true);
    expect(kd(/^Branch circuit 20\/1 — Panel A/)).toMatchObject({ note: 'circuit_list' });
    expect(kd(/^Branch circuit 60\/3 — Panel B/)).toMatchObject({ note: 'circuit_list' });
    expect(sd(/^Branch circuit \?\/1/)).toMatchObject({ note: 'circuit_list' });
  });
  it('regression sweep: no other row of either job becomes a circuit list', () => {
    const lists = [...kDecided, ...sDecided].filter(r => r.note === 'circuit_list').map(r => r.item);
    expect(lists).toEqual(['Branch circuit 20/1 — Panel A', 'Branch circuit 60/3 — Panel B', 'Branch circuit 20/1 — Panel B', 'Branch circuit ?/1 — Panel A']);
  });
});

describe('D2 — circuit-reference rows', () => {
  it('reads circuits', () => {
    expect(circuitsOf('A-6, A-14/A-16, pylon A-18, 1220VA ea').sort()).toEqual(['A14', 'A16', 'A18', 'A6']);
    expect(circuitsOf('Panel B ckt 1,3,5, 3#6')).toEqual(['B1', 'B3', 'B5']);
    expect(['A-6,A-14,A-16', 'Circuit A-18', 'Panel B ckt 26', 'Panel A ckt 27, 1500VA', 'Panel B ckt 20, 20A high magnetic breaker'].every(isCircuitRefOnly)).toBe(true);
    expect(isCircuitRefOnly('60/3, Panel B ckt 1,3,5, 3#6,#10G,3/4"C')).toBe(false);
  });
  it('the sign J-boxes and the pylon connection are references of the SIGNS row (same circuits); receptacles on a shared circuit never are', () => {
    expect(kd(/^Wall sign J-boxes/)).toMatchObject({ note: 'circuit_ref' });
    expect(kd(/^Wall sign J-boxes/).evidence).toMatch(/^Circuit reference of "SIGNS — Sign connections"/);
    expect(kd(/^Pylon sign connection/)).toMatchObject({ note: 'circuit_ref' });
    expect(kd(/^Recessed WP\/GFCI exterior receptacle/).note ?? null).toBeNull();
    expect(kd(/^Recessed WP\/GFCI exterior receptacle/).spec ?? null).toBeNull(); // the item text describes it
    expect(kd(/^Display baseflex/).note ?? null).toBeNull();
  });
  it('refs only, nothing else → a hold "what is on circuits …?"', () => {
    const [r] = decideRows<Row>([{ category: 'Branch Power', item: 'A-6,A-14', spec: 'A-6,A-14', qty: 2, unit: 'EA' }]);
    expect(r.holdReason).toBe('circuit_ref');
    expect(holdReasonOf({ description: 'A-6,A-14', match_confidence: null, match_source: null, evidence_note: r.evidence, unit: 'EA' }, false)).toBe('circuit_ref');
  });
});

describe('D3 — equipment connections (Chris\'s units)', () => {
  it('RTU: #6 termination off its own spec; the two disconnect rows are one set of 60A switches', () => {
    expect(kd(/^RTU-1 — Rooftop unit connection/)).toMatchObject({ libraryCode: 'TERM-6' });
    expect(kd(/^RTU disconnects/)).toMatchObject({ libraryCode: 'DISC-60' });
    expect(kd(/^RTU disconnects/).evidence).toMatch(/RTU units .*RTU-1, RTU-2: 60 A\) → 60A/);
    expect(kd(/^HVAC disconnect with unit/)).toMatchObject({ note: 'duplicate' });
  });
  it('hard-wired ≤ 30 A loads → ≤ #10; cord-connected → served by a receptacle', () => {
    for (const re of [/^WH — Water heater/, /^MINI-TUNE/, /^DF — Drinking/, /^SIGNS — Sign/, /^ALC — Automatic/, /^Exhaust fan recessed/]) expect(kd(re).libraryCode, String(re)).toBe('TERM-10');
    for (const re of [/^DRINK — /, /^FRIDGE — /, /^BATT CHGR/]) expect(kd(re).note, String(re)).toBe('served_by_receptacle');
  });
  it('36th: the COMP/AHU 40A/2P 3#6 circuits → #6 terminations; a bare "Disconnect" ×4 names no equipment → needs size', () => {
    expect(sDecided.filter(r => r.libraryCode === 'TERM-6').map(r => r.item.split(' — ')[0])).toEqual(['COMP #1', 'AHU #1', 'COMP #2', 'AHU #2']); // AHU #2 is qty 0 (not found on a counted sheet)
    expect(sd(/^Disconnect$/)).toMatchObject({ holdReason: 'needs_size' });
  });
});

describe('D4 — power poles, simplex, fans, pipe poles, site poles', () => {
  it('maps by code', () => {
    expect(kd(/^PP-1\.\.6/)).toMatchObject({ libraryCode: 'PP-SET' });
    expect(kd(/^Simplex receptacle/)).toMatchObject({ libraryCode: 'DEV-SIMPLEX' });
    expect(kd(/^3" PVC data\/security pipes/)).toMatchObject({ libraryCode: 'RISER-PIPEPOLE' });
    expect(kd(/^Type S1 — pole/)).toMatchObject({ libraryCode: 'LTG-POLE-LAB' });
    expect(kd(/^Type SITE LIGHT — pole/)).toMatchObject({ libraryCode: 'LTG-POLE-LAB' });
    expect(kd(/^Type S1 — fixture heads/)).toMatchObject({ libraryCode: 'LTG-POLEHEAD-LAB' });
    expect(kd(/^Type SITE LIGHT — fixture heads/)).toMatchObject({ libraryCode: 'LTG-POLEHEAD-LAB' });
  });
  it('B5 — owner-furnished site poles / heads are labor only, quoting the furnish statement; no statement → "material — confirm"', () => {
    const a1 = k.agent1 as { scopeNotes: string[]; furnishStatements: unknown[]; flags?: unknown[] };
    const withQuote = decideRows(kRows, { equipment: (k.agent1 as { equipment: never[] }).equipment, furnishTexts: [...a1.scopeNotes, ...a1.furnishStatements.map(x => String((x as { quote?: string }).quote ?? ''))] });
    const pole = withQuote.find(r => /^Type S1 — pole/.test(r.item))!;
    expect(pole.libraryCode).toBe('LTG-POLE-LAB');
    expect(pole.evidence).toMatch(/labor only\. Material furnished by the owner \("Site poles, anchor bolts, templates AZ furnished; EC installs"\) — \$0/);
    expect(withQuote.find(r => /^Type S1 — fixture heads/.test(r.item))!.evidence).toMatch(/labor only\. Material furnished by the owner/);
    const none = decideRows(kRows, { equipment: (k.agent1 as { equipment: never[] }).equipment });
    expect(none.find(r => /^Type S1 — pole/.test(r.item))!.evidence).toMatch(/labor only\. Material — confirm/);
  });
  it('B2 — the DISCON A / B 200A fused switches (0928 wording) go to the 200A fusible switch assembly by code', () => {
    const d = decideRows([{ category: 'Branch Power', countType: 'DISCON A', item: 'DISCON A - 200A fused switch, fused 200A, NEMA 3R; feeds Panel A 4#3/0,#6G,2"C (connection)', spec: 'E-4', qty: 1, unit: 'EA' }]);
    expect(d[0].libraryCode).toBe('ASM-SW200F');
  });
  it('B1 — a bid that is not being estimated keeps every row exactly as Agent 2 wrote it', () => {
    const same = decideRows(kRows, { equipment: (k.agent1 as { equipment: never[] }).equipment, priced: false });
    expect(same).toEqual(kRows);
    expect(same.some(r => r.libraryCode || r.note || r.holdReason)).toBe(false);
  });
});

describe('D5 — holds, one per reason', () => {
  const line = (over: Record<string, unknown>) => ({ id: String(Math.random()), category: 'Branch Power', description: 'X', qty: 2, unit: 'EA' as const, materialUnitCost: 0, laborHoursUnit: 0, matched: false, ...over });
  it('every $0 line with a qty is a hold with its reason; notes and overrides are not', () => {
    const r = priceBid([
      line({ holdReason: 'no_unit' }), line({ matchConfidence: 'confirm', holdReason: 'confirm_match' }), line({ unit: 'LS', unitUnknown: true, holdReason: 'unit_unknown' }),
      line({ holdReason: 'needs_length' }), line({ holdReason: 'needs_size' }), line({ holdReason: 'needs_endpoint' }), line({ holdReason: 'needs_scale' }),
      line({ noteKind: 'circuit_list' }), line({ laborHoursOverride: 1 }), line({ qty: 0 }), line({ excluded: true }),
    ] as never, { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 }, []);
    expect(r.warnings.holds.map(h => h.reason)).toEqual(['no_unit', 'confirm_match', 'unit_unknown', 'needs_length', 'needs_size', 'needs_endpoint', 'needs_scale']);
    expect(r.warnings.noteCount).toBe(1);
  });
  it('the reason comes off what the line carries', () => {
    const h = (description: string, evidence_note: string | null, unit = 'EA', mc: string | null = null) => holdReasonOf({ description, evidence_note, match_confidence: mc as never, match_source: null, unit }, unit === 'LS');
    expect(h('X', null, 'LS')).toBe('unit_unknown');
    expect(h('X', null, 'EA', 'confirm')).toBe('confirm_match');
    expect(h('3/4" EMT', 'Feeder PANEL B → RTU-1: needs: PANEL B location — Pin PANEL B on the Plans view.')).toBe('needs_endpoint');
    expect(h('2" EMT', 'Feeder XFMR → METER: needs scale: confirm the scale on C4.1')).toBe('needs_scale');
    expect(h('Disconnect', 'Disconnect with no amperage — the equipment it serves is not named: pick the size.')).toBe('needs_size');
    expect(h('NEEDS FOOTAGE — Site lighting', 'Agent 2 allowance with no footage on the plans — measure it or type a qty')).toBe('needs_length');
    expect(noteKindOfEvidence('Served by a receptacle — no connection unit.')).toBe('served_by_receptacle');
  });
});
