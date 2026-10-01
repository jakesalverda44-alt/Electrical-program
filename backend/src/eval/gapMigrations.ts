// Gap-closing — the replay's mirror of migrations 165–167 (the library changes of the round), applied the way
// the SQL applies them: inserts never overwrite an existing code; a unit / price move touches only an
// untouched seed row (source = 'seed', not Accubid-reconciled — the export has no accubid_reconciled_at, so
// source = 'seed' is the test; the live rows that were reconciled are listed in the report). Migration 164's
// trigger writes the old row to history first; `history` here is that row, valid until GAP_MIGRATION_AT, so the
// replay of a bid that is NOT being estimated prices against libraryAsOf(after, history, its submission).
import type { Library } from '../estimating/library';
import type { LibraryHistory } from '../estimating/libraryAsOf';
import { SEED_ITEMS, SEED_ASSEMBLIES, GAP_CLOSING_ITEMS } from '../estimating/seed/laborUnits';

/** When the replay assumes 165–167 ran (after both exports, 2026-09-30). */
export const GAP_MIGRATION_AT = '2026-10-01T12:00:00.000Z';

/** 165 — insert-only items / assemblies, by code (their values are the seed's: seedUnitsVsChris checks them). */
export const GAP_INSERT_CODES: string[] = GAP_CLOSING_ITEMS.map(i => i.code);
/** 166 — approved labor-unit moves (Jake: J5–J8, J10 + the five carried from the accuracy round). */
export const GAP_UNIT_MOVES: Array<{ code: string; from: number; to: number; why: string }> = [
  { code: 'THHN-3_0', from: 16.5, to: 18.8, why: 'J5 — kissimmee: #3/0 Black Wire THHN 872 M × 18.8 h/M' },
  { code: 'THHN-6', from: 7.0, to: 8.9, why: 'J5 — kissimmee: #6 Black / Green Wire THHN 8.9 h/M' },
  { code: 'PNL-225', from: 8.0, to: 3.6, why: 'J6 — kissimmee: 225A 42-Circuit Panelboard MLO Surface Mount 3.6 h (flush = PNL-225F 4.5 h, migration 165)' },
  { code: 'LTG-STRIP4', from: 0.65, to: 0.75, why: "J7 — kissimmee: 4' Luminaire Linear Wraparound 0.75 h" },
  { code: 'LTG-DOWN', from: 0.6, to: 0.9, why: 'J7 — kissimmee: 5" Luminaire Recessed Downlight 0.9 h' },
  { code: 'LTG-EXIT', from: 0.6, to: 0.55, why: 'J7 — kissimmee / 36th: Exit Light Single Face Surface Mount 0.55 h' },
  { code: 'LTG-TROF24', from: 0.75, to: 0.7, why: 'J7 — 36th: 2x4 recessed troffer 0.7 h' },
  { code: 'LTG-TROF22', from: 0.7, to: 0.6, why: 'J7 — 36th: 2x2 troffer 0.6 h' },
  { code: 'DEV-DUP', from: 0.35, to: 0.23, why: 'J8 — kissimmee: Duplex Receptacle 20 h/C + Duplex Receptacle Wallplate 3 h/C' },
  { code: 'DEV-GFCI', from: 0.4, to: 0.28, why: 'J8 — kissimmee: GFCI Duplex Receptacle 25 h/C + Decorator Wallplate 3 h/C' },
  { code: 'SW-1P', from: 0.3, to: 0.21, why: 'J8 — 36th: 20A Toggle Switch Single Pole 18 h/C + Toggle Switch Wallplate 3 h/C' },
  { code: 'SW-3W', from: 0.35, to: 0.27, why: 'J8 — orlando-clubhouse: 20A Toggle Switch Three Way 24 h/C + Toggle Switch Wallplate 3 h/C' },
  { code: 'MC-1202', from: 2.5, to: 1.52, why: 'J10 — kissimmee / 36th: #12/2C MC Cable 15.2 h/M = 1.52 h/C' },
  { code: 'DISC-30', from: 1.5, to: 1.1, why: 'decision 1 (accuracy round) — Chris 30A safety switch 1.10 h' },
  { code: 'DISC-60', from: 2.0, to: 1.55, why: 'decision 1 — kissimmee: 60A Safety Switch NF 3R 1.55 h' },
  { code: 'DISC-200', from: 4.5, to: 3.1, why: 'decision 1 — kissimmee: 200A Safety Switch Fusible 3.1 h' },
  { code: 'LTG-POLE', from: 4.5, to: 4.8, why: "decision 1 — kissimmee: 20' Pole Round Steel 4.8 h" },
  { code: 'LTG-POLEHEAD', from: 1.2, to: 2.2, why: 'decision 1 — kissimmee: Luminaire Pole Top/Arm Mount up to 250W 2.2 h' },
  { code: 'LC-CONTACTOR', from: 2.0, to: 1.0, why: "review S1 — kissimmee: Lighting Contactor 1 E, 6.0 h = Chris's lump for the 6-contactor enclosure -> 1.0 h per contactor (confirm)" },
];
/** 167 — approved price refresh (J11: Chris's Kissimmee BOM net, 6/18/2026). */
export const GAP_PRICE_MOVES: Array<{ code: string; to: number; date: string; why: string }> = [
  { code: 'THHN-12', to: 208.0, date: '2026-06-18', why: 'kissimmee: #12 Black Wire THHN net $208.00/M' },
  { code: 'THHN-10', to: 329.7, date: '2026-06-18', why: 'kissimmee: #10 Black Wire THHN net $329.70/M' },
  { code: 'THHN-6', to: 895.5, date: '2026-06-18', why: 'kissimmee: #6 Black Wire THHN net $895.50/M' },
  { code: 'THHN-3_0', to: 4735.0, date: '2026-06-18', why: 'kissimmee: #3/0 Black Wire THHN net $4,735.00/M' },
  { code: 'EMT-075', to: 92.38, date: '2026-06-18', why: 'kissimmee: 3/4" Conduit - EMT net $92.38/C' },
  { code: 'EMT-100', to: 157.82, date: '2026-06-18', why: 'kissimmee: 1" Conduit - EMT net $157.82/C' },
  { code: 'PVC-100', to: 51.82, date: '2026-06-18', why: 'kissimmee: 1" Conduit - PVC 40 net $51.82/C' },
  { code: 'PVC-200', to: 105.68, date: '2026-06-18', why: 'kissimmee: 2" Conduit - PVC 40 net $105.68/C' },
  { code: 'MC-1202', to: 74.52, date: '2026-06-18', why: 'kissimmee: #12/2C MC Cable net $745.20/M = $74.52/C' },
  { code: 'LC-CONTACTOR', to: 133.33, date: '2026-06-18', why: "review S1 — kissimmee: Lighting Contactor 1 E net $800.00 = Chris's lump for the 6-contactor enclosure -> $133.33 per contactor (confirm)" },
];

