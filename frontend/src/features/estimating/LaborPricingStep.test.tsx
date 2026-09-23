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
import { DEFAULT_SETTINGS, EstimateLine, EstimateSettings, PricingRecap, EMPTY_RECAP, Library } from './types';

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
  return { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0 };
}

function makeRecap(): PricingRecap {
  return {
    ...EMPTY_RECAP,
    lines: [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', materialUnit: 6, materialExt: 60, hoursUnit: 0.35, hoursExt: 3.5, laborExt: 140, confidence: null, excluded: false, directShare: 200, matchConfidence: null, unresolved: false }],
    categories: [{ category: 'Branch Power', material: 60, hours: 3.5, labor: 140, subtotal: 200 }],
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

describe('LaborPricingStep — N3: floors above 2', () => {
  it('editing the floors-above-2 field calls setSettings with the new value', async () => {
    const setSettings = vi.fn();
    render(
      <LaborPricingStep lines={[]} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={setSettings} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const input = await screen.findByTestId('lp-floors-above-2');
    fireEvent.change(input, { target: { value: '4' } });
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    expect(updater(baseSettings()).floors_above_2).toBe(4);
  });
});

describe('LaborPricingStep — R2-N1: clearing a rate/pct input reverts to its default, not 0', () => {
  it('clearing Labor rate reverts to DEFAULT_SETTINGS.labor_rate, not 0', async () => {
    const setSettings = vi.fn();
    render(
      <LaborPricingStep lines={[]} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={setSettings} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const input = screen.getByDisplayValue('40') as HTMLInputElement; // labor_rate
    fireEvent.change(input, { target: { value: '' } });
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    expect(updater(baseSettings()).labor_rate).toBe(DEFAULT_SETTINGS.labor_rate);
    expect(updater(baseSettings()).labor_rate).not.toBe(0);
  });

  it('clearing a pct field (e.g. Overhead %) reverts to its own default, not 0', async () => {
    const setSettings = vi.fn();
    render(
      <LaborPricingStep lines={[]} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={setSettings} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const input = screen.getByDisplayValue('10') as HTMLInputElement; // overhead_pct
    fireEvent.change(input, { target: { value: '' } });
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    expect(updater(baseSettings()).overhead_pct).toBe(DEFAULT_SETTINGS.overhead_pct);
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

  it('"Keep as manual line" is disabled until a material $ or labor hours value is entered (S7)', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Some unmatched thing', qty: 1, unit: 'EA', source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-resolve-0'));
    const keepManualBtn = await screen.findByTestId('lp-resolver-keep-manual') as HTMLButtonElement;
    expect(keepManualBtn.disabled).toBe(true);
    fireEvent.click(keepManualBtn); // clicking a disabled button is a no-op
    expect(setLines).not.toHaveBeenCalled();
  });

  it('"Keep as manual line" clears the takeoff source into a manual override line once a value is entered', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Some unmatched thing', qty: 1, unit: 'EA', source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-resolve-0'));
    fireEvent.change(await screen.findByTestId('lp-resolver-manual-material'), { target: { value: '25' } });
    const keepManualBtn = await screen.findByTestId('lp-resolver-keep-manual') as HTMLButtonElement;
    expect(keepManualBtn.disabled).toBe(false);
    fireEvent.click(keepManualBtn);
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const result = updater(lines);
    expect(result[0].source).toBe('manual');
    expect(result[0].material_unit_override).toBe(25);
  });
});

describe('LaborPricingStep — R2-SF2: resolver only offers unit-compatible candidates', () => {
  it('never offers an EA item/assembly to an LF line', async () => {
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Conduit run', qty: 100, unit: 'LF', source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-resolve-0'));
    await screen.findByTestId('lp-resolver-search');
    expect(screen.queryByTestId('lp-resolver-candidate-i1')).toBeNull(); // i1 is EA
    expect(screen.queryByTestId('lp-resolver-candidate-a1')).toBeNull(); // a1 is EA
  });

  it('requires the estimator to pick a real unit first for an LS/unknown-unit line, and hides the candidate list until then', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Allowance', qty: 1, unit: 'LS' as EstimateLine['unit'], source: 'takeoff' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={{ ...EMPTY_RECAP }} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-resolve-0'));
    expect(screen.queryByTestId('lp-resolver-search')).toBeNull(); // no candidate search until a unit is chosen
    const unitSelect = await screen.findByTestId('lp-resolver-unit-select');
    fireEvent.change(unitSelect, { target: { value: 'EA' } });
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    expect(updater(lines)[0].unit).toBe('EA');
  });
});

