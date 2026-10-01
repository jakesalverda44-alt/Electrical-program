// Accuracy round D1–D4 — the rows that used to reach the mapper with no unit
// (and priced at a silent $0) get a decision before mapping. Pure.
//   D1  a panel's circuit list ("Panel A 20/1 circuits per E-4 schedule") →
//       a NOTE: qty kept, never priced, not a hold.
//   D2  a row whose detail is only circuit references ("A-6,A-14,A-16",
//       "Panel B ckt 26"): its own item text is what it is (mapped by the
//       item); when another row already names the same circuits (and it is
//       not a receptacle / device) → a NOTE "circuit reference of <row>";
//       nothing at all → a hold "what is on circuits …?".
//   D3  equipment connections, Accubid style (Chris's units, migration 158):
//       motor / HVAC / hard-wired loads → a termination by conductor size
//       (the row's own spec, else Agent 1's equipment entry, else ≤ #10 for a
//       ≤ 30 A 1Ø load); cord-connected appliances → a NOTE "served by a
//       receptacle"; a disconnect with no amperage takes it from the one
//       equipment family it names when the counts agree, else a hold
//       "needs size"; the same disconnects listed twice → one priced, the
//       other a NOTE.
//   D4  power poles, simplex receptacles, ceiling fans, 3" PVC pipe poles →
//       Chris's units by code.
// A decision is carried on the row: `note` (+ evidence), or `libraryCode`
// (+ evidence) which the mapper honors, or `holdReason` (+ evidence).
import { isCircuitListRow, CIRCUIT_LIST_NOTE, statedAmperage, normalizeUnit } from './mapper';
import { parseConductorRun } from './footageAllowance';
import { normalizeNode } from './feederGraph';

export type NoteKind = 'circuit_list' | 'circuit_ref' | 'served_by_receptacle' | 'feeder_estimate' | 'duplicate';
export type HoldReason = 'no_unit' | 'confirm_match' | 'unit_unknown' | 'needs_length' | 'needs_size' | 'needs_endpoint' | 'needs_scale' | 'circuit_ref';

/** Evidence prefixes that mark a classified NOTE line (stored lines keep them). */
export const NOTE_PREFIXES: Record<NoteKind, string> = {
  circuit_list: CIRCUIT_LIST_NOTE,
  circuit_ref: 'Circuit reference of',
  served_by_receptacle: 'Served by a receptacle',
  feeder_estimate: 'Replaced by the feeder estimate',
  duplicate: 'Same items as',
};
export function noteKindOfEvidence(evidence: string | null | undefined): NoteKind | null {
  const e = (evidence ?? '').trim();
  for (const [k, p] of Object.entries(NOTE_PREFIXES) as Array<[NoteKind, string]>) if (e.startsWith(p)) return k;
  return null;
}

export interface DecidableRow {
  category: string; item: string; spec?: string | null; qty: number | string; unit: string;
  countType?: string; evidence?: string | null; note?: string | null; libraryCode?: string | null; holdReason?: string | null;
}

export interface EquipmentLike { tag?: string; description?: string | null; amps?: number | null; phase?: number | null }
export interface DecideContext {
  equipment?: EquipmentLike[] | null;
  /** Equipment nodes with an estimated feeder (C6): their wiring is carried there. */
  feederCarried?: Map<string, string>;
  /** Fix round B1 — false on a submitted / awarded / lost bid that is not a
   *  calibration job: no decision is applied (rows come back as Agent 2 wrote
   *  them), so its displayed price never moves. Default true. */
  priced?: boolean;
  /** Fix round B5 — sentences from Agent 1 / Agent 2 that may say who furnishes the site poles / heads. */
  furnishTexts?: string[];
}

const FURNISHED_RE = /\b(?:az|autozone|auto zone|owner|ofci|oci)\b[^.;\n]{0,20}\b(?:furnish(?:ed)?|provid(?:ed|es?)|supplied)\b|\bfurnished (?:and installed )?by (?:az|autozone|owner|others)\b|\bowner[- ]furnished\b/i;
/** The first sentence that says the owner / AutoZone furnishes the thing (`what` matches the thing's noun). */
export function ownerFurnishedQuote(texts: string[] | undefined, what: RegExp): string | null {
  for (const t of texts ?? []) {
    for (const part of String(t).split(/(?<=\.)\s+|\n/)) if (what.test(part) && FURNISHED_RE.test(part)) return part.trim().slice(0, 160);
  }
  return null;
}

// ── circuits ────────────────────────────────────────────────────────────────

