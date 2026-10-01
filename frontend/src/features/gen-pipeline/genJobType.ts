import type { Gen } from '../../types';

/** True when a generator proposal row is an "Install Only" (customer-furnished generator) job.
 *  form_data arrives as an object or, on older rows, a JSON string; anything unparseable is false. */
export function isInstallOnlyGen(g: Pick<Gen, 'form_data'>): boolean {
  try {
    const f = typeof g.form_data === 'string' ? JSON.parse(g.form_data) : g.form_data;
    return !!f && typeof f === 'object' && (f as { jobType?: unknown }).jobType === 'install-only';
  } catch {
    return false;
  }
}
