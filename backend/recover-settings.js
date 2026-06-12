// One-time recovery for settings lost during the data migration.
//
// The original migrate-data.js copied app_settings with `ON CONFLICT DO NOTHING`.
// Because the new (target) database pre-seeds app_settings with default rows (API keys
// as '', generator pricing, company info, etc.), every seeded key already existed and the
// real values from the old database were silently skipped — reverting those settings to
// their defaults.
//
// This script re-copies app_settings from the old database (SOURCE_DB) into the current
// one (TARGET_DB) with `ON CONFLICT DO UPDATE`, so the old values win. It touches ONLY the
// app_settings table — no business data (leads, customers, proposals, …) is read or changed.
//
// Run via the "Migrate Data" GitHub Actions workflow (workflow_dispatch), with repo secrets:
//   SOURCE_DB = the OLD database connection string (the one that still has your real values)
//   TARGET_DB = the CURRENT database the app uses
const { Pool } = require('pg');

const source = new Pool({ connectionString: process.env.SOURCE_DB, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: process.env.TARGET_DB, ssl: { rejectUnauthorized: false } });

async function main() {
  if (!process.env.SOURCE_DB || !process.env.TARGET_DB) {
    console.error('SOURCE_DB and TARGET_DB must both be set.');
    process.exit(1);
  }

  const { rows } = await source.query('SELECT key, value FROM app_settings');
  console.log(`Read ${rows.length} setting(s) from the old database.`);

  let restored = 0;
  for (const row of rows) {
    // Only update when the value actually differs, so we don't churn settings you've
    // already corrected in the current database. EXCLUDED is the value from the old DB.
    const res = await target.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value`,
      [row.key, row.value]
    );
    if (res.rowCount > 0) {
      restored++;
      // Don't print secret values — just the key that was restored.
      console.log('Restored: ' + row.key);
    }
  }

  console.log(`Done. ${restored} setting(s) restored from the old database.`);
  await source.end();
  await target.end();
  process.exit(0);
}

main().catch(e => { console.error('Recovery failed:', e.message); process.exit(1); });
