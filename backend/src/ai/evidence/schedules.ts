// Evidence round 3.1 / 3.2 — schedules read row by row with cell evidence,
// and equipment quantities taken from those rows. Pure.
//
// 3.1 A schedule viewport becomes a table of rows {sheet, table, row_idx,
//     cells[], box}: from the text layer when the viewport has one
//     (tableFromRuns), otherwise from the model reading the viewport crop
//     ROW BY ROW (parseScheduleReply — every row transcribed, never a
//     summary; a panel schedule whose circuit numbers skip is flagged
//     incomplete). Panel schedules also yield circuit rows (ckt, description,
//     load, breaker, poles).
// 3.2 The schedule parser OWNS schedule quantities. An equipment-schedule
//     type (battery chargers, water heater, drinking fountain, drink machine,
//     mini-tune, ALC panel, RTU, pylon sign, the service disconnects …) is
//     quantified from the rows that name it — never by symbol counting, and
//     never by Agent 1: the evidence is the row. "BATT CHGR (5)" in a
//     circuit description expands to 5. A type no parsed row names stays
//     with the counter (as before).
import { parseAIJSON } from '../json';
import { normalizeTypeKey, type CountTarget } from '../countTargets';
import type { RectIn, TextRun } from './viewports';

export type TableKind = 'panel' | 'fixture' | 'equipment' | 'load' | 'other';

export interface ScheduleRow {
  rowIdx: number;
  cells: string[];
  /** Displayed inches on the sheet, when known. */
  boxIn?: RectIn;
}

export interface ScheduleTable {
  id: string;
  sheetKey: string;
  sheetLabel: string;
  viewportId: string | null;
  title: string;
  kind: TableKind;
  columns: string[];
  rows: ScheduleRow[];
  source: 'text' | 'vision';
  warnings: string[];
}

function clean(s: unknown, max = 160): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function tableKindOf(title: string, columns: string[]): TableKind {
  const t = `${title} ${columns.join(' ')}`.toUpperCase();
  if (/\bLOAD\s+(TOTALS?|SUMMARY)\b/.test(t)) return 'load';
  if (/\bPANEL\b|\bCKT\b|\bCIRCUIT\b.*\bBREAKER\b|\bTRIP\/POLES\b/.test(t)) return 'panel';
  if (/\bLUMINAIRE|\bFIXTURE|\bLIGHTING\s+FIXTURE/.test(t)) return 'fixture';
  if (/\bEQUIPMENT\b|\bMECHANICAL\b|\bCONNECTION/.test(t)) return 'equipment';
  return 'other';
}

/** Pure: the schedule model's strict JSON for ONE table crop. Row boxes are
 *  fractions of the crop (y0/y1), mapped onto the viewport's rectangle. */
export function parseScheduleReply(
  text: string,
  ctx: { sheetKey: string; sheetLabel: string; viewportId: string | null; viewportTitle: string; rectIn?: RectIn },
): ScheduleTable | null {
  const parsed = parseAIJSON(text);
  if (!parsed || !Array.isArray(parsed.rows)) return null;
  const columns = Array.isArray(parsed.columns) ? (parsed.columns as unknown[]).map(c => clean(c, 60)) : [];
  const title = clean(parsed.title, 80) || ctx.viewportTitle;
  const rows: ScheduleRow[] = [];
  (parsed.rows as unknown[]).forEach((r, i) => {
    let cells: unknown[] | null = null;
    let y0: number | null = null, y1: number | null = null;
    if (Array.isArray(r)) cells = r;
    else if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      cells = Array.isArray(o.cells) ? o.cells : null;
      const n0 = Number(o.y0), n1 = Number(o.y1);
      if (Number.isFinite(n0) && Number.isFinite(n1) && n1 > n0 && n0 >= -0.01 && n1 <= 1.01) { y0 = Math.max(0, n0); y1 = Math.min(1, n1); }
    }
    if (!cells) return;
    const c = cells.map(x => clean(x));
    if (!c.some(Boolean)) return;
    rows.push({
      rowIdx: i,
      cells: c,
      ...(ctx.rectIn && y0 !== null && y1 !== null ? { boxIn: { left: ctx.rectIn.left, top: ctx.rectIn.top + y0 * ctx.rectIn.height, width: ctx.rectIn.width, height: (y1 - y0) * ctx.rectIn.height } } : {}),
    });
  });
  const table: ScheduleTable = {
    id: `${ctx.viewportId ?? ctx.sheetKey}:${slug(title)}`,
    sheetKey: ctx.sheetKey, sheetLabel: ctx.sheetLabel, viewportId: ctx.viewportId,
    title, kind: tableKindOf(title, columns), columns, rows, source: 'vision', warnings: [],
  };
  if (table.kind === 'panel') table.warnings.push(...panelContinuity(table));
  return table;
}

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'TABLE';
}