/** "A-6,A-14/A-16, pylon A-18" → A6 A14 A16 A18; "Panel B ckt 1,3,5" → B1 B3 B5. */
export function circuitsOf(text: string): string[] {
  const out = new Set<string>();
  const t = text ?? '';
  for (const m of t.matchAll(/\bpanel\s+([A-Z])\s*,?\s*ckts?\.?\s*((?:\d{1,2}\s*[,&/]?\s*)+)/gi)) for (const n of m[2].match(/\d{1,2}/g) ?? []) out.add(`${m[1].toUpperCase()}${Number(n)}`);
  for (const m of t.matchAll(/\b([A-Z])-?(\d{1,2})((?:\s*,\s*\d{1,2}\b(?!-))*)/g)) {
    out.add(`${m[1]}${Number(m[2])}`);
    for (const n of (m[3] ?? '').match(/\d{1,2}/g) ?? []) out.add(`${m[1]}${Number(n)}`);
  }
  return [...out];
}

/** Text that is only circuit references (+ panel / ckt words, a VA load, a breaker). */
export function isCircuitRefOnly(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t || !circuitsOf(t).length) return false;
  const rest = t
    .replace(/\bpanel\s+[A-Z]\b/gi, ' ')
    .replace(/\b(?:ckts?|circuits?|pylon)\b\.?/gi, ' ')
    .replace(/\b[A-Z]-?\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/\b\d{3,5}\s*va(?:\s*ea)?\b/gi, ' ')
    .replace(/\b\d{2,3}\s*a\b(?:\s*high magnetic)?(?:\s*breaker)?/gi, ' ')
    .replace(/[\s,;/&().-]+/g, '');
  return rest.length === 0;
}

/** Detail text that says nothing about what the item is ("With unit"). */
const SCOPE_PHRASE_RE = /^(?:contractor provided|with unit|within\b|size per\b|per\b|entire wall|above\b|by\b|furnished\b|incl\.?\b|see\b|typ(?:ical)?\b)/i;

const STOP = new Set(['connection', 'connections', 'circuit', 'circuits', 'ckt', 'ckts', 'panel', 'box', 'boxes', 'j-box', 'j-boxes', 'jbox', 'with', 'for', 'and', 'the', 'wall', 'front', 'side']);
/** The item's significant words, singular ("Wall sign J-boxes" → sign). */
function nounWords(item: string): string[] {
  return String(item ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/)
    .filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/s$/, ''));
}

const DEVICE_RE = /receptacle|\bgfc?i\b|duplex|switch(?!.*disconnect)|outlet|\bplug/i;

// ── equipment connections ───────────────────────────────────────────────────

const CORD_RE = /fridge|refrigerator|drink machine|vending|battery charger|on (?:a )?receptacle|plug-?in|cord(?:-| and )?(?:connected|plug)/i;
const HARDWIRED_RE = /water heater|\bwh\b|\bewh\b|exhaust fan|\bef\d?\b|\bsigns?\b|\balc\b|lighting control panel|tester|test (?:center|station)|mini-?tune|drinking fountain|\bdf\b|\bmotor\b|\bpump\b|\brtu\b|roof ?top unit|\bahu\b|air handler|compressor|condens|unit heater/i;
const FAMILY_RE: Record<string, RegExp> = {
  RTU: /\brtu\b|\bhvac\b|roof ?top/i, AHU: /\bahu\b|air handler/i, COMP: /\bcomp(?:ressor)?\b|condens/i,
};

function termCodeFor(size: string | null, fallbackSmall: boolean): { code: string | null; note: string } {
  if (!size) return fallbackSmall ? { code: 'TERM-10', note: '≤ #10 (a ≤ 30 A load)' } : { code: null, note: 'no conductor size' };
  const s = size.toLowerCase();
  const rank = /\/0/.test(s) ? 100 + Number(s.split('/')[0]) : /kcmil/.test(s) ? 1000 : -Number(s);
  if (rank <= -10) return { code: 'TERM-10', note: `#${size} (≤ #10)` };
  if (rank === -8) return { code: 'TERM-8', note: '#8' };
  if (rank === -6) return { code: 'TERM-6', note: '#6' };
  if (rank === -4 || rank === -3) return { code: 'TERM-4', note: `#${size} (#4 unit, default — confirm)` };
  if (rank === -2) return { code: 'TERM-2', note: '#2' };
  if (rank === -1) return { code: 'TERM-1', note: '#1' };
  if (rank === 101) return { code: 'TERM-1_0', note: '#1/0 (default — confirm)' };
  return { code: null, note: `#${size} — no termination unit at that size` };
}

