import { getSetting } from '../db/getSetting';

/** Current flat commission rate as a percentage (e.g. 3 = 3%). Defaults to 0 if unset/invalid. */
export async function commissionRate(): Promise<number> {
  const raw = await getSetting('commission_default_rate');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Commission amount for a contract value at the given rate, rounded to cents. */
export function commissionAmount(value: number | null | undefined, rate: number): number {
  return Math.round((Number(value) || 0) * rate) / 100;
}
