// Gap-closing T1 — the library as of a moment (pure) + the call-site guard.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { libraryAsOf, type LibraryHistory } from './libraryAsOf';
import type { Library } from './library';

const item = (id: string, over: Record<string, unknown> = {}) => ({ id, code: id.toUpperCase(), name: `Item ${id}`, category: 'Branch Power', unit: 'EA', material_cost: 10, material_price_date: null, labor_hours: 1, aliases: [], source: 'seed', active: true, created_at: '2026-01-01T00:00:00.000Z', ...over }) as Library['items'][number];
const lib = (items: Library['items'], assemblies: Library['assemblies'] = []): Library => ({ items, assemblies, factors: [] });
const noHist: LibraryHistory = { items: [], assemblies: [], components: [] };
const histRow = (id: string, over: Record<string, unknown>) => ({ item_id: id, code: id.toUpperCase(), name: `Item ${id}`, category: 'Branch Power', unit: 'EA', material_cost: 10, material_price_date: null, labor_hours: 1, aliases: [], source: 'seed', active: true, item_created_at: '2026-01-01T00:00:00.000Z', valid_until: '2026-10-01T00:00:00.000Z', ...over });

describe('libraryAsOf', () => {
  it('an item created after the moment is dropped (unless the bid keeps it); one created before stays', () => {
    const l = lib([item('a'), item('b', { created_at: '2026-10-02T00:00:00.000Z' })]);
    expect(libraryAsOf(l, noHist, '2026-09-01').items.map(i => i.id)).toEqual(['a']);
    expect(libraryAsOf(l, noHist, '2026-09-01', { keepIds: new Set(['b']) }).items.map(i => i.id)).toEqual(['a', 'b']);
    expect(libraryAsOf(l, noHist, '2026-10-03').items.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('values come from the earliest history row after the moment (aliases included); later moments see the live row', () => {
    const l = lib([item('a', { labor_hours: 3, material_cost: 30, aliases: ['new alias'] })]);
    const h: LibraryHistory = { ...noHist, items: [
      histRow('a', { labor_hours: 1, material_cost: 10, aliases: ['old'], valid_until: '2026-10-01T00:00:00.000Z' }),
      histRow('a', { labor_hours: 2, material_cost: 20, aliases: ['mid'], valid_until: '2026-10-05T00:00:00.000Z' }),
    ] };
    const at = (ts: string) => libraryAsOf(l, h, ts).items[0];
    expect([at('2026-09-01').labor_hours, at('2026-09-01').material_cost, at('2026-09-01').aliases]).toEqual([1, 10, ['old']]);
    expect(at('2026-10-02').labor_hours).toBe(2);
    expect(at('2026-10-06').labor_hours).toBe(3);
  });

  it('a deleted item is rebuilt from its history', () => {
    const h: LibraryHistory = { ...noHist, items: [histRow('gone', { labor_hours: 4, deleted: true })] };
    expect(libraryAsOf(lib([]), h, '2026-09-01').items.map(i => [i.id, i.labor_hours])).toEqual([['gone', 4]]);
    expect(libraryAsOf(lib([]), h, '2026-10-02').items).toEqual([]);
  });

  it('assembly components as of the moment: a component re-pointed later prices the old item', () => {
    const asm = { id: 'asm', code: 'ASM', name: 'Asm', category: 'Branch Power', unit: 'EA', aliases: [], source: 'seed', active: true, created_at: '2026-01-01T00:00:00.000Z',
      components: [{ item_id: 'new', item_code: 'NEW', item_name: 'Item new', qty_per: 1, created_at: '2026-10-01T00:00:00.000Z' }] } as Library['assemblies'][number];
    const l = lib([item('old'), item('new', { created_at: '2026-09-15T00:00:00.000Z' })], [asm]);
    const h: LibraryHistory = { ...noHist, components: [{ assembly_id: 'asm', item_id: 'old', qty_per: 1, valid_from: '1970-01-01T00:00:00.000Z', valid_until: '2026-10-01T00:00:00.000Z' }] };
    expect(libraryAsOf(l, h, '2026-09-01').assemblies[0].components.map(c => c.item_code)).toEqual(['OLD']);
    expect(libraryAsOf(l, h, '2026-10-02').assemblies[0].components.map(c => c.item_code)).toEqual(['NEW']);
  });
});

describe('the library a bid prices against goes through getLibraryForBid', () => {
  it('getLibrary() is called only by library.ts (getLibraryAsOf) and the library admin routes', () => {
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { if (f.name !== 'test' && f.name !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(f.name) || /\.test\.ts$/.test(f.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => { if (/\bgetLibrary\(\)/.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}`); });
      }
    };
    walk(root);
    const allowed = hits.filter(h => !/^estimating\/library\.ts:/.test(h) && !/^routes\/estimating\.ts:/.test(h));
    expect(allowed).toEqual([]);
    // The route hits are the library admin endpoints (GET /library, the Accubid import), never a bid's price.
    const routeSrc = fs.readFileSync(path.join(root, 'routes/estimating.ts'), 'utf8').split('\n');
    for (const h of hits.filter(x => x.startsWith('routes/'))) {
      const n = Number(h.split(':')[1]);
      const owner = routeSrc.slice(0, n).reverse().find(l => /^router\.(get|post|put|patch|delete)\(/.test(l)) ?? '';
      expect(owner, h).toMatch(/^router\.(get|post)\('\/library/);
    }
  });
});