function phaseConductor(text: string): string | null {
  const r = parseConductorRun(text);
  return r?.conductors.find(c => !c.ground)?.size ?? null;
}

function tagOf(row: DecidableRow): string | null {
  const head = String(row.countType ?? '') || String(row.item ?? '').split(/\s+[—–]\s+|\s+-\s+/)[0];
  return normalizeNode(head) ?? (head.trim() ? head.trim().toUpperCase() : null);
}

export function decideRows<T extends DecidableRow>(rows: T[], ctx: DecideContext = {}): T[] {
  // Fix round B1 — a bid that is not being estimated (submitted / awarded / lost,
  // not a calibration job) keeps exactly the rows Agent 2 wrote: any decision can
  // move a displayed price (a note or hold removes a row that used to price, a
  // code adds one), so none is applied. Its proposal is the price that was bid.
  if (ctx.priced === false) return rows.map(r => ({ ...r }));
  const out = rows.map(r => ({ ...r }));
  const textOf = (r: DecidableRow) => `${r.item ?? ''} ${r.spec ?? ''}`;
  const isEa = (r: DecidableRow) => normalizeUnit(r.unit) === 'EA';
  const qtyOf = (r: DecidableRow) => Number(r.qty) || 0;
  const equip = ctx.equipment ?? [];
  const equipFor = (tag: string | null) => (tag ? equip.filter(e => (normalizeNode(e.tag) ?? String(e.tag ?? '').toUpperCase()) === tag) : []);

  // D2 — detail that is only circuit refs / a scope phrase: the item says what it is.
  const circuitsByRow = out.map(r => circuitsOf(textOf(r)));
  out.forEach((r, i) => {
    if (r.note || r.libraryCode || !isEa(r) || qtyOf(r) <= 0) return;
    const spec = String(r.spec ?? '').trim();
    if (!(isCircuitRefOnly(spec) || SCOPE_PHRASE_RE.test(spec))) return;
    if (isCircuitRefOnly(r.item)) {
      out[i] = { ...r, holdReason: 'circuit_ref', evidence: `What is on circuits ${circuitsByRow[i].join(', ')}? The takeoff row names only circuits — tell the estimate what it is.` };
      return;
    }
    // Another (non-device) row already carries these circuits → a reference.
    if (!DEVICE_RE.test(r.item) && circuitsByRow[i].length) {
      const mine = new Set(circuitsByRow[i]);
      const words = nounWords(r.item);
      const other = out.findIndex((o, j) => j !== i && !DEVICE_RE.test(o.item) && circuitsByRow[j].length > mine.size
        && circuitsByRow[i].every(c => circuitsByRow[j].includes(c)) && nounWords(o.item).some(w => words.includes(w)));
      if (other >= 0) {
        out[i] = { ...r, note: 'circuit_ref', evidence: `${NOTE_PREFIXES.circuit_ref} "${out[other].item}" (circuits ${circuitsByRow[i].join(', ')}) — the same connections, never priced twice.` };
        return;
      }
    }
    out[i] = { ...r, spec: null, evidence: `${r.evidence ? `${r.evidence} ` : ''}Agent 2 detail: "${spec}".`.trim() };
  });

  // D1 — circuit lists are notes.
  out.forEach((r, i) => {
    if (r.note || !isEa(r)) return;
    if (isCircuitListRow({ description: String(r.spec || r.item), altText: r.item, unit: normalizeUnit(r.unit) })) {
      out[i] = { ...r, note: 'circuit_list', evidence: NOTE_PREFIXES.circuit_list };
    }
  });

  // D3 / D4 — by kind.
  const disconnectRows: number[] = [];
  const ppRows: number[] = [];
  const fanRows: number[] = [];
  out.forEach((r, i) => {
    if (r.note || r.libraryCode || r.holdReason || !isEa(r)) return;
    const text = textOf(r);
    if (/demolition|\bdemo\b|existing to be removed/i.test(`${r.category} ${text}`)) return;
    // Fix round S2 — a power-pole host row ("PP-1..6 — Power poles #1 … #5 PVC data/security pipes")
    // is a power pole row first, whatever else its text mentions: one PP-SET, the rest duplicates.
    if (/^\s*(?:pp\b|power poles?\b)|\bpower poles?\b.*\(connection\)|^power poles? \(p\)/i.test(r.item) && !/speed control/i.test(text)) { ppRows.push(i); return; }
    // Only a row ABOUT the pipes ("3\" PVC data/security pipes at pole #5") is a pipe-pole riser.
    if (/\bpvc\b.*\b(?:data|security)\b|\b(?:data|security)\b.*\bpipes?\b/i.test(text)) {
      out[i] = { ...r, libraryCode: 'RISER-PIPEPOLE', evidence: `Pipe pole / raceway riser, 3" PVC (default — confirm). Not priced as a power pole.` };
      return;
    }
    // D4 — a site light pole row (not its heads): Chris's pole unit by height.
    if (/site|exterior/i.test(r.category) && /(?:^|[\s—–-])pole\b(?!\s*light)|\bsite pole\b/i.test(r.item) && !/power pole|bollard|head/i.test(r.item)) {
      const mh = Number(/(\d{2})\s*'\s*-?\s*\d*\s*"?\s*(?:mh|mounting|high|h\b)/i.exec(text)?.[1] ?? NaN);
      const tall = Number.isFinite(mh) && mh >= 30;
      // Fix round B5 — labor only: Chris carries the poles Quoted ($0 material); when the documents say the
      // owner furnishes them the line says so, else "material — confirm". The $950 library pole is never auto-priced.
      const quote = ownerFurnishedQuote(ctx.furnishTexts, /\bpoles?\b|site light/i);
      out[i] = { ...r, libraryCode: tall ? 'LTG-POLE-30' : 'LTG-POLE-LAB',
        evidence: `Site light pole${Number.isFinite(mh) ? ` (${mh} ft mounting height)` : ''} — Chris's ${tall ? '30 ft pole 6.8 h' : '20–25 ft pole 4.8 h'}, labor only. ${quote ? `Material furnished by the owner ("${quote}") — $0, override if EC buys them.` : 'Material — confirm (Chris carries the poles as Quoted, $0).'}` };
      return;
    }
    // Fix round B1/B2 — a site pole's fixture heads ("Type S1 — fixture heads (1 per pole)"):
    // by category + the pole-type tag, never by a generic "fixture heads" alias.
    if (/site|exterior/i.test(r.category) && /^\s*type\s+(?:s\d*|site light)\b.*\bheads?\b/i.test(r.item) && !/emergency|\bem\b|exit|track/i.test(r.item)) {
      const quote = ownerFurnishedQuote(ctx.furnishTexts, /\bpoles?\b|\bheads?\b|fixtures?|lighting|luminaires?/i);
      out[i] = { ...r, libraryCode: 'LTG-POLEHEAD-LAB',
        evidence: `Site pole fixture head — Chris's pole-top head 2.2 h, labor only. ${quote ? `Material furnished by the owner ("${quote}") — $0, override if EC buys them.` : 'Material — confirm (Chris carries the heads as Quoted, $0).'}` };
      return;
    }
    if (/\bsimplex\b|single receptacle/i.test(text)) { out[i] = { ...r, libraryCode: 'DEV-SIMPLEX', evidence: 'Single (simplex) receptacle w/ plate — Chris\'s unit (20 h/C + 3 h/C).' }; return; }
    // Fix round B2 — the FSC row is the fans' wall speed CONTROLS (a controls device, not a fan):
    // tested on the whole row text ("speed controls"); the CF row's "wall speed controller" is a
    // descriptor of the fan and does not match. The fan rows are one set of fans: one priced, the rest duplicates.
    if (!/\bfsc\b|\bspeed controls?\b|exhaust|\bcombo\b/i.test(text) && /ceiling fans?|hang fans?|^\s*cf\d*(?:-cf\d+)?\b/i.test(text)) { fanRows.push(i); return; }
    // Fix round B2 — the service-side 200A fusible switch ("DISCON A - 200A fused switch …"):
    // by code (was the alias-only assembly's alias; the mapper no longer reaches it).
    if (/^\s*discon\s+[a-z]\b.*\b200\s*a\b.*\bfus/i.test(r.item)) { out[i] = { ...r, libraryCode: 'ASM-SW200F', evidence: '200A fusible safety switch with 3 fuses — Chris\'s assembly (3.1 h switch + 3 x 0.1 h fuses).' }; return; }
    if (/disconnect|safety switch|fused switch|\bdiscon\b/i.test(text) && !/\bdiscon [a-z]\b.*feeds|panel/i.test(r.item)) { disconnectRows.push(i); return; }
    if (DEVICE_RE.test(r.item) || (/\bfixture\b|luminaire|^type\s/i.test(r.item) && !/exhaust fan/i.test(r.item))) return;
    if (CORD_RE.test(text)) { out[i] = { ...r, note: 'served_by_receptacle', evidence: `${NOTE_PREFIXES.served_by_receptacle} — no connection unit.` }; return; }
    if (!HARDWIRED_RE.test(text) && !/\(connection\)|\bconnection\b/i.test(r.item)) return;
    if (!HARDWIRED_RE.test(text)) return;
    const tag = tagOf(r);
    const eq = equipFor(tag);
    const size = phaseConductor(text) ?? eq.map(e => phaseConductor(String(e.description ?? ''))).find(Boolean) ?? null;
    const amps = statedAmperage(text)?.amps ?? eq.map(e => Number(e.amps) || 0).find(a => a > 0) ?? null;
    const small = size == null && (amps == null || amps <= 30) && !/\brtu\b|roof ?top|\bahu\b|compressor|condens/i.test(text);
    const term = termCodeFor(size, small);
    if (!term.code) { out[i] = { ...r, holdReason: 'no_unit', evidence: `Equipment connection — ${term.note}; price it by hand or pick a unit.` }; return; }
    const carried = tag ? ctx.feederCarried?.get(tag) : undefined;
    out[i] = { ...r, libraryCode: term.code, evidence: `Equipment connection (Chris's units): termination ${term.note}${size ? '' : amps ? `, ${amps} A load` : ''}.${carried ? ` Wiring carried by the feeder estimate ${carried}.` : ''}` };
  });

  // Power poles: one priced row (the largest count), the rest are the same poles.
  const ppLive = ppRows.filter(i => qtyOf(out[i]) > 0).sort((a, b) => qtyOf(out[b]) - qtyOf(out[a]));
  ppLive.forEach((i, k) => {
    out[i] = k === 0
      ? { ...out[i], libraryCode: 'PP-SET', evidence: 'Power pole — set and wire, Chris\'s unit 3.5 h.' }
      : { ...out[i], note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "${out[ppLive[0]].item}" — the same power poles.` };
  });

  const fansSorted = [...fanRows].sort((a, b) => qtyOf(out[b]) - qtyOf(out[a]));
  fansSorted.forEach((i, k) => {
    out[i] = k === 0
      ? { ...out[i], libraryCode: 'FAN-CEIL', evidence: 'Ceiling fan — hang and connect, Chris\'s unit 2.5 h.' }
      : { ...out[i], note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "${out[fansSorted[0]].item}" — the same ceiling fans.` };
  });

  // Disconnects: a size from the equipment family they name; duplicates noted.
  const priced: Array<{ fam: string; qty: number; i: number }> = [];
  for (const i of disconnectRows) {
    const r = out[i];
    const text = textOf(r);
    if (qtyOf(r) <= 0) continue;
    if (statedAmperage(text)) continue; // the mapper's DISC-xx alias rule
    const fams = Object.entries(FAMILY_RE).filter(([, re]) => re.test(text)).map(([f]) => f);
    const famEquip = fams.length === 1 ? equip.filter(e => new RegExp(`^${fams[0]}-?\\d`, 'i').test(String(e.tag ?? '')) && (Number(e.amps) > 0 || statedAmperage(String(e.description ?? '')))) : [];
    const tags = [...new Set(famEquip.map(e => String(e.tag).toUpperCase()))];
    const dup = priced.find(p => p.fam === fams[0] && p.qty === qtyOf(r));
    if (dup) { out[i] = { ...r, note: 'duplicate', evidence: `${NOTE_PREFIXES.duplicate} "${out[dup.i].item}" — the same ${qtyOf(r)} ${fams[0]} disconnects.` }; continue; }
    if (fams.length !== 1 || tags.length !== qtyOf(r)) {
      out[i] = { ...r, holdReason: 'needs_size', evidence: `Disconnect with no amperage${fams.length === 1 ? ` — ${tags.length} ${fams[0]} units on the drawings vs ${qtyOf(r)} disconnects` : ' — the equipment it serves is not named'}: pick the size.` };
      continue;
    }
    const amps = Math.max(...famEquip.map(e => Number(e.amps) || statedAmperage(String(e.description ?? ''))?.amps || 0));
    const size = [30, 60, 100, 200, 400].find(a => a >= amps) ?? null;
    if (!size) { out[i] = { ...r, holdReason: 'needs_size', evidence: `Disconnect for ${amps} A ${fams[0]} units — no unit at that size.` }; continue; }
    priced.push({ fam: fams[0], qty: qtyOf(r), i });
    out[i] = { ...r, libraryCode: `DISC-${size}`, evidence: `Disconnect sized from the ${fams[0]} units it serves (${tags.join(', ')}: ${amps} A) → ${size}A safety switch (Chris's ${size}A unit).` };
  }
  return out;
}
