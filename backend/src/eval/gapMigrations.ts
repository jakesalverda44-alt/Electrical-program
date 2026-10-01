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
export const GAP_UNIT_MOVES: Array<{ code: string; from: number; to: number; why: string }> = [];
/** 167 — approved price refresh (J11: Chris's Kissimmee BOM net, 6/18/2026). */
export const GAP_PRICE_MOVES: Array<{ code: string; to: number; date: string; why: string }> = [];

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
