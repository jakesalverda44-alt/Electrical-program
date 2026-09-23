// One-off generator: renders database/migrations/102_estimating_labor_seed.sql
// from the typed data in src/estimating/seed/laborUnits.ts.
//
// Why generated SQL rather than a TS seed hook in migrate.ts: migrate.ts's
// runner (backend/src/migrate.ts) executes each migrations/*.sql file as raw
// SQL inside its own BEGIN/COMMIT and has no mechanism to invoke TypeScript
// mid-migration (the one precedent — bootstrapping the first admin user — is
// inline in migrate.ts itself, which would mean special-casing this one
// migration's filename there; generating the SQL once from the typed source
// is less invasive and keeps migrate.ts's "just run the .sql files" contract
// intact for every migration, this one included).
//
// Run with `npx ts-node scripts/generateLaborSeedSql.ts > ../database/migrations/102_estimating_labor_seed.sql`
// (from backend/) whenever laborUnits.ts changes — `ts-node` is already a
// resolvable local devDependency (pulled in by ts-node-dev), unlike `tsx`
// (fix round 1 / N9), which this repo has never installed and would make
// every run silently fetch from the registry over the network instead of
// using something already pinned in package-lock.json. Every INSERT is
// idempotent (ON CONFLICT ... DO NOTHING keyed on `code`, or on the natural
// key for assembly_components) so re-running the generated file is always
// safe and never overwrites an estimator's edit (source becomes 'manual' on
// edit — see routes/estimating.ts — and idempotent seed inserts never touch
// an existing row).
import { SEED_ITEMS, SEED_ASSEMBLIES, SEED_LABOR_FACTORS } from '../src/estimating/seed/laborUnits';

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
function sqlArr(arr: string[]): string {
  return `ARRAY[${arr.map(sqlStr).join(',')}]::text[]`;
}

const lines: string[] = [];
lines.push('-- GENERATED FILE — do not hand-edit. Regenerate with:');
lines.push('--   npx ts-node scripts/generateLaborSeedSql.ts > ../database/migrations/102_estimating_labor_seed.sql');
lines.push('-- from backend/, after changing src/estimating/seed/laborUnits.ts.');
lines.push('--');
lines.push('-- Task 2 of docs/superpowers/plans/2026-09-22-estimating-labor-engine-and-redesign.md.');
lines.push('-- Every seeded item/assembly/factor is source=\'seed\': industry-typical starting');
lines.push('-- values authored for this app, NOT copied from the NECA Manual of Labor Units.');
lines.push('-- material_price_date is left NULL on every row (unverified).');
lines.push('-- Insert-if-absent by code, so re-running this file is idempotent and never');
lines.push('-- clobbers an estimator\'s edit (an edited row\'s source becomes \'manual\').');
lines.push('');

lines.push('-- ── Items ─────────────────────────────────────────────────────────────────');
for (const it of SEED_ITEMS) {
  lines.push(
    `INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)\n` +
    `VALUES (${sqlStr(it.code)}, ${sqlStr(it.name)}, ${sqlStr(it.category)}, ${sqlStr(it.unit)}, ${it.materialCost}, NULL, ${it.laborHours}, ${sqlArr(it.aliases)}, 'seed', true)\n` +
    `ON CONFLICT (code) DO NOTHING;`
  );
}

lines.push('');
lines.push('-- ── Assemblies ───────────────────────────────────────────────────────────');
for (const a of SEED_ASSEMBLIES) {
  lines.push(
    `INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)\n` +
    `VALUES (${sqlStr(a.code)}, ${sqlStr(a.name)}, ${sqlStr(a.category)}, ${sqlStr(a.unit)}, ${sqlArr(a.aliases)}, 'seed', true)\n` +
    `ON CONFLICT (code) DO NOTHING;`
  );
}

lines.push('');
lines.push('-- ── Assembly components ──────────────────────────────────────────────────');
for (const a of SEED_ASSEMBLIES) {
  for (const c of a.components) {
    lines.push(
      `INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)\n` +
      `SELECT asm.id, it.id, ${c.qtyPer}\n` +
      `FROM est_assemblies asm, est_items it\n` +
      `WHERE asm.code = ${sqlStr(a.code)} AND it.code = ${sqlStr(c.itemCode)}\n` +
      `ON CONFLICT (assembly_id, item_id) DO NOTHING;`
    );
  }
}

lines.push('');
lines.push('-- ── Labor factors ────────────────────────────────────────────────────────');
for (const f of SEED_LABOR_FACTORS) {
  lines.push(
    `INSERT INTO est_labor_factors (code, label, pct, group_key, active)\n` +
    `VALUES (${sqlStr(f.code)}, ${sqlStr(f.label)}, ${f.pct}, ${sqlStr(f.groupKey)}, true)\n` +
    `ON CONFLICT (code) DO NOTHING;`
  );
}

// eslint-disable-next-line no-console
console.log(lines.join('\n'));
