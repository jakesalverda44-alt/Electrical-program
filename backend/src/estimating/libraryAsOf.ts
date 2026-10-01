// Gap-closing T1 — the library AS OF a moment (pure). Saved estimate lines
// store no unit costs (resolveLines reads the library live), so a bid that is
// no longer being estimated — submitted, sold, lost, not a Calibration job —
// prices against the library as it was when it was submitted. Migration 164's
// triggers write the old row to history before every change; this rebuilds
// the library at `ts` from the live rows plus that history:
//   * an item / assembly created after `ts` is dropped (unless the bid's own
//     saved lines reference it — they were saved later, on purpose);
//   * an item's values (hours, $, price date, aliases, active, name, unit) come
//     from the EARLIEST history row with valid_until > ts — the values in force
//     at ts — else the live row;
//   * a deleted item / assembly is rebuilt from its history;
//   * an assembly's components are the live ones that existed at ts plus the
//     history rows that were part of it at ts.
import type { Library, LibraryItem, LibraryAssembly, AssemblyComponent } from './library';

export interface ItemHistoryRow {
  item_id: string; code: string; name: string; category: string; unit: string;
  material_cost: number; material_price_date: string | null; labor_hours: number; aliases: string[];
  source: string; active: boolean; item_created_at: string | null; valid_until: string; deleted?: boolean;
}
export interface AssemblyHistoryRow {
  assembly_id: string; code: string; name: string; category: string; unit: string; aliases: string[];
  source: string; active: boolean; assembly_created_at: string | null; valid_until: string; deleted?: boolean;
}
export interface ComponentHistoryRow { assembly_id: string; item_id: string; qty_per: number; valid_from: string | null; valid_until: string }
export interface LibraryHistory { items: ItemHistoryRow[]; assemblies: AssemblyHistoryRow[]; components: ComponentHistoryRow[] }

const t = (v: string | Date | null | undefined): number => (v == null ? -Infinity : new Date(v).getTime());

function earliestAfter<T extends { valid_until: string }>(rows: T[], ts: number): T | null {
  let best: T | null = null;
  for (const r of rows) if (t(r.valid_until) > ts && (!best || t(r.valid_until) < t(best.valid_until))) best = r;
  return best;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const l = m.get(k) ?? []; l.push(r); m.set(k, l); }
  return m;
}

export function libraryAsOf(lib: Library, history: LibraryHistory, at: string | Date, opts: { keepIds?: Set<string> } = {}): Library {
  const ts = t(at);
  const keep = opts.keepIds ?? new Set<string>();
  const itemHist = groupBy(history.items, r => r.item_id);
  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const i of lib.items) {
    seen.add(i.id);
    const h = earliestAfter(itemHist.get(i.id) ?? [], ts);
    const createdAt = h?.item_created_at ?? i.created_at ?? null;
    if (t(createdAt) > ts && !keep.has(i.id)) continue;
    items.push(h ? {
      ...i, code: h.code, name: h.name, category: h.category, unit: h.unit as LibraryItem['unit'],
      material_cost: Number(h.material_cost), material_price_date: h.material_price_date, labor_hours: Number(h.labor_hours),
      aliases: [...(h.aliases ?? [])], active: h.active,
    } : { ...i, aliases: [...(i.aliases ?? [])] });
  }
  // Deleted items: rebuilt from their history when they existed at ts.
  for (const [id, rows] of itemHist) {
    if (seen.has(id)) continue;
    const h = earliestAfter(rows, ts);
    if (!h || t(h.item_created_at) > ts) continue;
    items.push({ id, code: h.code, name: h.name, category: h.category, unit: h.unit as LibraryItem['unit'], material_cost: Number(h.material_cost),
      material_price_date: h.material_price_date, labor_hours: Number(h.labor_hours), aliases: [...(h.aliases ?? [])], source: h.source, active: h.active,
      created_at: h.item_created_at });
  }
  const itemById = new Map(items.map(i => [i.id, i]));

  const asmHist = groupBy(history.assemblies, r => r.assembly_id);
  const compHist = groupBy(history.components, r => r.assembly_id);
  const componentsAt = (asmId: string, live: AssemblyComponent[]): AssemblyComponent[] => {
    const out: AssemblyComponent[] = [];
    for (const c of live) if (t(c.created_at) <= ts) out.push({ ...c });
    for (const h of compHist.get(asmId) ?? []) {
      if (!(t(h.valid_from) <= ts && t(h.valid_until) > ts)) continue;
      out.push({ item_id: h.item_id, item_code: itemById.get(h.item_id)?.code ?? '', item_name: itemById.get(h.item_id)?.name ?? '', qty_per: Number(h.qty_per), created_at: h.valid_from });
    }
    // An item a component points at that did not exist at ts cannot price it.
    return out.filter(c => itemById.has(c.item_id)).map(c => ({ ...c, item_code: itemById.get(c.item_id)!.code, item_name: itemById.get(c.item_id)!.name }));
  };
  const assemblies: LibraryAssembly[] = [];
  const seenA = new Set<string>();
  for (const a of lib.assemblies) {
    seenA.add(a.id);
    const h = earliestAfter(asmHist.get(a.id) ?? [], ts);
    const createdAt = h?.assembly_created_at ?? a.created_at ?? null;
    if (t(createdAt) > ts && !keep.has(a.id)) continue;
    const base = h ? { ...a, code: h.code, name: h.name, category: h.category, unit: h.unit as LibraryAssembly['unit'], aliases: [...h.aliases], active: h.active } : { ...a, aliases: [...a.aliases] };
    assemblies.push({ ...base, components: keep.has(a.id) && t(createdAt) > ts ? a.components.map(c => ({ ...c })) : componentsAt(a.id, a.components) });
  }
  for (const [id, rows] of asmHist) {
    if (seenA.has(id)) continue;
    const h = earliestAfter(rows, ts);
    if (!h || t(h.assembly_created_at) > ts) continue;
    assemblies.push({ id, code: h.code, name: h.name, category: h.category, unit: h.unit as LibraryAssembly['unit'], aliases: [...h.aliases], source: h.source, active: h.active,
      created_at: h.assembly_created_at, components: componentsAt(id, []) });
  }
  return { items, assemblies, factors: lib.factors.map(f => ({ ...f })) };
}