describe('LaborPricingStep — R2-SF1: fuzzy match badge', () => {
  it('shows a "check match" badge on a line matched only at fuzzy confidence', async () => {
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'takeoff', match_confidence: 'fuzzy' }];
    const recap: PricingRecap = {
      ...EMPTY_RECAP,
      lines: [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', materialUnit: 6, materialExt: 60, hoursUnit: 0.35, hoursExt: 3.5, laborExt: 140, confidence: null, excluded: false, directShare: 200, matchConfidence: 'fuzzy', unresolved: false }],
      categories: [{ category: 'Branch Power', material: 60, hours: 3.5, labor: 140, subtotal: 200 }],
    };
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={recap} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    expect(await screen.findByTestId('lp-fuzzy-badge-0')).toBeTruthy();
  });

  it('does not show the fuzzy badge for an exact match', async () => {
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'takeoff', match_confidence: 'exact' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={makeRecap()} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    await screen.findByTestId('lp-row-0');
    expect(screen.queryByTestId('lp-fuzzy-badge-0')).toBeNull();
  });
});

describe('LaborPricingStep — R2-N2: locked-qty hint', () => {
  it('shows a hint on a line whose qty was hand-edited (qty_overridden)', async () => {
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 12, unit: 'EA', item_id: 'i1', source: 'takeoff', qty_overridden: true }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={makeRecap()} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    expect(await screen.findByTestId('lp-qty-locked-hint-0')).toBeTruthy();
  });

  it('shows no hint when qty was never hand-edited', async () => {
    const { } = renderStep();
    await screen.findByTestId('lp-row-0');
    expect(screen.queryByTestId('lp-qty-locked-hint-0')).toBeNull();
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

describe('LaborPricingStep — B2: null-safe rendering', () => {
  it('renders "—" instead of crashing when a recap line has no priced entry', async () => {
    const lines: EstimateLine[] = [{ id: 'unpriced', category: 'Branch Power', description: 'No recap yet', qty: 1, unit: 'EA', source: 'manual' }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const row = await screen.findByTestId('lp-row-0');
    expect(row.textContent).toContain('—');
  });
});

describe('LaborPricingStep — S7: clearing an override reverts to the library value (null), not 0', () => {
  it('clearing the material override field sets it to null, not 0', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual', material_unit_override: 12 }];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={makeRecap()} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const input = (await screen.findByTestId('lp-row-0')).querySelector('input[data-field="material_unit_override"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    expect(updater(lines)[0].material_unit_override).toBeNull();
  });
});

describe('LaborPricingStep — N8: delete a manual line with Undo', () => {
  it('deletes the manual line and Undo restores it at the same position', async () => {
    const setLines = vi.fn();
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Branch Power', description: 'Row 1', qty: 1, unit: 'EA', source: 'manual' },
      { id: 'l2', category: 'Branch Power', description: 'Row 2 (to delete)', qty: 2, unit: 'EA', source: 'manual' },
    ];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    fireEvent.click(await screen.findByTestId('lp-delete-1'));
    const deleteUpdater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const afterDelete = deleteUpdater(lines);
    expect(afterDelete.length).toBe(1);
    expect(afterDelete.find(l => l.id === 'l2')).toBeUndefined();

    const undoBtn = await screen.findByTestId('lp-undo-delete');
    fireEvent.click(undoBtn);
    const undoUpdater = setLines.mock.calls[1][0] as (prev: EstimateLine[]) => EstimateLine[];
    const afterUndo = undoUpdater(afterDelete);
    expect(afterUndo.length).toBe(2);
    expect(afterUndo[1].id).toBe('l2');
  });
});

describe('LaborPricingStep — N8: sync failure shows an error toast', () => {
  it('shows an error toast (not a silent failure) when syncTakeoff rejects', async () => {
    const showToast = vi.fn();
    const syncTakeoff = vi.fn().mockRejectedValue(new Error('network down'));
    const lines: EstimateLine[] = [];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={syncTakeoff} showToast={showToast} />
    );
    fireEvent.click(screen.getByTestId('lp-sync-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync failed', variant: 'error' })));
  });
});

describe('LaborPricingStep — B5: sync-takeoff confirms when there are unsaved edits', () => {
  it('does not call syncTakeoff when dirty=true and confirmation is declined (no ConfirmProvider = auto-decline)', async () => {
    const syncTakeoff = vi.fn().mockResolvedValue({ added: 0, updated: 0, vanished: 0 });
    const lines: EstimateLine[] = [];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        dirty
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={syncTakeoff} />
    );
    fireEvent.click(screen.getByTestId('lp-sync-button'));
    await new Promise(r => setTimeout(r, 0));
    expect(syncTakeoff).not.toHaveBeenCalled();
  });

  it('calls syncTakeoff immediately when dirty is false/absent — no confirmation needed', async () => {
    const syncTakeoff = vi.fn().mockResolvedValue({ added: 0, updated: 0, vanished: 0 });
    const lines: EstimateLine[] = [];
    render(
      <LaborPricingStep lines={lines} settings={baseSettings()} recap={EMPTY_RECAP} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={syncTakeoff} />
    );
    fireEvent.click(screen.getByTestId('lp-sync-button'));
    await waitFor(() => expect(syncTakeoff).toHaveBeenCalled());
  });
});
