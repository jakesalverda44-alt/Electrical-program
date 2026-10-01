// Accuracy round D0 — every one of the 41 lines the live Kissimmee proposal
// priced at a silent $0 (the baseline's held list, live@submitted), with the
// reason it reached the mapper with no unit (before), and what it is now
// (after: priced, a classified note, or a visible hold with its reason).
// "After" = the same export through the current code, 'due' assumed, no
// pins / locate (automatic). Real input only.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing } from '../eval/replayEval';
import { loadKissimmeeLive0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

const live = loadKissimmeeLive0930();
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/replay-baseline-2026-09-30.json'), 'utf8'));
const before: Array<{ category: string; description: string; qty: number; unit: string; matched: string | null }> = baseline.jobs.kissimmee.scenarios['live@submitted'].heldLines;

/** D0's "before" class: why the line reached the mapper with no unit. */
function d0Class(l: { category: string; description: string; unit: string; matched: string | null }, item: string): string {
  const t = `${item} ${l.description}`;
  if (!/^(EA|LF|C|M)$/.test(l.unit)) return 'unit_unknown';
  if (/^Feeder\b|->|service conductors/i.test(t)) return 'feeder_run';
  if (/circuits? per|20\/1|^\s*\d+ RTU-1;/i.test(t) || /^Branch circuit/i.test(item)) return 'circuit_list';
  if (l.matched) return 'held_fuzzy';
  if (/disconnect/i.test(t)) return 'disconnect_no_size';
  if (/\(connection\)|connection$|rooftop unit|\bckt\b/i.test(t)) return 'equip_no_unit';
  if (/^\s*(?:circuit\s+)?[A-Z]-?\d|^ckts?\b/i.test(l.description)) return 'circuit_ref';
  if (/simplex|exhaust fan|power pole|pvc data|ceiling fan|site pole|pole/i.test(t)) return 'no_unit';
  return 'scope_note';
}

describe('D0 — the 41 silent $0 lines of the live Kissimmee proposal', () => {
  it('every one is now priced, a classified note, or a visible hold with its reason', async () => {
    const after = await replayPricing(live, loadLiveLibrary0930(), { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: textSheets0930() } });
    const liveLines = live.liveProposal.lines as Array<{ takeoff_key: string; category: string; description: string; qty: number }>;
    const used = new Set<number>();
    const rows = before.map(b => {
      const i = liveLines.findIndex((l, k) => !used.has(k) && l.category === b.category && l.description === b.description && Number(l.qty) === b.qty);
      used.add(i);
      const key = liveLines[i]?.takeoff_key ?? null;
      const item = key ? key.split('||')[1].replace(/::\d+$/, '') : '';
      const a = after.lineDetail!.find(x => x.key === key);
      const now = !a ? 'gone' : a.note ? `note:${a.note}` : a.hold ? `hold:${a.hold}` : a.hours > 0 || a.material > 0 ? `priced ${a.hours.toFixed(2)} h` : 'zero?';
      return { item: item.slice(0, 48), before: d0Class(b, item), now };
    });
    // eslint-disable-next-line no-console
    console.log(`[D0]\n${rows.map((r, i) => `${String(i + 1).padStart(2)} ${r.before.padEnd(19)} → ${r.now.padEnd(28)} ${r.item}`).join('\n')}`);
    expect(rows.length).toBe(41);
    expect(rows.every(r => /^(priced|note:|hold:)/.test(r.now))).toBe(true);
    const holds = rows.filter(r => r.now.startsWith('hold:')).length;
    const notes = rows.filter(r => r.now.startsWith('note:')).length;
    const priced = rows.filter(r => r.now.startsWith('priced')).length;
    expect({ priced, notes, holds }).toEqual(PIN);
  });
});

// 41 → 17 priced (Chris's units), 8 classified notes, 16 visible holds. (Fix round S1: the lighting contactors are a
// lighting-controls device again — a held fuzzy match to the relay panel — not 6 sign terminations.)
const PIN = { priced: 17, notes: 8, holds: 16 };
