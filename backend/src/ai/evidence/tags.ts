// Real-run fix 2 / review fixes B3, S3 — equipment tag tokens. Pure; shared by
// the consolidation (consolidate.ts) and the schedule parser (schedules.ts).
import { normalizeTypeKey } from '../countTargets';

export interface TagInfo {
  /** "RTU-1" -> RTU; "PP#4" -> PP; "DISCON A" / "EF-A" -> DISCON / EF; "SIGN" -> SIGN. */
  base: string;
  /** "1", "4", "A", "1A" — null for an un-numbered tag. */
  num: string | null;
  /** A combined tag's members, as target keys: "RTU-1/RTU-2", "RTU-1/2/3",
   *  "RTU-1 & 2", "PANEL A/B". */
  members: string[] | null;
  /** A tag range legend ("POWER POLE TAG 1-6"). */
  range: [number, number] | null;
}

/** One numbered tag: base, the separator as written, and the suffix. Review
 *  fix B3 — a letter suffix is a number too: "EF-A", "WH-A", "DISCON-A",
 *  "EF A", "DISCON A", "P-1A". */
function numberedOf(tag: string): { base: string; sep: string; num: string } | null {
  const m = /^([A-Z]{1,8})(\s*[-#]?\s*)(\d{1,3}[A-Z]?)$/.exec(tag)
    ?? /^([A-Z]{1,8})(\s*[-#]\s*)([A-Z])$/.exec(tag)
    ?? /^([A-Z]{2,}(?: [A-Z]{2,})*)( )([A-Z])$/.exec(tag);
  return m ? { base: m[1].trim(), sep: m[2].replace(/\s+/g, '') || (m[2].includes(' ') ? ' ' : ''), num: m[3] } : null;
}

export function tagInfoOf(tagRaw: string): TagInfo {
  const tag = normalizeTypeKey(tagRaw);
  // Combined: the first part a numbered tag, every other part the same base
  // with another suffix, or a bare suffix ("RTU-1/2/3", "PANEL A/B").
  const parts = tag.split(/\s*(?:\/|,|&|\bAND\b|\+)\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const first = numberedOf(parts[0]);
    if (first) {
      const members: string[] = [`${first.base}${first.sep}${first.num}`];
      let ok = true;
      for (const p of parts.slice(1)) {
        const n = numberedOf(p);
        if (n && n.base === first.base) members.push(`${n.base}${first.sep}${n.num}`);
        else if (/^(\d{1,3}[A-Z]?|[A-Z])$/.test(p)) members.push(`${first.base}${first.sep}${p}`);
        else { ok = false; break; }
      }
      if (ok) return { base: first.base, num: null, members: [...new Set(members.map(normalizeTypeKey))], range: null };
    }
  }
  const range = /^([A-Z][A-Z #]*?)\s*#?\s*(\d{1,2})\s*-\s*(\d{1,2})$/.exec(tag);
  if (range && Number(range[3]) > Number(range[2])) return { base: range[1].replace(/#/g, '').trim(), num: null, members: null, range: [Number(range[2]), Number(range[3])] };
  const n = numberedOf(tag);
  if (n) return { base: n.base, num: n.num, members: null, range: null };
  return { base: tag, num: null, members: null, range: null };
}
