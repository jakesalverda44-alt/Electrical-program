// Gap-closing T5 / T9 / J6 / J7 — service gear, controls and fixture rows that used to price at a silent $0 (or at
// a unit Chris does not use) get Chris's unit BY CODE (migration 165's items; the mapper never reaches them by
// name). Pure; runs right after decideRows, only on a bid being estimated (takeoffRowsFrom passes `priced`).
// Counts are never changed here: a row keeps Agent 2's / the estimator's qty (a 0-qty pending row stays 0).
//   T5  wireway / gutter → SVC-GUTTER (one priced row, the rest `duplicate` notes);
//       the service grounding electrode row ("ground rod, building steel, water pipe, Ufer") → GND-SVC × 1, and a
//       concrete-encased electrode LF row → a note "inside Grounding materials (Chris)";
//       fire-rated plywood backboard → BKBD-FRT;
//       a 200A fused / fusible switch → ASM-SW200F (switch + 3 fuses); a meter base / socket → METER-SKT;
//       a 225A panelboard → PNL-225F when the text says flush (J6, Q8), else stays PNL-225.
//   J7  a DSXW1 wall pack, or a wall-mount / wall pack with a stated wattage → LTG-WM250 / LTG-WM175 (Q11).
//   T9  a furnish statement saying the EC installs the "data cable" + a lighting control panel row → a
//       "Lighting control data cable (Venstar), CMP #24 4-pair" needs_length hold (J14) quoting the statement.
// The probes (matcherSafety.test.ts): "plywood shelf", "transformer grounding", "gutter downspout",
// "data cable for cameras", "EAS dual surface wireway" never match.
import { NOTE_PREFIXES, type DecidableRow } from './equipmentConnection';
import { normalizeUnit } from './mapper';

export interface ServiceGearContext {
  /** Agent 1 furnish statements (item / installBy / quote / sheet). */
  furnishStatements?: Array<{ item?: string; furnishBy?: string; installBy?: string; sourceSheet?: string; quote?: string }> | null;
}

export interface GearRow extends DecidableRow { excluded?: boolean }

const GUTTER_RE = /\bservice gutter\b|\bwireway\b|\bgutter\b/i;
const GUTTER_SERVICE_RE = /nema\s*3r|\b\d{1,2}\s*x\s*\d{1,2}\b|\bservice\b|contractor provided/i;
const GUTTER_EXCLUDE_RE = /surface|downspout|\brain\b|roof drain|storefront|\beas\b|data|low voltage|raceway system|plugmold/i;
const CEE_RE = /concrete[- ]encased|\bufer\b/i;
const FRT_RE = /\b(?:frt|fire[- ]?rated|fire[- ]?retardant)\b[^.;]*\bplywood\b|\bplywood backboard\b|\bfire rated playwood\b/i;
const SW200F_RE = /\b200\s*a\b[^;]*\bfus(?:ed|ible)\b[^;]*\b(?:switch|disconnect)|\bfus(?:ed|ible)\b[^;]*\b(?:switch|disconnect)\b[^;]*\b200\s*a\b/i;
const METER_RE = /\bmeter (?:base|socket|can)\b|^\s*mb\b/i;
const PANEL225_RE = /\b225\s*a\b[^;]*\bpanel|panel(?:board)?[^;]*\b225\s*a\b/i;
const WALLPACK_RE = /\bdsxw\d?\b|\bwall ?pack\b|\bwall[- ]mount(?:ed)?\b[^;]*\b(?:led|luminaire|fixture|light)\b/i;

/** "250W", "175 W" (a lumen package like "10C 530" is not a wattage). */
function statedWatts(text: string): number | null {
  const m = /\b(\d{2,3})\s*w\b(?!\s*input)/i.exec(text);
  return m ? Number(m[1]) : null;
}

