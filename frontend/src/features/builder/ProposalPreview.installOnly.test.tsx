// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ProposalPreview from './ProposalPreview';
import { blankGenForm, calcGenTotals, applyJobType, applyIoPreset, IO_PRESETS } from './genCalc';
import type { GenForm, InstallOnlyScope } from './genData';
import * as T from './installOnlyText';
import { LEGACY_FORMS } from './__fixtures__/legacyGenForms';

afterEach(cleanup);
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function ioForm(preset: Parameters<typeof applyIoPreset>[1], scope: Partial<InstallOnlyScope> = {}, over: Partial<GenForm> = {}): GenForm {
  const f = applyIoPreset(applyJobType({ ...blankGenForm(), customer: 'Jane Homeowner', includeBreakdown: true }, 'install-only'), preset);
  return { ...f, ...over, installOnly: { ...f.installOnly, runFt: 40, ...scope } };
}
function text(form: GenForm): string {
  const { container } = render(<ProposalPreview embed={false} form={form} totals={calcGenTotals(form)} proposalNo="P-1" onBack={() => {}}/>);
  return container.textContent ?? '';
}

describe('ProposalPreview — Install Only', () => {
  it.each(IO_PRESETS.map(p => [p.key]))('preset %s: always has startup, connection, customer-furnished wording and workmanship warranty', (key) => {
    const t = text(ioForm(key));
    expect(t).toContain(T.IO_SUBTITLE);
    expect(t).toContain('Customer-Furnished Generator — Kohler 14KW');
    expect(t).toContain(T.IO_STARTUP_TITLE);
    expect(t).toContain(T.IO_STARTUP_BODY);
    expect(t).toContain(T.IO_CONNECT_TITLE);
    expect(t).toContain(T.IO_WARRANTY_TITLE);
    expect(t).toContain(T.IO_WARRANTY_BODY);
    expect(t).toContain(T.IO_NOT_INCLUDED_TITLE);
    expect(t).not.toContain('APT to provide a Kohler');
    expect(t).not.toContain("5-Year Manufacturer's Comprehensive Warranty");
    expect(t).not.toContain('Permit Fees & Sales Tax Included');
  });

  it('has no generator price row on the breakdown and no spec sheet', () => {
    const t = text(ioForm('full'));
    expect(t).toContain('PRICE BREAKDOWN');
    expect(t).not.toMatch(/Kohler 14KW Generator\s*taxable/);
    expect(t).not.toContain('Product Specifications');
    expect(t).not.toContain('Battery Maintainer');
  });

  it('shows only the checked items', () => {
    const full = text(ioForm('full'));
    expect(full).toContain(T.IO_SET_TITLE);
    expect(full).toContain(T.ioAtsCustomerTitle);
    expect(full).toContain(T.ioConduitRunTitle(40));
    expect(full).toContain(T.IO_BATTERY_TITLE);
    expect(full).toContain(T.IO_PERMIT_INCLUDED_BODY);
    expect(full).toContain(T.IO_GAS_BY_OTHERS_BODY);
    const wire = text(ioForm('wire-pull'));
    expect(wire).not.toContain(T.IO_SET_TITLE);
    expect(wire).not.toContain(T.IO_BATTERY_TITLE);
    expect(wire).toContain(T.ioAtsExistingTitle);
    expect(wire).toContain(T.ioConduitWireTitle(40));
    expect(wire).toContain(T.IO_PERMIT_EXCLUDED_BODY);
  });

  it.each([
    ['customer-install', T.ioAtsCustomerTitle],
    ['apt-supply-install', T.ioAtsAptTitle('200A')],
    ['existing', T.ioAtsExistingTitle],
  ] as const)('ATS mode %s', (ats, title) => {
    const t = text(ioForm('full', { ats }));
    expect(t).toContain(title);
    for (const other of [T.ioAtsCustomerTitle, T.ioAtsAptTitle('200A'), T.ioAtsExistingTitle]) {
      if (other !== title) expect(t).not.toContain(other);
    }
    // the intro/Not Included wording mentions the transfer switch only when the customer supplies it
    expect(t.includes('described below')).toBe(true);
    expect(t.includes('customer-furnished generator and transfer switch described below')).toBe(ats === 'customer-install');
  });

  it.each([
    ['run', T.ioConduitRunTitle(40)],
    ['wire-only', T.ioConduitWireTitle(40)],
    ['existing', T.IO_CONDUIT_EXISTING_TITLE],
  ] as const)('conduit mode %s', (conduit, title) => {
    const t = text(ioForm('full', { conduit }));
    expect(t).toContain(title);
  });

  it('gas checked, set on a stand, and unit description', () => {
    const t = text(ioForm('full', { gas: true, unitDesc: 'Generac 7043' }, { genStand: 'big', pad: false }));
    expect(t).toContain(T.IO_GAS_INCLUDED_BODY);
    expect(t).not.toContain(T.IO_GAS_BY_OTHERS_BODY);
    expect(t).toContain('Customer-Furnished Generator — Kohler 14KW (Generac 7043)');
    expect(t).toContain('adjustable gen stand');
  });

  it('Clause 28 and the conditional permit sentence render only for install-only', () => {
    const io = text(ioForm('full'));
    expect(io).toContain('28. Customer-Furnished Equipment.');
    for (const item of T.IO_CLAUSE28_ITEMS) expect(io).toContain(item);
    expect(io).toContain('Permits are included; sales tax is included on taxable items.');
    expect(io).not.toContain('Permits and Sales Tax are included in the Generator Proposal.');
    expect(text(ioForm('wire-pull'))).toContain('Permits are not included; sales tax is included on taxable items.');
    for (const form of Object.values(LEGACY_FORMS)) {
      cleanup();
      const t = text(form);
      expect(t).not.toContain('Customer-Furnished Equipment');
      expect(t).not.toContain('Customer-Furnished');
      expect(t).toContain('Permits and Sales Tax are included in the Generator Proposal.');
    }
  });

  it('breakdown lists io labor non-taxable and APT ATS taxable', () => {
    const { container } = render((() => {
      const f = ioForm('full', { ats: 'apt-supply-install' });
      return <ProposalPreview embed={false} form={f} totals={calcGenTotals(f)} proposalNo="P-1" onBack={() => {}}/>;
    })());
    const rows = Array.from(container.querySelectorAll('tr')).map(r => r.textContent ?? '');
    expect(rows.find(r => r.startsWith('ATS — APT-furnished'))).toContain('taxable');
    const conduit = rows.find(r => r.startsWith('Conduit & Wire Run'));
    expect(conduit).toBeTruthy();
    expect(conduit).not.toContain('taxable');
    expect(rows.find(r => r.startsWith('Concrete Pad'))).toContain('taxable');
    expect(container.textContent).toContain('Installation labor');
  });
});
