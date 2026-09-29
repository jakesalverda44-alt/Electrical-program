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

import { FootageRatiosPanel, parseJsonSetting, FOOTAGE_DEFAULTS } from './EstimatingRuleSettings';

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

  it('saves one merged JSON value; a negative entry keeps the current number', async () => {
    setup();
    fireEvent.change(screen.getByTestId('footage-ratios-mcPerFixture'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('footage-ratios-wire10Share'), { target: { value: '40' } });
    fireEvent.change(screen.getByTestId('footage-ratios-pvcSitePerPole'), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/settings');
    const saved = JSON.parse(body.est_footage_ratios);
    expect(saved.mcPerFixture).toBe(9);
    expect(saved.wire10Share).toBeCloseTo(0.4, 9);
    expect(saved.pvcSitePerPole).toBe(130);
    expect(saved.emtPerPoint).toEqual({ fixture: 6.6, device: 6.6, equipment: 6.6 });
  });

  it('parseJsonSetting falls back to the defaults on bad JSON', () => {
    expect(parseJsonSetting('{bad', FOOTAGE_DEFAULTS)).toEqual(FOOTAGE_DEFAULTS);
  });
});