/** Pure: a table from text runs inside a schedule viewport (text-layer
 *  sheets). Rows = runs sharing a baseline; columns = the header row's cell
 *  starts (the first row with 3+ cells that has a header word). */
export function tableFromRuns(
  runs: TextRun[],
  ctx: { sheetKey: string; sheetLabel: string; viewportId: string | null; title: string },
): ScheduleTable | null {
  const sorted = runs.filter(r => r.str.trim()).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  if (!sorted.length) return null;
  const rowsRaw: TextRun[][] = [];
  for (const r of sorted) {
    const row = rowsRaw.find(rr => Math.abs(rr[0].y - r.y) <= 0.35 * Math.max(rr[0].h, r.h));
    if (row) row.push(r); else rowsRaw.push([r]);
  }
  rowsRaw.forEach(r => r.sort((a, b) => a.x - b.x));
  const HEADER = /\b(CKT|CIRCUIT|DESCRIPTION|BREAKER|LOAD|TYPE|MARK|QTY|TAG|VOLTS?|WATTS?|MFR|CATALOG|HP|KVA|AMPS?)\b/i;
  const headerIdx = rowsRaw.findIndex(r => r.length >= 3 && r.some(x => HEADER.test(x.str)));
  if (headerIdx < 0) return null;
  const header = rowsRaw[headerIdx];
  const starts = header.map(h => h.x);
  const cellOf = (x: number) => { let i = 0; for (let k = 0; k < starts.length; k++) if (x >= starts[k] - 4) i = k; return i; };
  const rows: ScheduleRow[] = [];
  rowsRaw.slice(headerIdx + 1).forEach((r, i) => {
    const cells = starts.map(() => '');
    for (const run of r) { const k = cellOf(run.x); cells[k] = cells[k] ? `${cells[k]} ${run.str.trim()}` : run.str.trim(); }
    const top = Math.min(...r.map(x => x.y)), bottom = Math.max(...r.map(x => x.y + x.h));
    const left = Math.min(...r.map(x => x.x)), right = Math.max(...r.map(x => x.x + x.w));
    rows.push({ rowIdx: i, cells: cells.map(c => clean(c)), boxIn: { left: left / 72, top: top / 72, width: (right - left) / 72, height: (bottom - top) / 72 } });
  });
  const columns = header.map(h => clean(h.str, 60));
  const table: ScheduleTable = {
    id: `${ctx.viewportId ?? ctx.sheetKey}:${slug(ctx.title)}`, sheetKey: ctx.sheetKey, sheetLabel: ctx.sheetLabel,
    viewportId: ctx.viewportId, title: ctx.title, kind: tableKindOf(ctx.title, columns), columns, rows, source: 'text', warnings: [],
  };
  if (table.kind === 'panel') table.warnings.push(...panelContinuity(table));
  return table;
}

// ── Panel schedules ────────────────────────────────────────────────────────

export interface PanelCircuitRow {
  panel: string;
  circuit: number;
  description: string;
  loadVA: number | null;
  breaker: string;
  poles: number;
  /** A continuation row of a multi-pole breaker (no description of its own). */
  continuation: boolean;
  tableId: string;
  rowIdx: number;
  cells: string[];
  boxIn?: RectIn;
}

function colIndex(columns: string[], re: RegExp): number {
  return columns.findIndex(c => re.test(c));
}

