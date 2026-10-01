// Accuracy round — migration 159: est_feeder_estimate insert-if-absent; the
// UNTOUCHED v1 cost-line defaults move to v2; an edited value stays.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { DEFAULT_COST_LINE_DEFAULTS, COST_LINE_DEFAULTS_V2, parseCostLineDefaults } from '../estimating/costLineDefaults';
import { DEFAULT_FEEDER_ESTIMATE, parseFeederEstimateSettings } from '../estimating/feederRoute';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
const SQL = fs.readFileSync(path.join(__dirname, '../../../database/migrations/159_feeder_estimate_and_itemized_defaults.sql'), 'utf8');

describe('migration 159', () => {
  it('v1 → v2 only when untouched; idempotent; feeder settings seeded', async (ctx) => {
    if (!ok) return ctx.skip();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM app_settings WHERE key IN ('est_cost_line_defaults','est_feeder_estimate')`);
      await client.query(`INSERT INTO app_settings (key, value) VALUES ('est_cost_line_defaults', $1)`, [JSON.stringify(DEFAULT_COST_LINE_DEFAULTS)]);
      await client.query(SQL); await client.query(SQL);
      const get = async (k: string) => (await client.query('SELECT value FROM app_settings WHERE key=$1', [k])).rows[0]?.value as string;
      expect(parseCostLineDefaults(await get('est_cost_line_defaults'))).toEqual(parseCostLineDefaults(JSON.stringify(COST_LINE_DEFAULTS_V2)));
      expect(parseFeederEstimateSettings(await get('est_feeder_estimate'))).toEqual(DEFAULT_FEEDER_ESTIMATE);
      const edited = JSON.stringify({ ...DEFAULT_COST_LINE_DEFAULTS, equipment: { ...DEFAULT_COST_LINE_DEFAULTS.equipment, minimum: 999 } });
      await client.query(`UPDATE app_settings SET value=$1 WHERE key='est_cost_line_defaults'`, [edited]);
      await client.query(SQL);
      expect(await get('est_cost_line_defaults')).toBe(edited);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
