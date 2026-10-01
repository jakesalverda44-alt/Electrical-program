// Fewer-questions round Task 2 — a quantity a notes / schedule /
// equipment-list row STATES in words, for the zero-count checklist's
// proposals. Pure and strict: a proposal is never counted until the
// estimator confirms it, but a false one still costs a careful read, so
// anything that looks like a conductor set, a circuit list, a model count or
// a size never matches.
//
// Matches:
//   * "(N)" before a noun, opening the row  "(3) Ceiling fans", "(5) Battery chargers"
//     (never mid-row: "enclosure …, (6) contactors" counts a PART of the item)
//   * a trailing "(N)"               "… above electric panels (2)"
//   * "#1 and #2" / "#1, #2 and #3" / "#1-#6" after a plural noun
//   * two … twelve before a plural noun, opening the row ("three exhaust
//     fans"; never "light with two heads")
// Never:
//   * "(2)4#3/0" — a number followed by #, ", /, A, P, kcmil, W, VA, gal …
//   * circuit lists ("ckt", "A-18", "B-1,3,5") or "1 and 2 circuit models"
//   * sizes ("12x12"), "3-way"
// Two different quantities → a conflict (no proposal).

export type StatedQuantity = { qty: number; quote: string } | { conflict: string[] } | null;

const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/** Never a counted noun after a number: wiring, ratings, circuits, models. */
const NOT_A_NOUN = /^(?:#|"|\/|x\b|a\b|amps?\b|p\b|poles?\b|kcmil\b|w\b|watts?\b|va\b|kva\b|gal\b|gallons?\b|ph\b|phase\b|wires?\b|conductors?\b|circuits?\b|ckts?\b|models?\b|ton\b|tons\b|hp\b|v\b|volts?\b|ft\b|feet\b|in\b|inch\b|gang\b|way\b|-)/i;
const NOT_A_PLURAL = /^(?:circuits|ckts|models|amps|watts|volts|poles|wires|conductors|phases|tons|gallons|feet|inches|gangs|ways)$/i;

function nextToken(s: string): string {
  return s.replace(/^\s+/, '');
}

export function statedQuantity(text: string): StatedQuantity {
  const s = String(text ?? '');
  const found: Array<{ qty: number; quote: string }> = [];
  // (N) before a noun
  for (const m of s.matchAll(/\((\d{1,3})\)/g)) {
    const after = s.slice((m.index ?? 0) + m[0].length);
    const n = Number(m[1]);
    if (!(n >= 1)) continue;
    if (/^\s*\.?\s*$/.test(after)) { found.push({ qty: n, quote: s.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + m[0].length).trim() }); continue; }
    // Only when it opens the row: a mid-row "(6) contactors" is a part of the item.
    if (s.slice(0, m.index ?? 0).trim() !== '') continue;
    const t = nextToken(after);
    if (!/^[A-Za-z]/.test(t) || NOT_A_NOUN.test(t)) continue;
    // "(2) 1 and 2 circuit" etc. never; a word follows directly.
    const noun = /^([A-Za-z][A-Za-z-]*)/.exec(t)?.[1] ?? '';
    if (NOT_A_PLURAL.test(noun)) continue;
    found.push({ qty: n, quote: `${m[0]} ${t.split(/[,;(]/)[0].trim()}`.slice(0, 80) });
  }
  // #1 and #2 / #1, #2 and #3 / #1-#6 after a plural noun
  for (const m of s.matchAll(/\b([A-Za-z]{3,}s)\s+#(\d{1,2})((?:\s*,\s*#\d{1,2})*)\s*(?:and|&)\s*#(\d{1,2})\b/gi)) {
    if (NOT_A_PLURAL.test(m[1])) continue;
    const nums = [m[2], ...(m[3].match(/\d+/g) ?? []), m[4]].map(Number);
    if (new Set(nums).size !== nums.length) continue;
    found.push({ qty: nums.length, quote: m[0] });
  }
  for (const m of s.matchAll(/\b([A-Za-z]{3,}s)\s+#(\d{1,2})\s*-\s*#(\d{1,2})\b/gi)) {
    if (NOT_A_PLURAL.test(m[1])) continue;
    const a = Number(m[2]), b = Number(m[3]);
    if (b > a && b - a < 50) found.push({ qty: b - a + 1, quote: m[0] });
  }
  // number words before a plural noun
  for (const m of s.matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+((?:[A-Za-z]+\s+){0,2}?[A-Za-z]{3,}s)\b/gi)) {
    const words = m[2].split(/\s+/);
    if (words.some(w => NOT_A_PLURAL.test(w)) || /-$/.test(m[1])) continue;
    if (/^(?:way|gang|pole|phase|wire|circuit)/i.test(words[0])) continue;
    // Only when it opens the row: "light with two heads" counts a part.
    if (s.slice(0, m.index ?? 0).trim() !== '') continue;
    found.push({ qty: WORDS[m[1].toLowerCase()], quote: m[0] });
  }
  if (!found.length) return null;
  const qtys = [...new Set(found.map(f => f.qty))];
  if (qtys.length > 1) return { conflict: found.map(f => `${f.qty} ("${f.quote}")`) };
  const quotes = [...new Set(found.map(f => f.quote))];
  return { qty: qtys[0], quote: quotes.filter(q => !quotes.some(o => o !== q && o.includes(q))).join('" … "') };
}

/** A tag that names ONE unit ("AHU #2", "RTU-1", "EF 3"); never a range
 *  ("CF1-CF3", "PP-1..6") or a list. */
export function namedUnitTag(tag: string): boolean {
  const t = String(tag ?? '').trim().toUpperCase();
  if (/\.\.|,|\/|&|\bTHRU\b/.test(t)) return false;
  if (/^[A-Z]+\d*\s*-\s*[A-Z]+\d+$/.test(t)) return false; // CF1-CF3
  return /^[A-Z][A-Z ]{0,10}?\s*#\s*\d{1,3}$/.test(t) || /^[A-Z]{2,6}-\d{1,3}$/.test(t);
}
