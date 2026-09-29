// Remodel round A2 — fixture / device tags drawn on the plans that are NOT
// in the count targets (36th Street: 13 type-"H" warehouse strip lights on
// E2.0, absent from the fixture schedule). Pure: no I/O, no AI.
//
// The counter reports them on their own channel (`unlisted`), never as
// marks. Each tag becomes ONE review item: the count is a SUGGESTION, never
// counted until the estimator names it (its own line) or answers "same as
// type X" (merged into X). The guard drops what is never a fixture tag:
// circuit numbers, room names / numbers, keyed-note numbers, door tags.

export interface UnlistedTag {
  tag: string;
  symbol: string;
  total: number;
  sheets: Array<{ sheetKey: string; label: string; count: number }>;
  marks: Array<{ sheetKey: string; x: number; y: number }>;
}

/** Normalizes a reported tag: "Type H" / "(H)" / "h " -> "H". */
export function normalizeUnlistedTag(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^type\s+/i, '').replace(/[()“”"'[\]{}]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

const NOT_A_TAG_SYMBOL = /\b(circuit|home\s*run|keyed|key\s*note|note|door|window|room|grid|column|detail|section|elevation|panel|wall\s*type|revision|matchline)\b/i;

/** Why a reported tag is NOT an unlisted fixture/device tag, or null when it
 *  may be one. */
/** Fix round S4 — never a fixture tag on their own: modifiers printed next
 *  to a symbol. */
export const TAG_MODIFIERS = new Set(['EM', 'WP', 'GFI', 'GFCI', 'X', 'TYP', 'NL']);

export interface UnlistedGuardContext {
  panels: string[];
  targetKeys: Set<string>;
  statusMarkers?: string[];
  /** Fix round S4 — the drawing analysis's panel-circuit numbers ("A01",
   *  "12,14") and equipment tags ("RTU-1", "AC1"). */
  circuits?: string[];
  equipmentTags?: string[];
}

/** Final check 1 — "circuit-LIKE" with no panel evidence: a letter + a
 *  zero-padded number ("A01", "B-05"). Never dropped and never blocking:
 *  listed in ONE non-blocking "possible unlisted tags" item. */
export function circuitLike(tag: string): boolean {
  return /^[A-Z]{1,2}-?0\d$/.test(tag);
}

const squash = (s: string) => s.toUpperCase().replace(/[\s#]+/g, '');

export function unlistedTagRejection(tag: string, symbol: string, ctx: UnlistedGuardContext): string | null {
  if (!tag) return 'empty tag';
  if (TAG_MODIFIERS.has(tag)) return 'a modifier (EM / WP / GFI / X / TYP / NL)';
  // Re-check S-new-2 — circuit-shaped tokens are rejected ONLY when (a) a
  // comma list ("A26,28"), (b) the prefix is a known panel name ("A10" on
  // panel A, "LP1-5" on panel LP1), or (c) the sheet reports a circuit
  // SERIES (3+ numbered tags on one letter: A01, A05, A08). Fixture-style
  // tags — F-1, SL-1, HB-1, EX-1, L-2, F12, D10 — are allowed.
  if (/^[A-Z]{1,3}\d{0,2}-?\d{1,3}(?:,\d+)+$/.test(tag)) return 'a circuit list';
  const panelNames = ctx.panels.map(p => p.toUpperCase().replace(/^PANEL(BOARD)?\s+/, '').replace(/\s+/g, '')).filter(Boolean);
  const onPanel = panelNames.find(p => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-?\\d{1,3}$`).test(tag));
  if (onPanel) return `a circuit on panel ${onPanel}`;
  if ((ctx.equipmentTags ?? []).some(e => squash(e) === squash(tag))) return 'an equipment tag';
  if ((ctx.circuits ?? []).some(c => squash(c) === squash(tag))) return 'a panel circuit';
  if (/^\d+[A-Z]?$/.test(tag)) return 'a number (a room number or keyed note)';
  if (/\d{3}/.test(tag)) return 'a three-digit number (a room or door number)';
  if (tag.length > 6 || /\s/.test(tag)) return 'a word (a room name or note)';
  if (!/^[A-Z]{1,3}\d{0,2}[A-Z]?(?:-\d{1,2})?$/.test(tag)) return 'not the shape of a type tag';
  if (ctx.targetKeys.has(tag)) return 'a listed type';
  if ((ctx.statusMarkers ?? []).includes(tag)) return 'a new / existing status marker';
  if (NOT_A_TAG_SYMBOL.test(symbol)) return `described as "${symbol.slice(0, 40)}"`;
  return null;
}

/** Does the symbol description read as a light fixture (vs a device)? */
export function looksLikeFixture(symbol: string): boolean {
  if (/\b(receptacle|outlet|duplex|switch|sensor|detector|j-?box|junction|disconnect|speaker|data|phone|telephone)\b/i.test(symbol)) return false;
  return true;
}

export interface SheetUnlisted {
  sheetKey: string;
  label: string;
  items: Array<{ tag: string; symbol: string; marks: Array<{ x: number; y: number }> }>;
}

/** One entry per tag across every sheet, guarded. */
export function aggregateUnlisted(sheets: SheetUnlisted[], ctx: UnlistedGuardContext): { tags: UnlistedTag[]; rejected: Array<{ tag: string; reason: string }>; possible: UnlistedTag[] } {
  const byTag = new Map<string, UnlistedTag>();
  const possibleBy = new Map<string, UnlistedTag>();
  const rejected: Array<{ tag: string; reason: string }> = [];
  for (const s of sheets) {
    for (const it of s.items) {
      const tag = normalizeUnlistedTag(it.tag);
      let why = unlistedTagRejection(tag, it.symbol, ctx);
      // A circuit-like tag rejected only for how the counter described it
      // ("circuit tag") is still listed in the non-blocking group.
      if (why?.startsWith('described as') && circuitLike(tag)) why = null;
      if (why) { if (!rejected.some(r => r.tag === tag)) rejected.push({ tag, reason: why }); continue; }
      if (!it.marks.length) continue;
      // Final check 1 — circuit-like with no panel evidence: never dropped,
      // never blocking (the non-blocking "possible unlisted tags" group).
      const into = circuitLike(tag) ? possibleBy : byTag;
      const u = into.get(tag) ?? { tag, symbol: it.symbol, total: 0, sheets: [], marks: [] };
      if (!u.symbol && it.symbol) u.symbol = it.symbol;
      u.total += it.marks.length;
      const sh = u.sheets.find(x => x.sheetKey === s.sheetKey);
      if (sh) sh.count += it.marks.length;
      else u.sheets.push({ sheetKey: s.sheetKey, label: s.label, count: it.marks.length });
      u.marks.push(...it.marks.map(m => ({ sheetKey: s.sheetKey, x: m.x, y: m.y })));
      into.set(tag, u);
    }
  }
  const order = (a: UnlistedTag, b: UnlistedTag) => b.total - a.total || a.tag.localeCompare(b.tag);
  return { tags: [...byTag.values()].sort(order), rejected, possible: [...possibleBy.values()].sort(order) };
}

/** The option text that merges an unlisted tag into a listed type. */
export function sameAsOption(type: string): string {
  return `Same as Type ${type}`;
}