export function panelNameOf(title: string): string {
  const m = /\bPANEL(?:BOARD)?\s*["']?([A-Z0-9-]{1,6})["']?/i.exec(title);
  return m ? m[1].toUpperCase() : title.toUpperCase().slice(0, 12);
}

/** Pure: a panel table's circuit rows. Columns are found by header words
 *  (CKT, BREAKER/TRIP, DESCRIPTION, LOAD A/B/C); without a header, the
 *  common order ckt | breaker | description | loads… is assumed. */
export function panelCircuitRows(table: ScheduleTable): PanelCircuitRow[] {
  const cols = table.columns.map(c => c.toUpperCase());
  let ckt = colIndex(cols, /\bCKT\b|\bCIRCUIT\s*#|^#$|\bNO\.?\b/);
  let brk = colIndex(cols, /\bBREAKER\b|\bTRIP\b|\bPOLES?\b/);
  let desc = colIndex(cols, /DESCRIPTION|\bLOAD\s+SERVED\b|\bSERVES\b/);
  if (ckt < 0) ckt = 0;
  if (brk < 0) brk = 1;
  if (desc < 0) desc = 2;
  const loadCols = cols.map((c, i) => (/^(A|B|C|L1|L2|L3|LOAD|VA|LOAD VA|PHASE [ABC])$/.test(c.trim()) || /\bVA\b/.test(c)) && i !== desc ? i : -1).filter(i => i >= 0);
  const panel = panelNameOf(table.title);
  const out: PanelCircuitRow[] = [];
  let lastPoles = 1, lastLeft = 0;
  for (const r of table.rows) {
    const n = Number((r.cells[ckt] ?? '').replace(/[^0-9]/g, ''));
    if (!Number.isInteger(n) || n <= 0 || n > 200) continue;
    const breaker = (r.cells[brk] ?? '').trim();
    const d = (r.cells[desc] ?? '').trim();
    const pm = /(\d+)?\s*\/\s*(\d)\b/.exec(breaker);
    const poles = pm ? Number(pm[2]) : 1;
    const isCont = !d && (/^[|│┃l1I]?$/.test(breaker) || breaker === '') && lastLeft > 0;
    const loads = (loadCols.length ? loadCols : r.cells.map((_, i) => i).filter(i => i > desc))
      .map(i => Number((r.cells[i] ?? '').replace(/,/g, ''))).filter(v => Number.isFinite(v) && v > 0);
    out.push({
      panel, circuit: n, description: d, loadVA: loads.length ? loads.reduce((a, b) => a + b, 0) : null,
      breaker, poles: isCont ? lastPoles : poles, continuation: isCont,
      tableId: table.id, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}),
    });
    if (isCont) lastLeft--;
    else { lastPoles = poles; lastLeft = poles - 1; }
  }
  return out;
}

/** Pure: gaps in a panel's circuit numbering (a vision transcription that
 *  skipped rows). Circuits run 1,3,5… and 2,4,6… — any missing number
 *  between the lowest and highest of either run is reported. */
export function panelContinuity(table: ScheduleTable): string[] {
  const nums = panelCircuitRows(table).map(r => r.circuit);
  if (nums.length < 3) return nums.length ? [] : [`${table.title}: no circuit rows could be read`];
  const out: string[] = [];
  for (const parity of [1, 0]) {
    const s = nums.filter(n => n % 2 === parity).sort((a, b) => a - b);
    if (s.length < 2) continue;
    const missing: number[] = [];
    for (let n = s[0]; n <= s[s.length - 1]; n += 2) if (!s.includes(n)) missing.push(n);
    if (missing.length) out.push(`${table.title}: circuit(s) ${missing.join(', ')} missing from the transcription — incomplete`);
  }
  return out;
}

// ── 3.2 Equipment from schedules ───────────────────────────────────────────

export interface ScheduleEvidenceRow {
  sheetKey: string;
  sheetLabel: string;
  tableId: string;
  table: string;
  rowIdx: number;
  cells: string[];
  boxIn?: RectIn;
  qty: number;
}

export interface ScheduleCount {
  key: string;
  qty: number;
  rows: ScheduleEvidenceRow[];
  note: string;
}

const ABBREV: Array<[RegExp, string]> = [
  [/\bBATT\b/g, 'BATTERY'], [/\bCHGRS?\b/g, 'CHARGER'], [/\bCHRGR\b/g, 'CHARGER'], [/\bWH\b/g, 'WATER HEATER'],
  [/\bEWH\b/g, 'WATER HEATER'], [/\bDF\b/g, 'DRINKING FOUNTAIN'], [/\bEWC\b/g, 'DRINKING FOUNTAIN'], [/\bMACH\b/g, 'MACHINE'],
  [/\bRECEPT\b/g, 'RECEPTACLE'], [/\bRCPT\b/g, 'RECEPTACLE'], [/\bLTG\b/g, 'LIGHTING'], [/\bLTS\b/g, 'LIGHTS'],
  [/\bEF\b/g, 'EXHAUST FAN'], [/\bDISC\b/g, 'DISCONNECT'], [/\bXFMR\b/g, 'TRANSFORMER'], [/\bREFRIG\b/g, 'REFRIGERATOR'],
];

