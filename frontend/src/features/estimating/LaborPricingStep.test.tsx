// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a) } };
});

import { LaborPricingStep } from './LaborPricingStep';
import { EstimateLine, EstimateSettings, PricingRecap, EMPTY_RECAP, Library } from './types';

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  const library: Library = {
    items: [{ id: 'i1', code: 'DEV-DUP', name: 'Duplex receptacle', category: 'Branch Power', unit: 'EA', material_cost: 6, material_price_date: null, labor_hours: 0.35, aliases: [], source: 'seed', active: true }],
    assemblies: [{ id: 'a1', code: 'ASM-DUPLEX', name: 'Duplex circuit', category: 'Branch Power', unit: 'EA', aliases: [], source: 'seed', active: true, components: [] }],
    factors: [
      { id: 'f1', code: 'HEIGHT-10-14', label: 'Height 10-14', pct: 10, group_key: 'height', active: true },
      { id: 'f2', code: 'HEIGHT-20-PLUS', label: 'Height 20+', pct: 35, group_key: 'height', active: true },
    ],
  };
  get.mockResolvedValue({ data: library });
});

function baseSettings(): EstimateSettings {
  return { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 };
}

function makeRecap(): PricingRecap {
  return {
    ...EMPTY_RECAP,
    lines: [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', materialUnit: 6, materialExt: 60, hoursUnit: 0.35, hoursExt: 3.5, laborExt: 140, confidence: null, excluded: false }],
    categories: [{ category: 'Branch Power', material: 60, hours: 3.5, labor: 140 }],
  };
}

function renderStep(overrides: Partial<Parameters<typeof LaborPricingStep>[0]> = {}) {
  const setLines = vi.fn();
  const setSettings = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const syncTakeoff = vi.fn().mockResolvedValue({ added: 1, updated: 0, vanished: 0 });
  const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' }];
  render(
    <LaborPricingStep
      lines={lines}
      settings={baseSettings()}
      recap={makeRecap()}
      saving={false}
      syncing={false}
      saveError={null}
      setLines={setLines}
      setSettings={setSettings}
      save={save}
      syncTakeoff={syncTakeoff}
      {...overrides}
    />
  );
  return { setLines, setSettings, save, syncTakeoff };
}

describe('LaborPricingStep — renders from a recap fixture', () => {
  it('renders the priced line with its extended material/hours/labor values', async () => {
    renderStep();
    const row = await waitFor(() => screen.getByTestId('lp-row-0'));
    expect(row.textContent).toContain('60.00'); // materialExt
    expect(row.textContent).toContain('3.50');  // hoursExt
    expect(row.textContent).toContain('140.00'); // laborExt
  });

  it('renders category subtotals in the group header', async () => {
    renderStep();
    await waitFor(() => expect(screen.getByText(/Branch Power/).textContent).toContain('60 mat / 140 labor'));
  });
});

describe('LaborPricingStep — override edit', () => {
  it('editing the material override calls setLines with the new value', async () => {
    const { setLines } = renderStep();
    await waitFor(() => screen.getByTestId('lp-row-0'));
    const input = screen.getByTestId('lp-row-0').querySelector('input[data-field="material_unit_override"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    expect(setLines).toHaveBeenCalled();
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const result = updater([{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'manual' }]);
    expect(result[0].material_unit_override).toBe(99);
  });

  it('a "reset to library" button appears on an overridden cell and clears the override', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', material_unit_override: 99, source: 'manual' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={makeRecap()} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    await waitFor(() => screen.getByTestId('lp-row-0'));
    const resetBtn = screen.getByText('reset');
    fireEvent.click(resetBtn);
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    expect(updater(lines)[0].material_unit_override).toBeNull();
  });
});

describe('LaborPricingStep — exclude', () => {
  it('checking exclude calls setLines with excluded: true', async () => {
    const { setLines } = renderStep();
    await waitFor(() => screen.getByTestId('lp-exclude-0'));
    fireEvent.click(screen.getByTestId('lp-exclude-0'));
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const result = updater([{ id: 'l1', category: 'Branch Power', description: 'x', qty: 1, unit: 'EA', source: 'manual' }]);
    expect(result[0].excluded).toBe(true);
  });
});

describe('LaborPricingStep — unmatched banner and resolver pick', () => {
  it('shows the unmatched banner for a takeoff line with no assembly/item, and resolving it picks a candidate', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Some unmatched thing', qty: 1, unit: 'EA', source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    expect(await screen.findByTestId('lp-unmatched-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('lp-resolve-0'));
    const candidate = await screen.findByTestId('lp-resolver-candidate-i1');
    fireEvent.click(candidate);

    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const result = updater(lines);
    expect(result[0].item_id).toBe('i1');
    expect(result[0].assembly_id).toBeFalsy();
  });

  it('"Keep as manual line" clears the takeoff source into a manual override line', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Some unmatched thing', qty: 1, unit: 'EA', source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-resolve-0'));
    fireEvent.click(await screen.findByTestId('lp-resolver-keep-manual'));
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    expect(updater(lines)[0].source).toBe('manual');
  });
});

describe('LaborPricingStep — save', () => {
  it('clicking Save calls the save() callback', async () => {
    const { save } = renderStep();
    fireEvent.click(screen.getByTestId('lp-save-button'));
    expect(save).toHaveBeenCalled();
  });

  it('disables Save while saving and shows a save error when present', () => {
    renderStep({ saving: true, saveError: 'Network error' });
    expect((screen.getByTestId('lp-save-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('lp-save-error').textContent).toBe('Network error');
  });
});

describe('LaborPricingStep — sync from takeoff', () => {
  it('clicking Sync calls syncTakeoff and reports the toast', async () => {
    const showToast = vi.fn();
    const { syncTakeoff } = renderStep({ showToast });
    fireEvent.click(screen.getByTestId('lp-sync-button'));
    expect(syncTakeoff).toHaveBeenCalled();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Synced from takeoff' })));
  });
});

describe('LaborPricingStep — keyboard', () => {
  it('Enter in a qty cell moves focus to the same column in the next row', async () => {
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Branch Power', description: 'Row 1', qty: 1, unit: 'EA', source: 'manual' },
      { id: 'l2', category: 'Branch Power', description: 'Row 2', qty: 2, unit: 'EA', source: 'manual' },
    ];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    await waitFor(() => screen.getByTestId('lp-row-0'));
    const qty0 = screen.getByTestId('lp-row-0').querySelector('input[data-field="qty"]') as HTMLInputElement;
    const qty1 = screen.getByTestId('lp-row-1').querySelector('input[data-field="qty"]') as HTMLInputElement;
    qty0.focus();
    fireEvent.keyDown(qty0, { key: 'Enter' });
    expect(document.activeElement).toBe(qty1);
  });
});

describe('LaborPricingStep — factor chips', () => {
  it('selecting a factor in a group deselects any other factor in the same group (mutual exclusivity)', async () => {
    const setSettings = vi.fn();
    const lines: EstimateLine[] = [];
    render(
      <LaborPricingStep lines={lines} settings={{ ...baseSettings(), factor_ids: ['f1'] }} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={setSettings} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const chip = await screen.findByTestId('lp-factor-HEIGHT-20-PLUS');
    fireEvent.click(chip);
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    const result = updater({ ...baseSettings(), factor_ids: ['f1'] });
    expect(result.factor_ids).toEqual(['f2']);
  });
});
