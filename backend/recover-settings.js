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
// MODES (set via the MODE env var, default "verify"):
//   verify — read-only. Connects to both databases and prints which one holds your real
//            key and how many settings each has. WRITES NOTHING. Run this first to confirm
//            SOURCE_DB is the OLD database and TARGET_DB is the CURRENT one.
//   apply  — performs the recovery (writes to TARGET_DB only).
//
// Run via the "Migrate Data" GitHub Actions workflow (workflow_dispatch), with repo secrets:
//   SOURCE_DB = the OLD database connection string (the one that still has your real values)
//   TARGET_DB = the CURRENT database the app uses
const { Pool } = require('pg');

const MODE = (process.env.MODE || 'verify').toLowerCase();
const source = new Pool({ connectionString: process.env.SOURCE_DB, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: process.env.TARGET_DB, ssl: { rejectUnauthorized: false } });

/** Safe, secret-free fingerprint of a database's settings, for the verify report. */
async function summarize(pool, label) {
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  const nonEmpty = rows.filter(r => r.value && r.value.trim() !== '').length;
  const apiKey = (rows.find(r => r.key === 'ai_anthropic_key') || {}).value || '';
  const resendKey = (rows.find(r => r.key === 'email_resend_api_key') || {}).value || '';
  const fmt = v => (v && v.trim() ? `SET (••••${v.slice(-4)})` : 'EMPTY');
  console.log(`\n[${label}]`);
  console.log(`  total settings : ${rows.length}`);
  console.log(`  non-empty      : ${nonEmpty}`);
  console.log(`  ai_anthropic_key      : ${fmt(apiKey)}`);
  console.log(`  email_resend_api_key  : ${fmt(resendKey)}`);
  return { apiKey: apiKey.trim() };
}

async function main() {
  if (!process.env.SOURCE_DB || !process.env.TARGET_DB) {
    console.error('SOURCE_DB and TARGET_DB must both be set.');
    process.exit(1);
  }

  console.log(`Mode: ${MODE}`);
  const src = await summarize(source, 'SOURCE_DB (should be your OLD database — has the key)');
  await summarize(target, 'TARGET_DB (should be the CURRENT database — key is empty)');

  // Guard: if SOURCE has no key, it is almost certainly NOT the old database (or the secrets
  // are swapped). Refuse to write, so we never overwrite the old DB's real values with empties.
  if (!src.apiKey) {
    console.error('\nABORT: SOURCE_DB has no ai_anthropic_key — it does not look like the old database.');
    console.error('Check that SOURCE_DB points to the OLD database and TARGET_DB to the CURRENT one.');
    process.exit(1);
  }

  if (MODE !== 'apply') {
    console.log('\nVERIFY only — nothing was written.');
    console.log('If the SOURCE block above shows your key as SET and TARGET shows EMPTY, the');
    console.log('direction is correct. Re-run the workflow with mode = apply to restore.');
    await source.end(); await target.end();
    process.exit(0);
  }

  const { rows } = await source.query('SELECT key, value FROM app_settings');
  console.log(`\nApplying: read ${rows.length} setting(s) from the old database.`);
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

  console.log(`\nDone. ${restored} setting(s) restored from the old database.`);
  await source.end();
  await target.end();
  process.exit(0);
}

main().catch(e => { console.error('Recovery failed:', e.message); process.exit(1); });
