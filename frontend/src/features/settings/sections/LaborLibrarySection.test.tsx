// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { AppProviders } from '../../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../../hooks/useAppSettings';
import type { Toast } from '../../../types';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: (...a: unknown[]) => post(...a) } };
});

import { LaborLibrarySection } from './LaborLibrarySection';

afterEach(cleanup);

const library = {
  items: [{ id: 'i1', code: 'DEV-DUP', name: 'Duplex receptacle', category: 'Branch Power', unit: 'EA', material_cost: 6, material_price_date: null, labor_hours: 0.35, aliases: [], source: 'seed', active: true }],
  assemblies: [{ id: 'a1', code: 'ASM-DUPLEX', name: 'Duplex circuit', category: 'Branch Power', unit: 'EA', aliases: [], source: 'seed', active: true, components: [] }],
  factors: [{ id: 'f1', code: 'HEIGHT-10-14', label: 'Height 10-14', pct: 10, group_key: 'height', active: true }],
};

beforeEach(() => {
  get.mockReset(); put.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/estimating/library') return Promise.resolve({ data: library });
    if (url === '/estimating/calibration') {
      return Promise.resolve({
        data: {
          bids: [{ bidId: 'b1', bidName: 'Test Bid', engineHours: 120, accubidHours: 100, ratio: 1.2 }],
          overallRatio: 1.2,
          suggestedGlobalAdjustmentPct: 20,
          categoryGaps: [{ category: 'Branch Power', totalEngineHours: 120, suggestedAdjustmentPct: 20 }],
        },
      });
    }
    return Promise.resolve({ data: null });
  });
  put.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: { updatedCount: 1 } });
});

function setup(showToast: (t: Toast) => void = () => {}) {
  render(
    <AppProviders
      user={{ id: 'u1', name: 'Test User', email: 't@test.local', role: 'owner' }}
      showToast={showToast}
      settings={DEFAULT_APP_SETTINGS}
      reloadSettings={() => {}}
    >
      <ConfirmProvider>
        <LaborLibrarySection settings={DEFAULT_APP_SETTINGS} onSaved={vi.fn()} />
      </ConfirmProvider>
    </AppProviders>,
  );
}

describe('LaborLibrarySection — Items: edit + save round-trip', () => {
  it('editing material cost and blurring PUTs the item with the new value', async () => {
    setup();
    const input = await screen.findByTestId('ll-item-material-i1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.blur(input);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/library/items/i1', { material_cost: 12.5 }));
  });

  it('editing labor hours and blurring PUTs the item with the new value', async () => {
    setup();
    const input = await screen.findByTestId('ll-item-hours-i1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/library/items/i1', { labor_hours: 0.5 }));
  });

  it('does not PUT when a field is blurred unchanged', async () => {
    setup();
    const input = await screen.findByTestId('ll-item-material-i1') as HTMLInputElement;
    fireEvent.blur(input);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('LaborLibrarySection — Items: deactivate / undo', () => {
  it('deactivating an item requires confirmation, then PUTs active:false and shows an Undo banner', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('ll-item-deactivate-i1'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/library/items/i1', { active: false }));
    expect(await screen.findByTestId('ll-item-undo')).toBeTruthy();
  });

  it('Cancel on the confirm dialog never calls PUT', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('ll-item-deactivate-i1'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(put).not.toHaveBeenCalled();
  });

  it('clicking Undo reactivates the item', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('ll-item-deactivate-i1'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    fireEvent.click(await screen.findByTestId('ll-item-undo'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/library/items/i1', { active: true }));
  });
});

describe('LaborLibrarySection — Calibration: apply payload', () => {
  it('applying the global suggestion posts scope=global with the report\'s suggested pct', async () => {
    setup();
    fireEvent.click(screen.getByTestId('ll-subtab-calibration'));
    const btn = await screen.findByTestId('ll-apply-global');
    fireEvent.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/calibration/apply', { scope: 'global', category: undefined, adjustmentPct: 20 }));
  });

  it('applying a category suggestion posts scope=category with that category and its own pct', async () => {
    setup();
    fireEvent.click(screen.getByTestId('ll-subtab-calibration'));
    const btn = await screen.findByTestId('ll-apply-category-Branch Power');
    fireEvent.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/calibration/apply', { scope: 'category', category: 'Branch Power', adjustmentPct: 20 }));
  });

  it('B4: shows a success toast naming how many items were updated', async () => {
    post.mockResolvedValueOnce({ data: { updatedCount: 3 } });
    const showToast = vi.fn();
    setup(showToast);
    fireEvent.click(screen.getByTestId('ll-subtab-calibration'));
    const btn = await screen.findByTestId('ll-apply-global');
    fireEvent.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ sub: expect.stringContaining('3 items updated') })
    ));
  });

  it('B4: a 0-rows-changed failure (server 400) shows an error toast, not a silent success', async () => {
    post.mockReset();
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'No active items found in category "Branch Power" — nothing was adjusted' } } });
    const showToast = vi.fn();
    setup(showToast);
    fireEvent.click(screen.getByTestId('ll-subtab-calibration'));
    const btn = await screen.findByTestId('ll-apply-category-Branch Power');
    fireEvent.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error' })
    ));
  });
});

describe('LaborLibrarySection — Defaults', () => {
  it('renders the current defaults and enables Save only once a value is edited', async () => {
    setup();
    fireEvent.click(screen.getByTestId('ll-subtab-defaults'));
    const input = await screen.findByTestId('ll-default-est_default_labor_rate') as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_APP_SETTINGS.est_default_labor_rate);
    const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '45' } });
    expect(saveBtn.disabled).toBe(false);
  });

  // Fix round 1 / B8 — Decision 7's drops/slack defaults were seeded in
  // the DB (migration 108) but never reachable from this screen at all.
  it('renders and saves the drops/slack defaults (Fix round 1 / B8)', async () => {
    setup();
    fireEvent.click(screen.getByTestId('ll-subtab-defaults'));
    const dropInput = await screen.findByTestId('ll-default-est_default_drop_ft') as HTMLInputElement;
    const slackInput = screen.getByTestId('ll-default-est_default_slack_pct') as HTMLInputElement;
    expect(dropInput.value).toBe(DEFAULT_APP_SETTINGS.est_default_drop_ft);
    expect(slackInput.value).toBe(DEFAULT_APP_SETTINGS.est_default_slack_pct);

    fireEvent.change(dropInput, { target: { value: '15' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/settings', expect.objectContaining({ est_default_drop_ft: '15' })));
  });
});
