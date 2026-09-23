// Estimating labor engine — Task 5: DB access for the est_* library tables
// (items, assemblies + their components, labor factors). Everything here is
// I/O; the pure matching/pricing logic lives in mapper.ts / pricing.ts.
import { pool } from '../db/pool';
import { EstUnit } from './pricing';

export interface LibraryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  material_cost: number;
  material_price_date: string | null;
  labor_hours: number;
  aliases: string[];
  source: string;
  active: boolean;
}

export interface AssemblyComponent {
  item_id: string;
  item_code: string;
  item_name: string;
  qty_per: number;
}

export interface LibraryAssembly {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  aliases: string[];
  source: string;
  active: boolean;
  components: AssemblyComponent[];
}

export interface LibraryFactor {
  id: string;
  code: string;
  label: string;
  pct: number;
  group_key: string;
  active: boolean;
}

export interface Library {
  items: LibraryItem[];
  assemblies: LibraryAssembly[];
  factors: LibraryFactor[];
}

function toItem(row: Record<string, unknown>): LibraryItem {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    category: row.category as string,
    unit: row.unit as EstUnit,
    material_cost: Number(row.material_cost),
    material_price_date: (row.material_price_date as string | null) ?? null,
    labor_hours: Number(row.labor_hours),
    aliases: (row.aliases as string[]) ?? [],
    source: row.source as string,
    active: row.active as boolean,
  };
}

function toFactor(row: Record<string, unknown>): LibraryFactor {
  return {
    id: row.id as string,
    code: row.code as string,
    label: row.label as string,
    pct: Number(row.pct),
    group_key: row.group_key as string,
    active: row.active as boolean,
  };
}

/** The full library — every item/assembly/factor, active or not, so the admin
 *  UI (Task 11) can show and toggle deactivated rows. Callers resolving a
 *  bid's lines (bidEstimate.ts) filter to `active` themselves. */
export async function getLibrary(): Promise<Library> {
  const [{ rows: itemRows }, { rows: assemblyRows }, { rows: componentRows }, { rows: factorRows }] = await Promise.all([
    pool.query('SELECT * FROM est_items ORDER BY category, name'),
    pool.query('SELECT * FROM est_assemblies ORDER BY category, name'),
    pool.query(`
      SELECT ac.assembly_id, ac.item_id, ac.qty_per, i.code AS item_code, i.name AS item_name
      FROM est_assembly_components ac
      JOIN est_items i ON i.id = ac.item_id
    `),
    pool.query('SELECT * FROM est_labor_factors ORDER BY group_key, label'),
  ]);

  const componentsByAssembly = new Map<string, AssemblyComponent[]>();
  for (const c of componentRows) {
    const list = componentsByAssembly.get(c.assembly_id as string) ?? [];
    list.push({
      item_id: c.item_id as string,
      item_code: c.item_code as string,
      item_name: c.item_name as string,
      qty_per: Number(c.qty_per),
    });
    componentsByAssembly.set(c.assembly_id as string, list);
  }

  const items = itemRows.map(toItem);
  const assemblies: LibraryAssembly[] = assemblyRows.map(row => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    category: row.category as string,
    unit: row.unit as EstUnit,
    aliases: (row.aliases as string[]) ?? [],
    source: row.source as string,
    active: row.active as boolean,
    components: componentsByAssembly.get(row.id as string) ?? [],
  }));
  const factors = factorRows.map(toFactor);

  return { items, assemblies, factors };
}

/** An assembly's per-unit material $ / labor hours, resolved from its
 *  components, plus whether ANY component's price is unverified. */
export interface ResolvedAssembly {
  materialCost: number;
  laborHours: number;
  unverified: boolean;
}

export function resolveAssemblyCost(assembly: LibraryAssembly, itemsById: Map<string, LibraryItem>): ResolvedAssembly {
  let materialCost = 0;
  let laborHours = 0;
  let unverified = false;
  for (const c of assembly.components) {
    const item = itemsById.get(c.item_id);
    if (!item) continue;
    materialCost += item.material_cost * c.qty_per;
    laborHours += item.labor_hours * c.qty_per;
    if (item.material_price_date == null) unverified = true;
  }
  return { materialCost, laborHours, unverified };
}

// ── Admin writes ─────────────────────────────────────────────────────────────

export interface ItemInput {
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  material_cost: number;
  material_price_date?: string | null;
  labor_hours: number;
  aliases?: string[];
}

export async function createItem(input: ItemInput): Promise<LibraryItem> {
  const { rows } = await pool.query(
    `INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',true) RETURNING *`,
    [input.code, input.name, input.category, input.unit, input.material_cost,
     input.material_price_date ?? null, input.labor_hours, input.aliases ?? []]
  );
  return toItem(rows[0]);
}

export interface ItemPatch extends Partial<ItemInput> {
  active?: boolean;
}

/** Editing an item sets source='manual' (an estimator's edit overrides the seed),
 *  UNLESS the only change is `active` (deactivate/reactivate never touches source). */
