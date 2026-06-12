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
//   verify — read-only. Connects to both databases and prints a full SOURCE-vs-TARGET
//            comparison so you can see exactly which settings were lost. WRITES NOTHING.
//   apply  — performs the recovery (writes to TARGET_DB only).
//
// Run via the "Migrate Data" GitHub Actions workflow (workflow_dispatch), with repo secrets:
//   SOURCE_DB = the OLD database connection string (the one that still has your real values)
//   TARGET_DB = the CURRENT database the app uses
const { Pool } = require('pg');

const MODE = (process.env.MODE || 'verify').toLowerCase();
const source = new Pool({ connectionString: process.env.SOURCE_DB, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: process.env.TARGET_DB, ssl: { rejectUnauthorized: false } });

// Secrets are shown as SET/EMPTY only; everything else shows its real value so the
// verify report is actually useful for spotting reverted pricing / company info.
const SECRET_KEYS = ['ai_anthropic_key', 'email_resend_api_key'];
const show = (key, v) => {
  if (!v || !v.trim()) return 'EMPTY';
  if (SECRET_KEYS.includes(key)) return `SET (••••${v.slice(-4)})`;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

/** Read app_settings into a key→value map. */
async function readSettings(pool) {
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  return new Map(rows.map(r => [r.key, r.value ?? '']));
}

/** Print a full SOURCE-vs-TARGET comparison so reverted settings are obvious. */
function printDiff(src, tgt) {
  const keys = [...new Set([...src.keys(), ...tgt.keys()])].sort();
  const rows = keys.map(k => {
    const s = src.get(k) ?? '';
    const t = tgt.get(k) ?? '';
    let status = 'same';
    if (!src.has(k)) status = 'only in current';
    else if (s.trim() === t.trim()) status = 'same';
    else if (s.trim() && !t.trim()) status = 'LOST';
    else status = 'differs';
    return { k, s, t, status };
  });
  const lost = rows.filter(r => r.status === 'LOST');
  const diff = rows.filter(r => r.status === 'differs');

  console.log(`\n================ SETTINGS COMPARISON ================`);
  console.log(`SOURCE (old) keys: ${src.size}   TARGET (current) keys: ${tgt.size}`);
  console.log(`\n--- LOST (had a value in old DB, blank in current) ---`);
  if (!lost.length) console.log('  (none)');
  for (const r of lost) console.log(`  ${r.k.padEnd(24)} old=${show(r.k, r.s)}`);
  console.log(`\n--- DIFFERENT (value changed between old and current) ---`);
  if (!diff.length) console.log('  (none)');
  for (const r of diff) console.log(`  ${r.k.padEnd(24)} old=${show(r.k, r.s)}  |  current=${show(r.k, r.t)}`);
  console.log(`\n====================================================`);
  return { lostCount: lost.length, diffCount: diff.length };
}

async function main() {
  if (!process.env.SOURCE_DB || !process.env.TARGET_DB) {
    console.error('SOURCE_DB and TARGET_DB must both be set.');
    process.exit(1);
  }

  console.log(`Mode: ${MODE}`);
  const srcMap = await readSettings(source);
  const tgtMap = await readSettings(target);
  const srcApiKey = (srcMap.get('ai_anthropic_key') || '').trim();

  if (MODE !== 'apply') {
    // Read-only: full comparison, writes nothing. Never aborts — safe to run anytime.
    printDiff(srcMap, tgtMap);
    if (!srcApiKey) {
      console.log('\nNOTE: SOURCE_DB has no ai_anthropic_key. Either it is not the old database,');
      console.log('or the SOURCE/TARGET secrets are swapped. Do NOT run apply until this looks right.');
    }
    console.log('\nVERIFY only — nothing was written. Re-run with mode = apply to copy the');
    console.log('SOURCE (old) values into the current database.');
    await source.end(); await target.end();
    process.exit(0);
  }

  // Guard: if SOURCE has no key, it is almost certainly NOT the old database (or the secrets
  // are swapped). Refuse to write, so we never overwrite the old DB's real values with empties.
  if (!srcApiKey) {
    console.error('\nABORT: SOURCE_DB has no ai_anthropic_key — it does not look like the old database.');
    console.error('Check that SOURCE_DB points to the OLD database and TARGET_DB to the CURRENT one.');
    process.exit(1);
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
