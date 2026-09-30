// @vitest-environment happy-dom
// Remodel + footage round — the footage-ratio editor saves one merged JSON
// setting; a blank or negative field keeps its current value.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders } from '../../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../../hooks/useAppSettings';

const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: vi.fn(), put: (...a: unknown[]) => put(...a), post: vi.fn() } };
});

import { FootageRatiosPanel, parseJsonSetting, FOOTAGE_DEFAULTS, BoxFittingAllowancePanel } from './EstimatingRuleSettings';

afterEach(cleanup);
beforeEach(() => { put.mockReset(); put.mockResolvedValue({ data: {} }); });

function setup(stored?: string) {
  const settings = { ...DEFAULT_APP_SETTINGS, est_footage_ratios: stored };
  render(
    <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={settings} reloadSettings={() => {}}>
      <FootageRatiosPanel settings={settings} onSaved={vi.fn()} />
    </AppProviders>,
  );
}

describe('FootageRatiosPanel', () => {
  it('shows the stored ratios over the defaults (share as %)', () => {
    setup(JSON.stringify({ emtPerPoint: { device: 12 }, wire10Share: 0.5 }));
    expect((screen.getByTestId('footage-ratios-emtPerPoint.device') as HTMLInputElement).value).toBe('12');
    expect((screen.getByTestId('footage-ratios-emtPerPoint.fixture') as HTMLInputElement).value).toBe('6.6');
    expect((screen.getByTestId('footage-ratios-wire10Share') as HTMLInputElement).value).toBe('50');
  });

  it('saves one merged JSON value', async () => {
    setup();
    fireEvent.change(screen.getByTestId('footage-ratios-mcPerFixture'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('footage-ratios-wire10Share'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/settings');
    const saved = JSON.parse(body.est_footage_ratios);
    expect(saved.mcPerFixture).toBe(9);
    expect(saved.wire10Share).toBeCloseTo(0.4, 9);
    expect(saved.pvcSitePerPole).toBe(130);
    expect(saved.emtPerPoint).toEqual({ fixture: 6.6, device: 6.6, equipment: 6.6 });
    await waitFor(() => expect(screen.getByText('✓ Saved')).toBeTruthy());
  });

  it('SF-4: a negative / blank / >100% field shows an error and blocks the save — never a false "Saved"', async () => {
    setup();
    fireEvent.change(screen.getByTestId('footage-ratios-pvcSitePerPole'), { target: { value: '-5' } });
    fireEvent.change(screen.getByTestId('footage-ratios-mcPerFixture'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('footage-ratios-wire10Share'), { target: { value: '150' } });
    expect(screen.getByTestId('footage-ratios-pvcSitePerPole-error').textContent).toBe('Must be 0 or more');
    expect(screen.getByTestId('footage-ratios-mcPerFixture-error').textContent).toBe('Enter a number');
    expect(screen.getByTestId('footage-ratios-wire10Share-error').textContent).toBe('Must be 100% or less');
    expect(screen.getByTestId('footage-ratios-blocked')).toBeTruthy();
    fireEvent.click(screen.getByText('Save Changes'));
    await new Promise(r => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
    expect(screen.queryByText('✓ Saved')).toBeNull();
  });

  it('SF-4: a server 400 never shows "Saved"', async () => {
    put.mockRejectedValueOnce(Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: 'est_footage_ratios: mcPerFixture must be at least 0' } } }));
    setup();
    fireEvent.change(screen.getByTestId('footage-ratios-mcPerFixture'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('✓ Saved')).toBeNull();
  });

  it('parseJsonSetting falls back to the defaults on bad JSON', () => {
    expect(parseJsonSetting('{bad', FOOTAGE_DEFAULTS)).toEqual(FOOTAGE_DEFAULTS);
  });
});

describe('BoxFittingAllowancePanel (price accuracy C3)', () => {
  it('shows on + scale 1 by default and saves one merged JSON value', async () => {
    const settings = { ...DEFAULT_APP_SETTINGS, est_box_fitting_allowance: JSON.stringify({ scale: { hardware: 0.8 } }) };
    render(
      <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={settings} reloadSettings={() => {}}>
        <BoxFittingAllowancePanel settings={settings} onSaved={vi.fn()} />
      </AppProviders>,
    );
    expect((screen.getByTestId('box-fitting-allowance-enabled') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('box-fitting-allowance-scale.hardware') as HTMLInputElement).value).toBe('0.8');
    fireEvent.change(screen.getByTestId('box-fitting-allowance-scale.box'), { target: { value: '1.2' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const saved = JSON.parse(put.mock.calls[0][1].est_box_fitting_allowance);
    expect(saved).toMatchObject({ enabled: 1, scale: { box: 1.2, fittings: 1, hardware: 0.8 } });
  });
});