export function applyGapMigrations(lib: Library): { library: Library; history: LibraryHistory } {
  const items = lib.items.map(i => ({ ...i, aliases: [...(i.aliases ?? [])] }));
  const byCode = new Map(items.map(i => [i.code, i]));
  const history: LibraryHistory = { items: [], assemblies: [], components: [] };
  const snapshot = (i: Library['items'][number]) => history.items.push({
    item_id: i.id, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.material_cost, material_price_date: i.material_price_date,
    labor_hours: i.labor_hours, aliases: [...(i.aliases ?? [])], source: i.source, active: i.active, item_created_at: i.created_at ?? null, valid_until: GAP_MIGRATION_AT,
  });
  for (const code of GAP_INSERT_CODES) {
    if (byCode.has(code)) continue;
    const s = SEED_ITEMS.find(x => x.code === code);
    if (!s) continue;
    const it = { id: `mig165-${code}`, code, name: s.name, category: s.category, unit: s.unit, material_cost: s.materialCost, material_price_date: null, labor_hours: s.laborHours,
      aliases: [...s.aliases], source: 'seed', active: true, created_at: GAP_MIGRATION_AT } as unknown as Library['items'][number];
    items.push(it); byCode.set(code, it);
  }
  const assemblies = lib.assemblies.map(a => ({ ...a, components: a.components.map(c => ({ ...c })) }));
  for (const code of GAP_INSERT_CODES) {
    const a = SEED_ASSEMBLIES.find(x => x.code === code);
    if (!a || assemblies.some(y => y.code === code)) continue;
    assemblies.push({ id: `mig165-${code}`, code, name: a.name, category: a.category, unit: a.unit as never, aliases: [...a.aliases], source: 'seed', active: true, created_at: GAP_MIGRATION_AT,
      components: a.components.map(c => ({ item_id: byCode.get(c.itemCode)!.id, item_code: c.itemCode, item_name: byCode.get(c.itemCode)!.name, qty_per: c.qtyPer, created_at: GAP_MIGRATION_AT })) });
  }
  const moved = new Set<string>();
  for (const m of GAP_UNIT_MOVES) {
    const it = byCode.get(m.code);
    if (!it || it.source !== 'seed' || it.labor_hours === m.to) continue;
    if (!moved.has(it.id)) { snapshot(it); moved.add(it.id); }
    it.labor_hours = m.to;
  }
  for (const m of GAP_PRICE_MOVES) {
    const it = byCode.get(m.code);
    if (!it || it.source !== 'seed' || (it.material_cost === m.to && it.material_price_date === m.date)) continue;
    if (!moved.has(it.id)) { snapshot(it); moved.add(it.id); }
    it.material_cost = m.to; it.material_price_date = m.date;
  }
  return { library: { ...lib, items, assemblies }, history };
}
