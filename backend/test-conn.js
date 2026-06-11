const { Pool } = require('pg');
const target = new Pool({
  connectionString: process.env.TARGET_DB,
  ssl: { rejectUnauthorized: false }
});
async function test() {
  try {
    const res = await target.query('SELECT 1');
    console.log('Connected to Supabase OK');
  } catch(e) {
    console.log('Supabase connection failed: ' + e.message);
  }
  process.exit(0);
}
test();