export function decideServiceGear<T extends GearRow>(rows: T[], ctx: ServiceGearContext = {}): T[] {
  const out = rows.map(r => ({ ...r }));
  const textOf = (r: GearRow) => `${r.item ?? ''} ${r.spec ?? ''}`;
  const qtyOf = (r: GearRow) => Number(r.qty) || 0;
  const free = (r: GearRow) => !r.note && !r.libraryCode && !r.holdReason;
  const gutters: number[] = [];

  out.forEach((r, i) => {
    if (!free(r)) return;
    const text = textOf(r);
    if (/demolition|\bdemo\b|existing to be removed/i.test(`${r.category} ${text}`)) return;
    const unit = normalizeUnit(r.unit);
    // T5 — the service grounding electrode system (an LS row): Chris's "Grounding Materials" lump.
    // Only the whole electrode SYSTEM as one lump ("grounding electrode system", or two or more of its electrodes
    // named together), carried as one LS / LOT / EA — never a single ground rod, and the count is never changed
    // (an LS of 1 is 1 EA).
    const electrodes = (text.match(/ground rod|building steel|water pipe|\bufer\b/gi) ?? []).length;
    const lump = unit === 'EA' ? qtyOf(r) === 1 : /^(?:LS|LOT|SYS|SYSTEM)$/i.test(String(r.unit).trim()) && qtyOf(r) === 1;
    if ((/grounding electrode system/i.test(text) || electrodes >= 2) && lump && !/bond(?:ing)? jumper|telecom|\btgb\b|\bmgb\b/i.test(text)) {
      out[i] = { ...r, qty: 1, unit: 'EA', libraryCode: 'GND-SVC',
        evidence: `Service grounding (${String(r.spec ?? r.item).trim()}) — Chris's "Grounding Materials" 1 × 6 h, $890 (Kissimmee BOM). ${unit === 'EA' ? '' : `Carried as 1 ${String(r.unit).trim()} → 1 EA.`}`.trim() };
      return;
    }
    if (unit !== 'EA') return;
    if (GUTTER_RE.test(text) && GUTTER_SERVICE_RE.test(text) && !GUTTER_EXCLUDE_RE.test(text)) { gutters.push(i); return; }
    if (FRT_RE.test(text)) {
      out[i] = { ...r, libraryCode: 'BKBD-FRT', evidence: 'Fire-rated plywood backboard — Chris\'s "Fire Rated Playwood" 4 h, $250 (Kissimmee BOM).' };
      return;
    }
    if (SW200F_RE.test(text)) {
      out[i] = { ...r, libraryCode: 'ASM-SW200F', evidence: '200A fusible safety switch with 3 fuses — Chris\'s assembly (3.1 h switch + 3 × 0.1 h fuses, Kissimmee BOM). The count is the takeoff\'s / your answer.' };
      return;
    }
    if (METER_RE.test(text) && !/\bct\b|current transformer|multi/i.test(text) && /service|distribution/i.test(r.category)) {
      out[i] = { ...r, libraryCode: 'METER-SKT', evidence: 'Meter socket — Chris\'s 200A Meter Socket 1.5 h, Quoted ($0: the utility furnishes it — confirm).' };
      return;
    }
    if (PANEL225_RE.test(text) && /\bflush\b/i.test(text)) {
      out[i] = { ...r, libraryCode: 'PNL-225F', evidence: '225A panelboard, flush mount — 4.5 h (J6; Chris used 3.6 h surface — Q8 confirms flush).' };
      return;
    }
    if (/site|exterior/i.test(r.category) && WALLPACK_RE.test(text) && !/emergency|\bem\b|exit|pole/i.test(text)) {
      const w = statedWatts(text);
      const code = w != null ? (w <= 175 ? 'LTG-WM175' : w <= 250 ? 'LTG-WM250' : null) : /\bdsxw\d?\b/i.test(text) ? 'LTG-WM250' : null;
      if (!code) return;
      out[i] = { ...r, libraryCode: code, evidence: `Wall-mount LED ${code === 'LTG-WM175' ? 'up to 175 W — 1.1 h' : 'up to 250 W — 1.6 h'} (Chris's wall-mount units by wattage${w == null ? '; a DSXW1 wall pack is the 250 W class' : `; ${w} W stated`} — Q11).` };
    }
  });

  // One service gutter: the largest count priced, the rest are the same gutter.
  const live = gutters.filter(i => qtyOf(out[i]) > 0).sort((a, b) => qtyOf(out[b]) - qtyOf(out[a]));
  live.forEach((i, k) => {
    out[i] = k === 0
      ? { ...out[i], libraryCode: 'SVC-GUTTER', evidence: 'Service gutter / wireway — Chris\'s "Service Gutter" 6 h, $600 (Kissimmee BOM).' }
      : { ...out[i], note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "${out[live[0]].item}" — the same service gutter.` };
  });
  for (const i of gutters) if (!live.includes(i) && live.length) out[i] = { ...out[i], note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "${out[live[0]].item}" — the same service gutter.` };

  // T9 (J14) — the Venstar data cable: a visible needs_length hold, never a guessed length.
  const st = (ctx.furnishStatements ?? []).find(s => /\bdata cable\b/i.test(`${s.item ?? ''} ${s.quote ?? ''}`) && /\b(?:ec|electrical contractor)\b/i.test(`${s.installBy ?? ''} ${s.quote ?? ''}`) && !/cat\.?\s*5|camera/i.test(`${s.item ?? ''} ${s.quote ?? ''}`));
  const hasLcp = out.some(r => /\blcp\b|\balc\b|lighting control panel/i.test(textOf(r)));
  if (st && hasLcp && !out.some(r => /CMP #24/i.test(r.item))) {
    out.push({
      category: 'Lighting Controls', item: 'Lighting control data cable (Venstar), CMP #24 4-pair', spec: 'Lighting control data cable (Venstar), CMP #24 4-pair',
      qty: 0, unit: 'LF', libraryCode: 'LV-CMP244',
      evidence: `NEEDS FOOTAGE — ${st.sourceSheet ?? 'E-6'}: "${String(st.quote ?? '').trim()}". Measure it or type a qty (Chris carried 1,000 ft on Kissimmee at 8.6 h/M — Q9). Library item LV-CMP244.`,
    } as unknown as T);
  }
  return out;
}

// ── T5 — #6 compression lugs on the feeders' #6 grounds ─────────────────────
/** Chris carries 6 #6 lugs on Kissimmee's two DISCON → PANEL feeders (4#3/0 + #6G): 3 per feeder #6 ground
 *  (switch ground lug, enclosure bond, panel ground bar — a default, confirm). Only priced feeder edges count. */
export const LUGS_PER_6G_FEEDER = 3;
export function feederLugRow(edges: Array<{ id: string; kind: string; spec: { conductors: Array<{ size: string; ground: boolean; count: number }> } | null }>):
  { category: string; item: string; spec: string; qty: number; unit: 'EA'; confidence: 'APPROX'; evidence: string; libraryCode: string } | null {
  const hits = edges.filter(e => e.kind === 'feeder' && e.spec?.conductors.some(c => c.ground && c.size === '6'));
  if (!hits.length) return null;
  const qty = hits.length * LUGS_PER_6G_FEEDER;
  return {
    category: 'Feeders (allowance)', item: `#6 ground lugs — ${hits.length} feeder${hits.length === 1 ? '' : 's'}`, spec: '#6 compression lug, 1-hole (Chris BOM)', qty, unit: 'EA', confidence: 'APPROX', libraryCode: 'LUG-6',
    evidence: `${hits.map(h => h.id).join(', ')}: ${hits.length} feeder${hits.length === 1 ? '' : 's'} with a #6 ground × ${LUGS_PER_6G_FEEDER} lugs (default — confirm) = ${qty} (Chris: #6 Wire Lug Compression 6 × 0.15 h, Kissimmee).`,
  };
}

/** T5 — an allowance / generated LF row for the concrete-encased electrode (Ufer) is inside Chris's Grounding
 *  Materials lump once the service grounding row is priced (GND-SVC): a note, never counted twice. */
export function noteGroundingAllowances<T extends { category: string; item: string; spec?: string | null; unit: string; qty: number | string; evidence?: string | null; note?: string | null }>(rows: T[], gndPriced: boolean): T[] {
  if (!gndPriced) return rows;
  return rows.map(r => (normalizeUnit(r.unit) === 'LF' && CEE_RE.test(`${r.item} ${r.spec ?? ''}`) && !r.note
    ? { ...r, note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "Grounding materials" — the concrete-encased electrode is inside Grounding materials (Chris carries one lump: 6 h, $890).` }
    : r));
}