const STOP = new Set(['THE', 'AND', 'WITH', 'FOR', 'EACH', 'VIA', 'PER', 'FROM', 'TO', 'OF', 'ON', 'IN', 'AT', 'BY', 'ALL', 'NEW', 'EXISTING', 'CIRCUIT', 'CIRCUITS', 'BREAKER', 'POWER', 'CONNECTION', 'PANEL', 'VA', 'HP', 'KVA', 'NEMA']);

/** Uppercase, abbreviations expanded, plurals folded, punctuation spaced. */
export function normDesc(s: string): string {
  let t = ` ${s.toUpperCase().replace(/[^A-Z0-9#]+/g, ' ')} `;
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  return t.replace(/\b([A-Z]{3,})S\b/g, '$1').replace(/\s+/g, ' ').trim();
}

function sigWords(s: string): string[] {
  return normDesc(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));
}

/** "(5)", "(QTY 5)", "5 EA", "x5" -> 5. */
export function multiplierOf(s: string): number | null {
  const m = /\(\s*(?:QTY\.?\s*)?(\d{1,2})\s*\)|\bQTY\.?\s*(\d{1,2})\b|\b(\d{1,2})\s*EA\b|[x×]\s*(\d{1,2})\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return n > 1 && n <= 60 ? n : null;
}

/** Circuit references in a description: "B-15/17/19/21/23", "A-27",
 *  "breaker B-1,3,5", "circuit A-18". */
export function circuitRefs(s: string): Array<{ panel: string; circuit: number }> {
  const out: Array<{ panel: string; circuit: number }> = [];
  const re = /\b([A-Z]{1,3})\s*-\s*(\d{1,3}(?:\s*[,/&]\s*\d{1,3})*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.toUpperCase()))) {
    if (/^(RTU|EF|CF|AHU|WH|DF|MB|NEMA|UL|IES|MH|HP|TYPE)$/.test(m[1])) continue;
    for (const n of m[2].split(/[,/&]/).map(x => Number(x.trim()))) if (Number.isInteger(n) && n > 0) out.push({ panel: m[1], circuit: n });
  }
  return out;
}

function tagWords(tag: string): string {
  return ` ${normDesc(tag)} `;
}

/** Does this row text name the target? tag as whole words, or the target
 *  description's leading significant words all present. */
