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
 *  starts (the first row with 3+ cells that has a header word).
 *  Fix round B9 — a TWO-SIDED panel schedule (odd circuits left, even right
 *  on one line: CKT | BKR | DESCRIPTION | A B C | DESCRIPTION | BKR | CKT)
 *  repeats its CKT / DESCRIPTION headers: every line becomes TWO rows, the
 *  left side's then the right side's, in the left side's column order. */
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
  const hdr = header.map(h => clean(h.str, 60));
  const isCkt = (c: string) => /^(CKT|CIRCUIT|CKT\s*#|#|NO\.?)$/i.test(c.trim()) || /\bCKT\b/i.test(c);
  const isDesc = (c: string) => /DESCRIPTION|LOAD\s+SERVED|\bSERVES\b/i.test(c);
  const cktIdx = hdr.map((c, i) => (isCkt(c) ? i : -1)).filter(i => i >= 0);
  const descIdx = hdr.map((c, i) => (isDesc(c) ? i : -1)).filter(i => i >= 0);
  const twoSided = cktIdx.length >= 2 && descIdx.length >= 2;
  // Right side: from the second description column on; mapped back onto the
  // left side's column order by header name.
  const split = twoSided ? descIdx[1] : hdr.length;
  const leftCols = hdr.slice(0, split);
  const rightMap: number[] = twoSided ? leftCols.map(name => {
    const n = name.toUpperCase();
    const same = hdr.map((h, i) => ({ h: h.toUpperCase(), i })).filter(x => x.i >= split && (x.h === n || (isCkt(x.h) && isCkt(n)) || (isDesc(x.h) && isDesc(n)) || (/BREAKER|TRIP|POLE/.test(x.h) && /BREAKER|TRIP|POLE/.test(n))));
    return same.length ? same[0].i : -1;
  }) : [];
  const rows: ScheduleRow[] = [];
  let idx = 0;
  for (const r of rowsRaw.slice(headerIdx + 1)) {
    const cells = starts.map(() => '');
    for (const run of r) { const k = cellOf(run.x); cells[k] = cells[k] ? `${cells[k]} ${run.str.trim()}` : run.str.trim(); }
    const top = Math.min(...r.map(x => x.y)), bottom = Math.max(...r.map(x => x.y + x.h));
    const left = Math.min(...r.map(x => x.x)), right = Math.max(...r.map(x => x.x + x.w));
    const boxIn = { left: left / 72, top: top / 72, width: (right - left) / 72, height: (bottom - top) / 72 };
    const leftCells = cells.slice(0, split).map(c => clean(c));
    if (leftCells.some(Boolean)) rows.push({ rowIdx: idx++, cells: leftCells, boxIn });
    if (twoSided) {
      const rightCells = rightMap.map(i => (i >= 0 ? clean(cells[i]) : ''));
      if (rightCells.some(Boolean)) rows.push({ rowIdx: idx++, cells: rightCells, boxIn });
    }
  }
  const table: ScheduleTable = {
    id: `${ctx.viewportId ?? ctx.sheetKey}:${slug(ctx.title)}`, sheetKey: ctx.sheetKey, sheetLabel: ctx.sheetLabel,
    viewportId: ctx.viewportId, title: ctx.title, kind: tableKindOf(ctx.title, leftCols), columns: leftCols, rows, source: 'text', warnings: [],
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

/** Fix round S10 — the panel's name from its table title: "PANEL A",
 *  "PANEL 'LP-1'", "PANELBOARD LP-1", "PANEL SCHEDULE A", "A PANEL". */
export function panelNameOf(title: string): string {
  const t = title.toUpperCase().replace(/[“”"'’‘]/g, ' ');
  const SKIP = new Set(['SCHEDULE', 'SCHED', 'BOARD', 'NAME', 'ID', 'NO', 'NO.', 'DESIGNATION', ':', '#', '-']);
  const m = /\bPANEL(?:BOARD)?\b(.*)$/.exec(t);
  if (m) {
    for (const tok of m[1].split(/[\s:#]+/).filter(Boolean)) {
      if (SKIP.has(tok)) continue;
      if (/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(tok)) return tok;
      break;
    }
  }
  const before = /\b([A-Z0-9][A-Z0-9-]{0,7})\s+PANEL(?:BOARD)?\b/.exec(t);
  if (before && !SKIP.has(before[1])) return before[1];
  return t.trim().slice(0, 12);
}

const EMPTY_LOAD = /^\(?\s*(SPARE|SPACE)\b|^[-–—_.\s]*$|^N\/?A$/i;
/** SPARE / SPACE / "--" rows are not loads (fix round S10). */
export function isEmptyLoad(description: string): boolean {
  return EMPTY_LOAD.test(description.trim());
}

/** Pure: a panel table's circuit rows. Columns are found by header words
 *  (CKT, BREAKER/TRIP, DESCRIPTION, LOAD A/B/C); without a header, the
 *  common order ckt | breaker | description | loads… is assumed.
 *  Fix round S10 — "1,3,5" in the circuit cell is a 3-pole load on circuit
 *  1 (never circuit 135); a multi-pole breaker's following circuits on the
 *  same side (c+2, c+4) are continuations of ONE load, whether the
 *  transcription left their description empty or repeated it. */
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
  for (const r of table.rows) {
    const nums = (r.cells[ckt] ?? '').split(/[,&/\s-]+/).map(x => x.replace(/[^0-9]/g, '')).filter(Boolean).map(Number);
    const n = nums[0];
    if (!Number.isInteger(n) || n <= 0 || n > 200) continue;
    const breaker = (r.cells[brk] ?? '').trim();
    const d = (r.cells[desc] ?? '').trim();
    const pm = /(\d+)?\s*\/\s*(\d)\b/.exec(breaker) ?? /\b(\d+)\s*A?\s*[-/]?\s*(\d)\s*P\b/i.exec(breaker);
    const poles = nums.length > 1 ? Math.min(nums.length, 3) : pm ? Number(pm[2]) : 1;
    const loads = (loadCols.length ? loadCols : r.cells.map((_, i) => i).filter(i => i > desc))
      .map(i => Number((r.cells[i] ?? '').replace(/,/g, ''))).filter(v => Number.isFinite(v) && v > 0);
    out.push({
      panel, circuit: n, description: d, loadVA: loads.length ? loads.reduce((a, b) => a + b, 0) : null,
      breaker, poles, continuation: false,
      tableId: table.id, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}),
    });
  }
  // Continuations, by circuit number (sides may be listed apart).
  const byCkt = new Map(out.map(r => [r.circuit, r]));
  for (const r of [...out].sort((a, b) => a.circuit - b.circuit)) {
    if (r.continuation || r.poles < 2) continue;
    for (let k = 1; k < r.poles; k++) {
      const c = byCkt.get(r.circuit + 2 * k);
      if (!c || c.continuation) break;
      const blankish = !c.description || /^[|│┃l1I"-]+$/.test(c.description) || normDesc(c.description) === normDesc(r.description);
      const brkOk = !c.breaker || /^[|│┃l1I"-]*$/.test(c.breaker) || c.breaker === r.breaker;
      if (!blankish || !brkOk) break;
      c.continuation = true;
      c.poles = r.poles;
    }
  }
  return out;
}

/** Pure: gaps in a panel's circuit numbering (a vision transcription that
 *  skipped rows). Circuits run 1,3,5… and 2,4,6… — any missing number
 *  between the lowest and highest of either run is reported. Fix round B9:
 *  a panel whose circuits are ALL odd or ALL even (the other side never
 *  read) is incomplete too. */
export function panelContinuity(table: ScheduleTable): string[] {
  const nums = panelCircuitRows(table).map(r => r.circuit);
  if (nums.length < 3) return nums.length ? [] : [`${table.title}: no circuit rows could be read`];
  const out: string[] = [];
  const odd = nums.filter(n => n % 2 === 1).length, even = nums.length - odd;
  const consecutive = [...new Set(nums)].sort((a, b) => a - b).every((n, i, arr) => i === 0 || n === arr[i - 1] + 1);
  if (!consecutive && (odd === 0 || even === 0)) out.push(`${table.title}: only the ${odd ? 'odd' : 'even'} side was read — incomplete`);
  for (const parity of [1, 0]) {
    const s = nums.filter(n => n % 2 === parity).sort((a, b) => a - b);
    if (s.length < 2) continue;
    const missing: number[] = [];
    for (let n = s[0]; n <= s[s.length - 1]; n += 2) if (!s.includes(n)) missing.push(n);
    if (missing.length) out.push(`${table.title}: circuit(s) ${missing.join(', ')} missing from the transcription — incomplete`);
  }
  return out;
}

export function isCompletePanel(t: ScheduleTable): boolean {
  return t.kind === 'panel' && !t.warnings.some(w => /incomplete|no circuit/.test(w));
}

/** Fix round S10 — the same panel read twice (on two sheets, or a revised
 *  copy): one table per panel name. Identical content -> the first is kept;
 *  different content -> the more complete one is kept and a warning added. */
export function dedupePanels(tables: ScheduleTable[]): ScheduleTable[] {
  const out: ScheduleTable[] = [];
  const sig = (t: ScheduleTable) => panelCircuitRows(t).map(r => `${r.circuit}:${normDesc(r.description)}`).sort().join('|');
  for (const t of tables) {
    if (t.kind !== 'panel') { out.push(t); continue; }
    const name = panelNameOf(t.title);
    const i = out.findIndex(o => o.kind === 'panel' && panelNameOf(o.title) === name);
    if (i < 0) { out.push(t); continue; }
    const o = out[i];
    if (sig(o) === sig(t)) continue;
    const better = (isCompletePanel(t) && !isCompletePanel(o)) || (isCompletePanel(t) === isCompletePanel(o) && t.rows.length > o.rows.length) ? t : o;
    const other = better === t ? o : t;
    out[i] = { ...better, warnings: [...better.warnings, `Panel ${name} is also read on ${other.sheetLabel} with different content — ${better.sheetLabel}'s copy used; check which is current`] };
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

/** Fix round B8 — an EXPLICIT quantity in a description (or a qty cell):
 *  "(5)", "(5) EA", "(QTY 5)", "QTY 5", "QTY: 5", "x5" / "× 5" standing
 *  alone. Never a dimension ("2X4", "2'X4'"), a rating ("MAX 30", "30A"),
 *  a conductor count ("(2)#10") or a model number. Callers pass the
 *  description cell only, never the whole row. */
export function multiplierOf(s: string): number | null {
  const t = ` ${s.toUpperCase()} `;
  const pats = [
    /\(\s*(?:QTY\.?:?\s*)?(\d{1,2})\s*\)(?!\s*[#\d/])/,
    /\bQTY\.?:?\s*(\d{1,2})\b(?!\s*[#/'"])/,
    /(?:^|\s)[X×]\s?(\d{1,2})(?=\s|$)/,
  ];
  for (const re of pats) {
    const m = re.exec(t);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > 1 && n <= 60) return n;
  }
  return null;
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

/** Fix round B7 — a tag as a whole token with its exact suffix: "EF-1"
 *  matches "EF-1", "EF 1", "EF1" but never "EF-12" or "EF-2". */
export function tagRegex(tag: string): RegExp | null {
  const t = tag.toUpperCase().trim();
  const m = /^([A-Z]{1,6})[\s-]*(\d{1,3}[A-Z]?)$/.exec(t);
  if (m) return new RegExp(`(?:^|[^A-Z0-9])${m[1]}[\\s-]*${m[2]}(?![A-Z0-9])`);
  return null;
}

/** Does this row text name the target by its TAG (whole token, exact
 *  suffix)? Tags without a number ("BATT CHGR", "DRINK MACH") match as
 *  whole words after abbreviation expansion. */
export function rowNamesTag(rowText: string, t: Pick<CountTarget, 'type'>): boolean {
  const re = tagRegex(t.type);
  if (re) return re.test(` ${rowText.toUpperCase()} `);
  const tag = normDesc(t.type);
  return tag.length >= 3 && ` ${normDesc(rowText)} `.includes(` ${tag} `);
}

/** Does this row text name the target? Its tag, or the target
 *  description's leading significant words. (Assignment to exactly one
 *  target is scheduleCounts' job — see assignRows.) */
export function rowNamesTarget(rowText: string, t: CountTarget): boolean {
  if (rowNamesTag(rowText, t)) return true;
  const row = ` ${normDesc(rowText)} `;
  const lead = sigWords(t.description.split(/[,;(]/)[0] ?? '').slice(0, 3);
  return lead.length >= 2 && lead.every(w => row.includes(` ${w} `));
}

/** Fix round B7 — each row belongs to EXACTLY one target: the targets whose
 *  tag it names (a numbered tag wins over a word tag); else, only when it
 *  names no equipment target's tag at all, the ONE target its description
 *  matches (two description matches = nobody's: the counter keeps them). */
function assignRow(rowText: string, candidates: CountTarget[], all: CountTarget[]): CountTarget | null {
  const byTag = all.filter(t => rowNamesTag(rowText, t));
  if (byTag.length) {
    const numbered = byTag.filter(t => tagRegex(t.type));
    const pick = numbered.length ? numbered : byTag;
    return pick.length === 1 && candidates.includes(pick[0]) ? pick[0] : null;
  }
  const byDesc = candidates.filter(t => rowNamesTarget(rowText, t));
  return byDesc.length === 1 ? byDesc[0] : null;
}

/** Pure (3.2): schedule-owned quantities for equipment-schedule types.
 *  Fix round S10: only COMPLETE panels (a half-read panel's rows could be
 *  missing loads), each panel once, SPARE/SPACE never a load, a multi-pole
 *  load once, and a multiplier repeated on every row of one tag counted
 *  once ("BATT CHGR (5)" on B-15..23 is 5, not 25). */
export function scheduleCounts(targets: CountTarget[], tablesIn: ScheduleTable[]): Map<string, ScheduleCount> {
  const out = new Map<string, ScheduleCount>();
  const tables = dedupePanels(tablesIn);
  const circuits = tables.filter(isCompletePanel).flatMap(t => panelCircuitRows(t).map(r => ({ r, t })));
  // Equipment schedules and load tables only: a symbol legend / symbol
  // schedule row ("EXHAUST FAN RECESSED — installed by HVAC") names a type
  // but is not a quantity.
  const otherRows = tables.filter(t => t.kind === 'equipment' || t.kind === 'load').flatMap(t => t.rows.map(r => ({ r, t })));
  const cands = targets.filter(t => t.source === 'equipment_schedule' && t.role !== 'host');
  const equipment = targets.filter(t => (t.category === 'equipment' || t.source === 'equipment_schedule') && t.role !== 'host');
  const ev = new Map<string, ScheduleEvidenceRow[]>();
  const push = (k: string, e: ScheduleEvidenceRow) => ev.set(k, [...(ev.get(k) ?? []), e]);
  // (a) panel circuits.
  for (const { r, t } of circuits) {
    if (r.continuation || !r.description || isEmptyLoad(r.description)) continue;
    let tgt = assignRow(r.description, cands, equipment);
    if (!tgt) {
      // The circuits a target's own description cites, confirmed by a word.
      const cited = cands.filter(c => circuitRefs(c.description).some(x => x.panel === r.panel && x.circuit === r.circuit)
        && sigWords(r.description).some(w => ` ${normDesc(`${c.type} ${c.description}`)} `.includes(` ${w} `)));
      if (cited.length === 1 && !equipment.some(o => o !== cited[0] && rowNamesTag(r.description, o))) tgt = cited[0];
    }
    if (!tgt) continue;
    push(tgt.key, { sheetKey: t.sheetKey, sheetLabel: t.sheetLabel, tableId: t.id, table: t.title, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}), qty: multiplierOf(r.description) ?? 1 });
  }
  // (b) equipment / load-total rows (a QTY column wins; else the
  //     description cell's explicit quantity; never the whole row's text).
  for (const { r, t } of otherRows) {
    const di = t.columns.findIndex(c => /DESC|EQUIPMENT|NAME|SERVES|LOAD\s+SERVED|CIRCUIT\s+DESCRIPTION/i.test(c));
    const descCell = di >= 0 ? (r.cells[di] ?? '') : '';
    const text = r.cells.join(' ');
    if (descCell && isEmptyLoad(descCell)) continue;
    const tgt = assignRow(text, cands, equipment);
    if (!tgt) continue;
    const qi = t.columns.findIndex(c => /^QTY\.?$|QUANTITY/i.test(c));
    const q = qi >= 0 ? Number(r.cells[qi]) : NaN;
    push(tgt.key, { sheetKey: t.sheetKey, sheetLabel: t.sheetLabel, tableId: t.id, table: t.title, rowIdx: r.rowIdx, cells: r.cells, ...(r.boxIn ? { boxIn: r.boxIn } : {}), qty: Number.isInteger(q) && q > 0 ? q : (descCell ? multiplierOf(descCell) : null) ?? 1 });
  }
  for (const tgt of cands) {
    const evidence = ev.get(tgt.key);
    if (!evidence?.length) continue;
    // A load served by a panel circuit AND listed in a load-totals table is
    // one load: panel rows are the evidence when both exist.
    const panelEv = evidence.filter(e => tables.find(t => t.id === e.tableId)?.kind === 'panel');
    const rows = panelEv.length ? panelEv : evidence;
    const mults = rows.filter(e => e.qty > 1).map(e => e.qty);
    let qty: number;
    let note = `${rows.length} schedule row${rows.length === 1 ? '' : 's'} (${rows.map(e => `${e.table} ${e.cells.slice(0, 3).filter(Boolean).join(' ')}`).slice(0, 6).join('; ')})`;
    if (mults.length > 1 && mults.every(m => m === mults[0])) {
      // The same "(n)" on every row of this tag is the tag's total, once.
      qty = Math.max(mults[0], rows.length);
      note += ` — "(${mults[0]})" repeated on ${mults.length} rows counted once`;
    } else {
      qty = rows.reduce((s, e) => s + e.qty, 0);
    }
    const descMult = multiplierOf(tgt.description);
    if (qty === 1 && descMult) { qty = descMult; note += ` × ${descMult} per the schedule description`; }
    out.set(tgt.key, { key: tgt.key, qty, rows, note });
  }
  return out;
}

/** Agent 1 rows that are panel-schedule circuit counts ("Lighting branch
 *  circuits 20/1 (work, sales…)", "20/1 branch circuits Panel B", "20A/1P
 *  breakers", "Dedicated circuits (20/1)"). A single named breaker ("20A
 *  high magnetic breaker B-20") is an item, not a circuit count. */
export function isCircuitCountRow(row: Record<string, unknown>): boolean {
  const item = String(row.item ?? '');
  if (/\bconduit\b|\bwire\b|\bhomerun\b|\bfeeder\b/i.test(item)) return false;
  return /\bbranch\s+circuits?\b|\bcircuits?\s*\(?\s*\d+\s*A?\s*\/\s*\d\b|\b\d+\s*A?\s*\/\s*\d\s*P?\b[^,;()]{0,25}\bcircuits?\b|\blighting\s+circuits?\b|\bdedicated\s+circuits?\b/i.test(item)
    || /\b\d+\s*A?\s*\/\s*\d\s*P?\s+breakers\b|\bbreakers\b.*\b\d+\s*A?\s*\/\s*\d/i.test(item);
}

/** The panels an Agent 1 row names ("… Panel B", "Panels A & B"). */
export function panelsNamedIn(item: string): string[] {
  const m = /\bPANEL(?:BOARD)?S?\s+([A-Z0-9][A-Z0-9-]{0,7}(?:\s*(?:,|&|AND|\/)\s*[A-Z0-9][A-Z0-9-]{0,7})*)/i.exec(item);
  return m ? m[1].toUpperCase().split(/\s*(?:,|&|AND|\/)\s*/).filter(Boolean) : [];
}

/** Pure (3.4): the parser's own branch-circuit rows, one per COMPLETELY
 *  read panel and breaker size, with the rows as evidence; `panels` = the
 *  panels they cover. SPARE / SPACE and continuation rows are not circuits;
 *  a panel read twice is counted once. */
export function circuitSummaryRows(tablesIn: ScheduleTable[]): Array<{ row: Record<string, unknown>; evidence: ScheduleEvidenceRow[]; panel: string }> {
  const out: Array<{ row: Record<string, unknown>; evidence: ScheduleEvidenceRow[]; panel: string }> = [];
  for (const t of dedupePanels(tablesIn).filter(isCompletePanel)) {
    const groups = new Map<string, PanelCircuitRow[]>();
    for (const r of panelCircuitRows(t)) {
      if (r.continuation || !r.description || isEmptyLoad(r.description)) continue;
      const size = (/(\d+)\s*A?\s*[/-]\s*\d/.exec(r.breaker)?.[1] ?? '?');
      const k = `${size}/${r.poles}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    for (const [k, rs] of groups) {
      out.push({
        panel: rs[0].panel,
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
