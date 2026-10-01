import type { Gen } from '../../types';
import { blankGenForm, installOnlyIssues, migrateGenForm } from '../builder/genCalc';
import type { GenForm } from '../builder/genData';
import { IO_ISSUE_INCOMPLETE } from '../builder/installOnlyText';

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

/** Why an install-only proposal can't be sent yet (first blocking issue), or null. Mirrors the
 *  backend's installOnlySendIssues, which is what actually enforces it on POST /gens/:id/send. */
export function installOnlySendBlock(g: Pick<Gen, 'form_data'>): string | null {
  if (!isInstallOnlyGen(g)) return null;
  let raw: Record<string, unknown>;
  try {
    const f = typeof g.form_data === 'string' ? JSON.parse(g.form_data) : g.form_data;
    raw = f as Record<string, unknown>;
  } catch { return null; }
  if (!raw.installOnly || typeof raw.installOnly !== 'object' || raw.labor === undefined || raw.permit === undefined) {
    return IO_ISSUE_INCOMPLETE;
  }
  const form = { ...blankGenForm(), ...migrateGenForm(raw) } as GenForm;
  return installOnlyIssues(form)[0] ?? null;
}