export function rowNamesTarget(rowText: string, t: CountTarget): boolean {
  const row = ` ${normDesc(rowText)} `;
  const tag = tagWords(t.type).trim();
  if (tag.length >= 3 && row.includes(` ${tag} `)) return true;
  const lead = sigWords(t.description.split(/[,;(]/)[0] ?? '').slice(0, 3);
  return lead.length >= 2 && lead.every(w => row.includes(` ${w} `));
}

/** Pure (3.2): schedule-owned quantities for equipment-schedule types. */
export function scheduleCounts(targets: CountTarget[], tables: ScheduleTable[]): Map<string, ScheduleCount> {
  const out = new Map<string, ScheduleCount>();
  const circuits = tables.filter(t => t.kind === 'panel').flatMap(t => panelCircuitRows(t).map(r => ({ r, t })));
  // Equipment schedules and load tables only: a symbol legend / symbol
  // schedule row ("EXHAUST FAN RECESSED — installed by HVAC") names a type
  // but is not a quantity.
  const otherRows = tables.filter(t => t.kind === 'equipment' || t.kind === 'load').flatMap(t => t.rows.map(r => ({ r, t })));
  for (const tgt of targets) {
    if (tgt.source !== 'equipment_schedule' || tgt.role === 'host') continue;
    const evidence: ScheduleEvidenceRow[] = [];
    // (a) panel circuits named by the target's tag / description, or at the
    //     circuits the target's own description cites — confirmed by words.
    const refs = circuitRefs(tgt.description);
    for (const { r, t } of circuits) {
      if (r.continuation || !r.description || /^(SPACE|SPARE)$/i.test(r.description)) continue;
      const named = rowNamesTarget(r.description, tgt);
      const tdesc = ` ${normDesc(`${tgt.type} ${tgt.description}`)} `;
      const cited = refs.some(x => x.panel === r.panel && x.circuit === r.circuit)
        && sigWords(r.description).some(w => tdesc.includes(` ${w} `));
      if (!named && !cited) continue;
      evidence.push({ sheetKey: t.sheetKey, sheetLabel: t.sheetLabel, tableId: t.id, table: t.title, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}), qty: multiplierOf(r.description) ?? 1 });
    }
    // (b) equipment / load-total rows naming the tag (a QTY column wins).
    for (const { r, t } of otherRows) {
      const text = r.cells.join(' ');
      if (!rowNamesTarget(text, tgt)) continue;
      if (evidence.some(e => e.tableId === t.id && e.rowIdx === r.rowIdx)) continue;
      const qi = t.columns.findIndex(c => /^QTY\.?$|QUANTITY/i.test(c));
      const q = qi >= 0 ? Number(r.cells[qi]) : NaN;
      evidence.push({ sheetKey: t.sheetKey, sheetLabel: t.sheetLabel, tableId: t.id, table: t.title, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}), qty: Number.isInteger(q) && q > 0 ? q : multiplierOf(text) ?? 1 });
    }
    if (!evidence.length) continue;
    // A load served by a panel circuit AND listed in a load-totals table is
    // one load: panel rows are the evidence when both exist.
    const panelEv = evidence.filter(e => tables.find(t => t.id === e.tableId)?.kind === 'panel');
    const rows = panelEv.length ? panelEv : evidence;
    let qty = rows.reduce((s, e) => s + e.qty, 0);
    let note = `${rows.length} schedule row${rows.length === 1 ? '' : 's'} (${rows.map(e => `${e.table} ${e.cells.slice(0, 3).filter(Boolean).join(' ')}`).slice(0, 6).join('; ')})`;
    const descMult = multiplierOf(tgt.description);
    if (qty === 1 && descMult) { qty = descMult; note += ` × ${descMult} per the schedule description`; }
    out.set(tgt.key, { key: tgt.key, qty, rows, note });
  }
  return out;
}

/** Agent 1 rows that are panel-schedule circuit counts ("Lighting branch
 *  circuits 20/1 (work, sales…)", "20/1 branch circuits Panel B") — schedule
 *  quantities the parser owns (3.4). */
export function isCircuitCountRow(row: Record<string, unknown>): boolean {
  const item = String(row.item ?? '');
  return /\bbranch\s+circuits?\b|\bcircuits?\s+\d+\/\d\b|\b\d+\/\d\s+(?:branch\s+)?circuits?\b|\blighting\s+circuits?\b/i.test(item)
    && !/\bconduit\b|\bwire\b|\bhomerun\b|\bfeeder\b/i.test(item);
}

/** Pure (3.4): the parser's own branch-circuit rows, one per panel and
 *  breaker size, with the rows as evidence. */
export function circuitSummaryRows(tables: ScheduleTable[]): Array<{ row: Record<string, unknown>; evidence: ScheduleEvidenceRow[] }> {
  const out: Array<{ row: Record<string, unknown>; evidence: ScheduleEvidenceRow[] }> = [];
  for (const t of tables.filter(x => x.kind === 'panel' && !x.warnings.some(w => /incomplete|no circuit/.test(w)))) {
    const groups = new Map<string, PanelCircuitRow[]>();
    for (const r of panelCircuitRows(t)) {
      if (r.continuation || !r.description || /^(SPACE|SPARE)$/i.test(r.description)) continue;
      const size = (/(\d+)\s*\/\s*\d/.exec(r.breaker)?.[1] ?? '?');
      const k = `${size}/${r.poles}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    for (const [k, rs] of groups) {
      out.push({
        row: {
          category: 'Branch Power', item: `Branch circuit ${k} — Panel ${rs[0].panel}`, qty: rs.length, unit: 'EA',
          spec: rs.map(r => `${r.circuit} ${r.description}`).join('; ').slice(0, 300), sourceSheet: t.sheetLabel.split(' ')[0], confidence: 'VERIFIED',
          countedBy: 'schedule',
        },
        evidence: rs.map(r => ({ sheetKey: t.sheetKey, sheetLabel: t.sheetLabel, tableId: t.id, table: t.title, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}), qty: 1 })),
      });
    }
  }
  return out;
}

/** The normalized key helper, re-exported for callers building evidence. */
export { normalizeTypeKey };
