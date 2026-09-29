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
export function unlistedTagRejection(tag: string, symbol: string, ctx: { panels: string[]; targetKeys: Set<string>; statusMarkers?: string[] }): string | null {
  if (!tag) return 'empty tag';
  if (/^\d+[A-Z]?$/.test(tag)) return 'a number (a room number or keyed note)';
  if (/\d{3}/.test(tag)) return 'a three-digit number (a room or door number)';
  if (tag.length > 6 || /\s/.test(tag)) return 'a word (a room name or note)';
  if (!/^[A-Z]{1,3}\d{0,2}[A-Z]?(?:-\d{1,2})?$/.test(tag)) return 'not the shape of a type tag';
  // Circuits: "A01", "A-5", or a panel's name followed by a number.
  if (/^[A-Z]{1,2}-?0\d$/.test(tag) || /^[A-Z]{1,2}-\d{1,2}$/.test(tag)) return 'a circuit number';
  const m = /^([A-Z]{1,3})-?(\d{1,2})$/.exec(tag);
  if (m && ctx.panels.map(p => p.toUpperCase().replace(/^PANEL\s+/, '')).includes(m[1])) return `a circuit on panel ${m[1]}`;
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
export function aggregateUnlisted(sheets: SheetUnlisted[], ctx: { panels: string[]; targetKeys: Set<string>; statusMarkers?: string[] }): { tags: UnlistedTag[]; rejected: Array<{ tag: string; reason: string }> } {
  const byTag = new Map<string, UnlistedTag>();
  const rejected: Array<{ tag: string; reason: string }> = [];
  for (const s of sheets) {
    for (const it of s.items) {
      const tag = normalizeUnlistedTag(it.tag);
      const why = unlistedTagRejection(tag, it.symbol, ctx);
      if (why) { if (!rejected.some(r => r.tag === tag)) rejected.push({ tag, reason: why }); continue; }
      if (!it.marks.length) continue;
      const u = byTag.get(tag) ?? { tag, symbol: it.symbol, total: 0, sheets: [], marks: [] };
      if (!u.symbol && it.symbol) u.symbol = it.symbol;
      u.total += it.marks.length;
      const sh = u.sheets.find(x => x.sheetKey === s.sheetKey);
      if (sh) sh.count += it.marks.length;
      else u.sheets.push({ sheetKey: s.sheetKey, label: s.label, count: it.marks.length });
      u.marks.push(...it.marks.map(m => ({ sheetKey: s.sheetKey, x: m.x, y: m.y })));
      byTag.set(tag, u);
    }
  }
  return { tags: [...byTag.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag)), rejected };
}

/** The option text that merges an unlisted tag into a listed type. */
export function sameAsOption(type: string): string {
  return `Same as Type ${type}`;
}