export async function updateItem(id: string, patch: ItemPatch): Promise<LibraryItem | null> {
  const fields = Object.keys(patch).filter(k => k !== 'active') as (keyof ItemPatch)[];
  const setActiveOnly = fields.length === 0 && patch.active !== undefined;

  const { rows: existingRows } = await pool.query('SELECT * FROM est_items WHERE id=$1', [id]);
  if (!existingRows.length) return null;
  const existing = toItem(existingRows[0]);

  const next: ItemInput & { active: boolean } = {
    code: patch.code ?? existing.code,
    name: patch.name ?? existing.name,
    category: patch.category ?? existing.category,
    unit: patch.unit ?? existing.unit,
    material_cost: patch.material_cost ?? existing.material_cost,
    material_price_date: patch.material_price_date !== undefined ? patch.material_price_date : existing.material_price_date,
    labor_hours: patch.labor_hours ?? existing.labor_hours,
    aliases: patch.aliases ?? existing.aliases,
    active: patch.active ?? existing.active,
  };
  const source = setActiveOnly ? existing.source : 'manual';

  const { rows } = await pool.query(
    `UPDATE est_items SET code=$1, name=$2, category=$3, unit=$4, material_cost=$5,
       material_price_date=$6, labor_hours=$7, aliases=$8, source=$9, active=$10, updated_at=now()
     WHERE id=$11 RETURNING *`,
    [next.code, next.name, next.category, next.unit, next.material_cost, next.material_price_date,
     next.labor_hours, next.aliases, source, next.active, id]
  );
  return rows.length ? toItem(rows[0]) : null;
}

export interface AssemblyInput {
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  aliases?: string[];
  components: { item_id: string; qty_per: number }[];
}

export async function createAssembly(input: AssemblyInput): Promise<LibraryAssembly> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
       VALUES ($1,$2,$3,$4,$5,'manual',true) RETURNING *`,
      [input.code, input.name, input.category, input.unit, input.aliases ?? []]
    );
    const assembly = rows[0];
    for (const c of input.components) {
      await client.query(
        'INSERT INTO est_assembly_components (assembly_id, item_id, qty_per) VALUES ($1,$2,$3)',
        [assembly.id, c.item_id, c.qty_per]
      );
    }
    await client.query('COMMIT');
    return { ...toAssemblyBase(assembly), components: await componentsFor(assembly.id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface AssemblyPatch extends Partial<Omit<AssemblyInput, 'components'>> {
  active?: boolean;
  components?: { item_id: string; qty_per: number }[];
}

export async function updateAssembly(id: string, patch: AssemblyPatch): Promise<LibraryAssembly | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_assemblies WHERE id=$1', [id]);
  if (!existingRows.length) return null;
  const existing = existingRows[0];

  const touchesFields = Object.keys(patch).some(k => k !== 'active');
  const source = touchesFields ? 'manual' : existing.source;

  const next = {
    code: patch.code ?? existing.code,
    name: patch.name ?? existing.name,
    category: patch.category ?? existing.category,
    unit: patch.unit ?? existing.unit,
    aliases: patch.aliases ?? existing.aliases,
    active: patch.active ?? existing.active,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE est_assemblies SET code=$1, name=$2, category=$3, unit=$4, aliases=$5, source=$6, active=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [next.code, next.name, next.category, next.unit, next.aliases, source, next.active, id]
    );
    if (patch.components) {
      await client.query('DELETE FROM est_assembly_components WHERE assembly_id=$1', [id]);
      for (const c of patch.components) {
        await client.query(
          'INSERT INTO est_assembly_components (assembly_id, item_id, qty_per) VALUES ($1,$2,$3)',
          [id, c.item_id, c.qty_per]
        );
      }
    }
    await client.query('COMMIT');
    return { ...toAssemblyBase(rows[0]), components: await componentsFor(id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function toAssemblyBase(row: Record<string, unknown>): Omit<LibraryAssembly, 'components'> {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    category: row.category as string,
    unit: row.unit as EstUnit,
    aliases: (row.aliases as string[]) ?? [],
    source: row.source as string,
    active: row.active as boolean,
  };
}

async function componentsFor(assemblyId: string): Promise<AssemblyComponent[]> {
  const { rows } = await pool.query(
    `SELECT ac.item_id, ac.qty_per, i.code AS item_code, i.name AS item_name
     FROM est_assembly_components ac JOIN est_items i ON i.id = ac.item_id
     WHERE ac.assembly_id = $1`,
    [assemblyId]
  );
  return rows.map(r => ({ item_id: r.item_id, item_code: r.item_code, item_name: r.item_name, qty_per: Number(r.qty_per) }));
}

export interface FactorInput {
  code: string;
  label: string;
  pct: number;
  group_key: string;
}

export async function createFactor(input: FactorInput): Promise<LibraryFactor> {
  const { rows } = await pool.query(
    `INSERT INTO est_labor_factors (code, label, pct, group_key, active) VALUES ($1,$2,$3,$4,true) RETURNING *`,
    [input.code, input.label, input.pct, input.group_key]
  );
  return toFactor(rows[0]);
}

export interface FactorPatch extends Partial<FactorInput> {
  active?: boolean;
}

export async function updateFactor(id: string, patch: FactorPatch): Promise<LibraryFactor | null> {
  const { rows: existingRows } = await pool.query('SELECT * FROM est_labor_factors WHERE id=$1', [id]);
  if (!existingRows.length) return null;
  const existing = toFactor(existingRows[0]);
  const next = {
    code: patch.code ?? existing.code,
    label: patch.label ?? existing.label,
    pct: patch.pct ?? existing.pct,
    group_key: patch.group_key ?? existing.group_key,
    active: patch.active ?? existing.active,
  };
  const { rows } = await pool.query(
    `UPDATE est_labor_factors SET code=$1, label=$2, pct=$3, group_key=$4, active=$5, updated_at=now() WHERE id=$6 RETURNING *`,
    [next.code, next.label, next.pct, next.group_key, next.active, id]
  );
  return rows.length ? toFactor(rows[0]) : null;
}
