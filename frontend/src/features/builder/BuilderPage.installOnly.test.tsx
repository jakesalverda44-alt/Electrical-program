// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  },
}));

import BuilderPage, { genToForm } from './BuilderPage';
import { calcGenTotals } from './genCalc';
import { DEFAULT_PRICES } from './genData';
import type { Gen } from '../../types';

afterEach(cleanup);
beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: { id: 'g1' } });
});

function setup(settings: Record<string, string> = {}) {
  const st = { ...DEFAULT_APP_SETTINGS, ...settings };
  render(
    <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={st} reloadSettings={() => {}}>
      <BuilderPage setGens={() => {}} onSaved={() => {}} />
    </AppProviders>,
  );
}
const goInstallOnly = () => fireEvent.click(screen.getByText('Install Only'));
const num = (id: string) => (screen.getByTestId(id) as HTMLInputElement);

describe('BuilderPage — Install Only', () => {
  it('shows a third Job Type button and the scope section only for install-only', () => {
    setup();
    expect(screen.queryByTestId('io-scope')).toBeNull();
    expect(screen.getByText('Generator Cost')).toBeTruthy();
    goInstallOnly();
    expect(screen.getByTestId('io-scope')).toBeTruthy();
    expect(screen.queryByText('Generator Cost')).toBeNull();
    expect(screen.queryByText('Extended Warranty')).toBeNull();
    expect(screen.queryByText('Extra Wire (ft)')).toBeNull();
    expect(screen.getByText('Additional Labor')).toBeTruthy();
    // switching back round-trips
    fireEvent.click(screen.getByText('New Install'));
    expect(screen.queryByTestId('io-scope')).toBeNull();
    expect(screen.getByText('Generator Cost')).toBeTruthy();
    expect(screen.getByText('Extended Warranty')).toBeTruthy();
  });

  it('starts on the Full preset; startup and connect are locked rows', () => {
    setup();
    goInstallOnly();
    expect(screen.queryByTestId('io-preset-custom')).toBeNull();
    expect((screen.getByTestId('io-connect') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('io-connect') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('io-startup') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('io-startup') as HTMLInputElement).checked).toBe(true);
  });

  it('blocks Preview and Save until the run length is entered', async () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Full name or company'), { target: { value: 'Jane' } });
    goInstallOnly();
    expect(screen.getByTestId('io-issues')).toBeTruthy();
    expect((screen.getByTestId('preview-btn') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Save to Pipeline'));
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('io-runft'), { target: { value: '40' } });
    expect(screen.queryByTestId('io-issues')).toBeNull();
    expect((screen.getByTestId('preview-btn') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Save to Pipeline'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.form_data.jobType).toBe('install-only');
    expect(body.form_data.installOnly.runFt).toBe(40);
    expect(body.totals_data.genP).toBe(0);
  });

  it('presets set the checkboxes; Custom shows after a manual change', () => {
    setup();
    goInstallOnly();
    fireEvent.click(screen.getByTestId('io-preset-wire-pull'));
    expect((screen.getByTestId('io-set-generator') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('io-permit') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('io-ats-existing') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('io-conduit-wire-only') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('io-pad')).toBeNull();
    fireEvent.click(screen.getByTestId('io-gas'));
    // gas is not part of a preset, so still wire-pull; permit toggles to custom
    fireEvent.click(screen.getByTestId('io-permit'));
    expect(screen.getByTestId('io-preset-custom')).toBeTruthy();
  });

  it('unchecking Set generator clears pad, stand and lift', () => {
    setup();
    goInstallOnly();
    fireEvent.change(screen.getByTestId('io-genstand'), { target: { value: 'big' } });
    fireEvent.change(screen.getByTestId('io-lift'), { target: { value: 'crane' } });
    fireEvent.click(screen.getByTestId('io-set-generator'));
    expect(screen.queryByTestId('io-genstand')).toBeNull();
    fireEvent.click(screen.getByTestId('io-set-generator'));
    expect((screen.getByTestId('io-genstand') as HTMLSelectElement).value).toBe('none');
    expect((screen.getByTestId('io-lift') as HTMLSelectElement).value).toBe('none');
    expect((screen.getByTestId('io-pad') as HTMLInputElement).checked).toBe(false);
  });

  it('prices prefill from Settings and a per-proposal edit changes the total', async () => {
    setup({ gen_io_connect: '500', gen_io_permit: '525' });
    fireEvent.change(screen.getByPlaceholderText('Full name or company'), { target: { value: 'Jane' } });
    goInstallOnly();
    fireEvent.change(screen.getByTestId('io-runft'), { target: { value: '10' } });
    expect(num('io-price-connect').value).toBe('500');
    expect(num('io-price-permit').value).toBe('525');
    expect(num('io-price-setGenAC').value).toBe(String(DEFAULT_PRICES.installOnly.setGenAC));
    fireEvent.change(num('io-price-connect'), { target: { value: '0' } });
    fireEvent.change(num('io-price-conduitPerFt'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Save to Pipeline'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const { form_data, totals_data } = post.mock.calls[0][1];
    expect(form_data.installOnly.prices.connect).toBe(0);
    expect(form_data.installOnly.prices.conduitPerFt).toBe(50);
    expect(form_data.permit).toBe(525);
    expect(totals_data.ioConnectAmt).toBe(0);
    expect(totals_data.ioConduitAmt).toBe(DEFAULT_PRICES.installOnly.conduitBase + 10 * 50);
    expect(totals_data.total).toBe(calcGenTotals(form_data).total);
  });

  it('hides the benchmark flag for install-only', async () => {
    get.mockResolvedValue({ data: [{ kw: 14, avgAmount: 100, avgPerKw: 7, count: 5 }] });
    setup();
    goInstallOnly();
    await Promise.resolve();
    expect(screen.queryByText(/above avg|below avg/)).toBeNull();
  });
});

describe('genToForm — lead-converted install-only', () => {
  it('applies install-only defaults when the saved form has no scope or labor', () => {
    const gen = { form_data: { jobType: 'install-only', customer: 'Lead', brand: 'Kohler', coolingType: 'air-cooled', size: '14KW' } } as unknown as Gen;
    const f = genToForm(gen, { gen_io_permit: '510' });
    expect(f.labor).toBe(0);
    expect(f.permit).toBe(510);
    expect(f.installOnly.setGenerator).toBe(true);
  });
  it('leaves a complete saved install-only form alone', () => {
    const gen = { form_data: { jobType: 'install-only', labor: 125, permit: 300, installOnly: { conduit: 'wire-only', runFt: 9 } } } as unknown as Gen;
    const f = genToForm(gen);
    expect(f.labor).toBe(125);
    expect(f.permit).toBe(300);
    expect(f.installOnly.conduit).toBe('wire-only');
    expect(f.installOnly.runFt).toBe(9);
  });
});
