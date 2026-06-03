import { pool } from './pool';

export async function getSetting(key: string): Promise<string> {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? '';
}
