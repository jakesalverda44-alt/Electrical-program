// Pure builders for the Install Only proposal's scope rows (page 1). Wording lives in
// installOnlyText.ts; this file only decides WHICH rows appear for a given scope.
import type { GenForm } from './genData';
import { coerceInstallOnly, loadCenterFor } from './genCalc';
import * as T from './installOnlyText';

export interface IoScopeRow { title: string; desc: string }

/** Rows before SMM / surge / silver service: customer's equipment, set, ATS, run, connect, battery. */
export function ioScopeHead(form: GenForm): IoScopeRow[] {
  const io = coerceInstallOnly(form.installOnly);
  const lc = loadCenterFor(form);
  const rows: IoScopeRow[] = [
    { title: T.ioCustomerGenTitle(form.brand, form.size, io.unitDesc), desc: T.ioCustomerGenBody(io) },
  ];
  if (io.setGenerator) {
    const where = form.genStand !== 'none' ? 'stand' : form.pad ? 'new-pad' : 'existing';
    rows.push({ title: T.IO_SET_TITLE, desc: T.ioSetBody(where) });
  }
  // Load-center units carry their own integrated switch: one load-center row, no separate ATS.
  if (lc) {
    if (io.ats !== 'existing') rows.push({ title: T.IO_LC_TITLE, desc: T.IO_LC_BODY });
  } else {
    const qty = Math.max(1, Number(form.atsQty) || 0);
    if (io.ats === 'customer-install') rows.push({ title: T.ioAtsCustomerTitle, desc: T.ioAtsInstallBody('customer', form.atsSize, qty) });
    else if (io.ats === 'apt-supply-install') rows.push({ title: T.ioAtsAptTitle(form.atsSize), desc: T.ioAtsInstallBody('apt', form.atsSize, qty) });
    else rows.push({ title: T.ioAtsExistingTitle, desc: T.IO_ATS_EXISTING_BODY });
  }
  if (io.conduit === 'run') rows.push({ title: T.ioConduitRunTitle(io.runFt), desc: T.IO_CONDUIT_RUN_BODY });
  else if (io.conduit === 'wire-only') rows.push({ title: T.ioConduitWireTitle(io.runFt), desc: T.IO_CONDUIT_WIRE_BODY });
  else rows.push({ title: T.IO_CONDUIT_EXISTING_TITLE, desc: T.IO_CONDUIT_EXISTING_BODY });
  rows.push({ title: T.IO_CONNECT_TITLE, desc: T.IO_CONNECT_BODY });
  if (io.setGenerator && form.battery) rows.push({ title: T.IO_BATTERY_TITLE, desc: T.IO_BATTERY_BODY });
  return rows;
}

/** Startup (always), permit, gas, workmanship-only warranty. */
export function ioScopeTail(form: GenForm): IoScopeRow[] {
  const io = coerceInstallOnly(form.installOnly);
  return [
    { title: T.IO_STARTUP_TITLE, desc: T.IO_STARTUP_BODY },
    { title: T.IO_PERMIT_TITLE, desc: io.permit ? T.IO_PERMIT_INCLUDED_BODY : T.IO_PERMIT_EXCLUDED_BODY },
    io.gas
      ? { title: T.IO_GAS_TITLE_INCLUDED, desc: T.IO_GAS_INCLUDED_BODY }
      : { title: T.IO_GAS_TITLE_BY_OTHERS, desc: T.IO_GAS_BY_OTHERS_BODY },
    { title: T.IO_WARRANTY_TITLE, desc: T.IO_WARRANTY_BODY },
  ];
}

export function ioNotIncludedRow(form: GenForm): IoScopeRow {
  return { title: T.IO_NOT_INCLUDED_TITLE, desc: T.ioNotIncludedBody(coerceInstallOnly(form.installOnly)) };
}
