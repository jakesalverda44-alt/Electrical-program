const { Pool } = require('pg');
const source = new Pool({ connectionString: process.env.SOURCE_DB, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: process.env.TARGET_DB, ssl: { rejectUnauthorized: false } });
const tables = ['users','customers','leads','bids','bid_estimates','generator_proposals','projects','project_sections','project_field_notes','project_change_orders','project_rfis','organizations','communications','documents','notifications','activity','lead_activity','intake_items','app_settings','audit_log','push_subscriptions','takeoff_results','proposal_activity'];
async function migrate() {
  for (const table of tables) {
    try {
      const res = await source.query('SELECT * FROM ' + table);
      if (res.rows.length === 0) { console.log('Empty: ' + table); continue; }
      const keys = Object.keys(res.rows[0]);
      for (const row of res.rows) {
        const vals = keys.map(k => row[k]);
        const placeholders = keys.map((_, i) => '$' + (i+1)).join(',');
        await target.query('INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + placeholders + ') ON CONFLICT DO NOTHING', vals);
      }
      console.log('Migrated: ' + table + ' (' + res.rows.length + ' rows)');
    } catch(e) { console.log('Error on ' + table + ': ' + e.message); }
  }
  console.log('Done.');
  process.exit(0);
}
migrate();
