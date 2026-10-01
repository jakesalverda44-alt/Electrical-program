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
import { DEFAULT_SETTINGS, DEFAULT_ACCUBID_SETTINGS, EMPTY_ACCUBID_RECAP, EstimateLine, EstimateSettings, PricingRecap, EMPTY_RECAP, Library } from './types';
import { ConfirmProvider } from '../../components/ConfirmDialog';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
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

function renderStep(overrides: Partial<Parameters<typeof LaborPricingStep>[0]> = {}, wrapper?: (children: React.ReactNode) => React.ReactElement) {
  const setLines = vi.fn();
  const setSettings = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const syncTakeoff = vi.fn().mockResolvedValue({ added: 1, updated: 0, vanished: 0 });
  const lines: EstimateLine[] = [{ id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' }];
  const el = (
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
  render(wrapper ? wrapper(el) : el);
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

describe('LaborPricingStep — Review round 2 / S17: pricing-mode switch and shared factors', () => {
  it('floors-above-2 and the factor chips render in ACCUBID mode too — they used to be hidden entirely', async () => {
    // bidId omitted -> AccubidPricingPanel itself doesn't mount (its own
    // network calls are out of scope here); this isolates the assertion to
    // LaborPricingStep's own JSX, which is what used to hide these.
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' } });
    expect(await screen.findByTestId('lp-floors-above-2')).toBeTruthy();
    expect(await screen.findByTestId('lp-factor-chips')).toBeTruthy();
    expect(screen.getByTestId('lp-factor-HEIGHT-10-14')).toBeTruthy();
  });

  it('shows the current mode and a button to switch to the other one', async () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' } });
    const row = await screen.findByTestId('lp-pricing-mode-row');
    expect(row.textContent).toContain('Accubid');
    expect(screen.getByTestId('lp-switch-pricing-mode').textContent).toContain('Quick pricing');
  });

  it('phase_a mode reads "Quick pricing" (never "Phase A") in the mode row; stored value stays phase_a', async () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'phase_a' } });
    const row = await screen.findByTestId('lp-pricing-mode-row');
    expect(row.textContent).toContain('Quick pricing');
    expect(row.textContent).not.toContain('Phase A');
  });

  it('declining the confirm (no ConfirmProvider = auto-decline) never switches mode or saves', async () => {
    const { setSettings, save } = renderStep({ settings: { ...baseSettings(), pricing_mode: 'phase_a' } });
    fireEvent.click(await screen.findByTestId('lp-switch-pricing-mode'));
    await waitFor(() => {}); // let the declined promise settle
    expect(setSettings).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('confirming the switch flips pricing_mode and saves immediately (B4: re-persists the price right away)', async () => {
    const { setSettings, save } = renderStep(
      { settings: { ...baseSettings(), pricing_mode: 'phase_a' } },
      (children) => <ConfirmProvider>{children}</ConfirmProvider>,
    );
    fireEvent.click(await screen.findByTestId('lp-switch-pricing-mode'));
    fireEvent.click(await screen.findByText('Confirm'));
    await waitFor(() => expect(setSettings).toHaveBeenCalled());
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    expect(updater(baseSettings()).pricing_mode).toBe('accubid');
    await waitFor(() => expect(save).toHaveBeenCalled());
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

// Fix round 1 / S7 — before this fix, hand-editing a markup-applied line's
// qty set qty_overridden but left qty_source alone at 'markup', so
// composeBidData.ts's "Applied" chip and the items panel's "not verified
// on plans" count both kept treating the hand-typed number as
// plan-confirmed.
describe('LaborPricingStep — S7: hand-editing qty sets qty_source to "manual"', () => {
  it('editing a plan-applied line\'s qty stamps qty_source: "manual" (no longer presented as plan-confirmed)', async () => {
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'takeoff', qty_source: 'markup' },
    ];
    const { setLines } = renderStep({ lines });
    const qty0 = screen.getByTestId('lp-row-0').querySelector('input[data-field="qty"]') as HTMLInputElement;

    fireEvent.change(qty0, { target: { value: '15' } });

    expect(setLines).toHaveBeenCalledTimes(1);
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const result = updater(lines);
    expect(result[0].qty).toBe(15);
    expect(result[0].qty_overridden).toBe(true);
    expect(result[0].qty_source).toBe('manual');
  });

  it('editing a plain takeoff-sourced line (no prior qty_source) also stamps "manual"', async () => {
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'takeoff' },
    ];
    const { setLines } = renderStep({ lines });
    const qty0 = screen.getByTestId('lp-row-0').querySelector('input[data-field="qty"]') as HTMLInputElement;

    fireEvent.change(qty0, { target: { value: '7' } });

    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    expect(updater(lines)[0].qty_source).toBe('manual');
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

describe('next round A7 — a possible duplicate blocks the save until resolved', () => {
  const RUN = '11111111-2222-3333-4444-555555555555';
  const kept: EstimateLine = { id: 'k', line_key: 'K', category: 'Branch Power', description: 'Duplex receptacle', qty: 34, unit: 'EA', item_id: 'i1', source: 'takeoff', recheck_run_id: RUN, recheck_reason: 'no_confident_match' };
  const fresh: EstimateLine = { id: 'n', line_key: 'N', category: 'Branch Power', description: 'Duplex receptacle, 20A', qty: 30, unit: 'EA', item_id: 'i1', source: 'takeoff' };
  const dup = { keptKey: 'K', keptDescription: 'Duplex receptacle', keptQty: 34, newKey: 'N', newDescription: 'Duplex receptacle, 20A', newQty: 30, category: 'Branch Power', unit: 'EA' };

  it('shows the pair, disables Save, hides "checked" on the kept line; remove-the-new-line drops it', () => {
    const { setLines } = renderStep({ lines: [kept, fresh], duplicates: [dup] });
    expect(screen.getByTestId('lp-duplicates').textContent).toContain('“Duplex receptacle” (34 EA, kept from the previous run) and “Duplex receptacle, 20A” (30 EA, new takeoff line)');
    expect((screen.getByTestId('lp-save-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('lp-recheck-done-0')).toBeNull();
    fireEvent.click(screen.getByTestId('lp-dup-remove-new'));
    const updater = setLines.mock.calls[setLines.mock.calls.length - 1][0] as (p: EstimateLine[]) => EstimateLine[];
    // Fix round S10 — excluded (a tombstone sync keeps), not deleted.
    expect(updater([kept, fresh]).map(l => [l.line_key, !!l.excluded])).toEqual([['K', false], ['N', true]]);
  });

  it('keep both needs a real reason and records it on the kept line', () => {
    const { setLines } = renderStep({ lines: [kept, fresh], duplicates: [dup] });
    expect((screen.getByTestId('lp-dup-keep-both') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('lp-dup-reason'), { target: { value: 'Different rooms — both are real' } });
    fireEvent.click(screen.getByTestId('lp-dup-keep-both'));
    const updater = setLines.mock.calls[setLines.mock.calls.length - 1][0] as (p: EstimateLine[]) => EstimateLine[];
    expect(updater([kept, fresh])[0].dup_ok).toMatchObject({ with: ['N'], reason: 'Different rooms — both are real' });
  });

  it('a resolved pair (keep both) no longer blocks', () => {
    renderStep({ lines: [{ ...kept, dup_ok: { with: ['N'], reason: 'Different rooms — both are real' } }, fresh], duplicates: [dup] });
    expect(screen.queryByTestId('lp-duplicates')).toBeNull();
    expect((screen.getByTestId('lp-save-button') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('next round B2/B3 — pricing_mode switches Phase A settings for the Accubid panel', () => {
  it('renders the Phase A settings row when pricing_mode is phase_a (or unset — every existing test above)', () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'phase_a' } });
    expect(screen.getByText('Labor rate ($/hr)')).toBeTruthy();
    expect(screen.queryByTestId('accubid-pricing-panel')).toBeNull();
  });

  it('renders the Accubid panel instead of the Phase A settings row when pricing_mode is accubid and a bidId is given', async () => {
    // Next round B2/B3 — AccubidPricingPanel fetches GET /:bidId/accubid
    // through the SAME mocked api.get this file already uses for the
    // library; route by URL so both callers get a shape they can render.
    get.mockImplementation((url: string) =>
      url.includes('/accubid')
        ? Promise.resolve({
            data: {
              recap: { materialTotal: 0, materialTax: 0, fieldLaborCost: 0, equipmentTotal: 0, equipmentTax: 0, generalExpensesTotal: 0, generalExpensesTax: 0, subcontractsTotal: 0, subcontractsTax: 0, quotesNetTotal: 0, quotesTaxTotal: 0, quotesMarkupTotal: 0, budgetPendingQuotes: [], primeCost: 0, materialOverhead: 0, laborOverhead: 0, equipmentOverhead: 0, generalExpensesOverhead: 0, subcontractOverhead: 0, quotesOverhead: 0, totalOverhead: 0, netCost: 0, materialMarkup: 0, laborMarkup: 0, equipmentMarkup: 0, generalExpensesMarkup: 0, subcontractMarkup: 0, adjustmentMarkup: 0, totalMarkup: 0, salesMarkup: 0, sellingPrice: 0, blocksSend: false },
              settings: { shift: 'day', journeymanCount: 1, journeymanRate: 37, apprenticeCount: 2, apprenticeRate: 27, foremanCount: 0, foremanRate: 45, nightJourneymanRate: null, nightApprenticeRate: null, nightForemanRate: null, burdenPct: 4, fringePerHr: 1.5, materialTaxPct: 0, laborOverheadPct: 38, materialMarkupPct: 20, laborMarkupPct: 20, quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0 },
              totalHours: 0, quotes: [], costLines: [], alternates: [],
            },
          })
        : Promise.resolve({ data: { items: [], assemblies: [], factors: [] } })
    );
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' }, bidId: 'bid1' });
    await waitFor(() => expect(screen.getByTestId('accubid-pricing-panel')).toBeTruthy());
    expect(screen.queryByText('Labor rate ($/hr)')).toBeNull();
  });

  it('renders neither the Phase A row nor a crash when accubid mode has no bidId yet', () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' } });
    expect(screen.queryByText('Labor rate ($/hr)')).toBeNull();
    expect(screen.queryByTestId('accubid-pricing-panel')).toBeNull();
  });
});

describe('Fix round B5 — "Evidence / reason" field on manual/overridden lines', () => {
  it('shows the field for a manual line, flags it "needed" until it reads as a real reason, and saves it on the line', async () => {
    const { setLines } = renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' }],
    });
    expect(screen.getByTestId('lp-evidence-note-missing-0')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Evidence / reason for Duplex receptacle'), { target: { value: 'Owner allowance — priced from the spec sheet' } });
    expect(setLines).toHaveBeenCalled();
    const updater = setLines.mock.calls[0][0] as (prev: EstimateLine[]) => EstimateLine[];
    const next = updater([{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' }]);
    expect(next[0].evidence_note).toBe('Owner allowance — priced from the spec sheet');
  });

  it('never shows the field for an ordinary takeoff line', () => {
    renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'takeoff' }],
    });
    expect(screen.queryByTestId('lp-evidence-note-0')).toBeNull();
  });

  it('shows the field for a takeoff line the estimator hand-overrode the qty on (qty_source: manual), even though source stays "takeoff"', () => {
    renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 12, unit: 'EA', item_id: 'i1', source: 'takeoff', qty_overridden: true, qty_source: 'manual' }],
    });
    expect(screen.getByTestId('lp-evidence-note-0')).toBeTruthy();
  });

  it('a placeholder like ".........." still reads as missing (mirrors the backend\'s isRealReason)', () => {
    renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual', evidence_note: '..........' }],
    });
    expect(screen.getByTestId('lp-evidence-note-missing-0')).toBeTruthy();
  });

  it('once a real reason is on the line, the "needed" flag is gone', () => {
    renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual', evidence_note: 'Owner allowance per spec sheet 4.2' }],
    });
    expect(screen.queryByTestId('lp-evidence-note-missing-0')).toBeNull();
  });

  it('an excluded line never shows the field (it never reaches a GC document, so it is never gated)', () => {
    renderStep({
      lines: [{ id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual', excluded: true }],
    });
    expect(screen.queryByTestId('lp-evidence-note-0')).toBeNull();
  });

  it('focusLineKey scrolls to and focuses the named line\'s reason field, then calls onFocusedLine', async () => {
    const onFocusedLine = vi.fn();
    renderStep({
      lines: [
        { id: 'l1', line_key: 'lk1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' },
        { id: 'l2', line_key: 'lk2', category: 'Branch Power', description: 'Weatherproof GFCI', qty: 4, unit: 'EA', source: 'manual' },
      ],
      focusLineKey: 'lk2',
      onFocusedLine,
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Evidence / reason for Weatherproof GFCI')));
    await waitFor(() => expect(onFocusedLine).toHaveBeenCalled());
  });
});

describe('LaborPricingStep — price accuracy C1: confirm-match lines', () => {
  const heldLine: EstimateLine = { id: 'l1', category: 'Branch Power', description: 'Electrical meter (M)', qty: 1, unit: 'EA', item_id: 'i1', source: 'takeoff', match_confidence: 'confirm', match_source: 'auto' };
  const heldRecap = (): PricingRecap => ({
    ...EMPTY_RECAP,
    lines: [{ id: 'l1', category: 'Branch Power', description: 'Electrical meter (M)', qty: 1, unit: 'EA', materialUnit: 0, materialExt: 0, hoursUnit: 0, hoursExt: 0, laborExt: 0, confidence: null, excluded: false, directShare: 0, matchConfidence: 'confirm', unresolved: true }],
    categories: [{ category: 'Branch Power', material: 0, hours: 0, labor: 0, subtotal: 0 }],
  });

  it('shows the suggested item, $0 until confirmed, and confirming makes it a manual fuzzy pick', async () => {
    const setLines = vi.fn();
    render(
      <LaborPricingStep lines={[heldLine]} settings={baseSettings()} recap={heldRecap()} saving={false} syncing={false} saveError={null}
        setLines={setLines} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    const badge = await screen.findByTestId('lp-confirm-match-0');
    await waitFor(() => expect(badge.textContent).toContain('Duplex receptacle'));
    expect(badge.textContent).toContain('$0 until confirmed');
    expect(screen.getByTestId('lp-resolve-0')).toBeTruthy(); // still resolvable to something else
    fireEvent.click(screen.getByTestId('lp-confirm-match-btn-0'));
    const arg = setLines.mock.calls[setLines.mock.calls.length - 1][0];
    const next = typeof arg === 'function' ? arg([heldLine]) : arg;
    expect(next[0]).toMatchObject({ match_confidence: 'fuzzy', match_source: 'manual', item_id: 'i1' });
  });

  it('a held line the estimator already picked by hand shows no confirm badge', async () => {
    render(
      <LaborPricingStep lines={[{ ...heldLine, match_source: 'manual' }]} settings={baseSettings()} recap={heldRecap()} saving={false} syncing={false} saveError={null}
        setLines={vi.fn()} setSettings={vi.fn()} save={vi.fn()} syncTakeoff={vi.fn()} />
    );
    await screen.findByTestId('lp-row-0');
    expect(screen.queryByTestId('lp-confirm-match-0')).toBeNull();
  });
});

describe('accuracy round D5 — "Needs a price/unit"', () => {
  it('badges each held line with its reason and filters to them', () => {
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' },
      { id: 'l2', category: 'Service & Distribution', description: 'Wireway NEMA 3R 12x12', qty: 1, unit: 'EA', source: 'takeoff', evidence_note: 'no unit in the library' },
    ];
    const recap = { ...makeRecap(), warnings: { ...EMPTY_RECAP.warnings, holds: [{ id: 'l2', description: 'Wireway NEMA 3R 12x12', category: 'Service & Distribution', qty: 1, unit: 'EA', reason: 'no_unit' as const }] } };
    renderStep({ lines, recap });
    expect(screen.getByTestId('lp-hold-badge-1').textContent).toBe('needs a price: no unit in the library');
    expect(screen.queryByTestId('lp-hold-badge-0')).toBeNull();
    const filter = screen.getByTestId('lp-holds-filter');
    expect(filter.textContent).toBe('Needs a price/unit (1)');
    fireEvent.click(filter);
    expect(screen.queryByTestId('lp-row-0')).toBeNull();
    expect(screen.getByTestId('lp-row-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lp-holds-filter'));
    expect(screen.getByTestId('lp-row-0')).toBeTruthy();
  });
  it('no holds → no filter button', () => {
    renderStep();
    expect(screen.queryByTestId('lp-holds-filter')).toBeNull();
  });
});

describe('gap-closing T2 — owner-furnished / furnish-disputed badges', () => {
  it('a labor-only line and a disputed line each carry their badge with the quote as the tooltip', () => {
    const lines: EstimateLine[] = [
      { id: 'l1', category: 'Service & Distribution', description: 'Panels A & B', qty: 2, unit: 'EA', item_id: 'pnl', source: 'takeoff' },
      { id: 'l2', category: 'Service & Distribution', description: '200A fused switch NEMA 3R', qty: 2, unit: 'EA', item_id: 'sw', source: 'takeoff' },
      { id: 'l3', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', item_id: 'i1', source: 'manual' },
    ];
    const base = makeRecap().lines[0];
    const recap = { ...makeRecap(), lines: [
      { ...base, id: 'l1', furnishedBy: { term: 'panels', mode: 'labor_only' as const, evidence: 'Owner-furnished — labor only: E-4 "PANEL A AUTOZONE PROVIDED".', materialRemovedUnit: 1450 } },
      { ...base, id: 'l2', furnishedBy: { term: 'disconnects', mode: 'disputed' as const, evidence: 'Furnish disputed — E-4 says the owner furnishes it; AutoZone account rule says APT.', materialRemovedUnit: 0 } },
      { ...base, id: 'l3' },
    ] };
    renderStep({ lines, recap });
    expect(screen.getByTestId('lp-furnish-badge-0').textContent).toBe('Owner-furnished — labor only');
    expect(screen.getByTestId('lp-furnish-badge-0').getAttribute('title')).toMatch(/PANEL A AUTOZONE PROVIDED/);
    expect(screen.getByTestId('lp-furnish-badge-1').textContent).toBe('furnish disputed');
    expect(screen.queryByTestId('lp-furnish-badge-2')).toBeNull();
  });
});

// ── UI cleanup round 2B, Task 2 — page order, status region, mode card, recheck "Why?" ──
/** Asserts the given testids appear in this document order. */
function expectOrder(...ids: string[]) {
  const els = ids.map(id => screen.getByTestId(id));
  for (let i = 0; i < els.length - 1; i++) {
    expect(els[i].compareDocumentPosition(els[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `${ids[i]} before ${ids[i + 1]}`).toBeTruthy();
  }
}

function routeAccubid(overrides: Record<string, unknown> = {}, recapOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  get.mockImplementation((url: string) => {
    calls.push(url);
    if (url.endsWith('/accubid')) {
      return Promise.resolve({
        data: {
          recap: { ...EMPTY_ACCUBID_RECAP, ...recapOverrides },
          settings: DEFAULT_ACCUBID_SETTINGS,
          totalHours: 0, quotes: [], costLines: [], alternates: [], ...overrides,
        },
      });
    }
    return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
  });
  return calls;
}

describe('UI cleanup round 2B — page order and status region', () => {
  const dupKept: EstimateLine = { id: 'k', line_key: 'K', category: 'Branch Power', description: 'Duplex receptacle', qty: 34, unit: 'EA', item_id: 'i1', source: 'takeoff' };
  const dupNew: EstimateLine = { id: 'n', line_key: 'N', category: 'Branch Power', description: 'Duplex receptacle, 20A', qty: 30, unit: 'EA', item_id: 'i1', source: 'takeoff' };
  const unmatched: EstimateLine = { id: 'u', category: 'Branch Power', description: 'Mystery thing', qty: 1, unit: 'EA', source: 'takeoff' };
  const dup = { keptKey: 'K', keptDescription: 'Duplex receptacle', keptQty: 34, newKey: 'N', newDescription: 'Duplex receptacle, 20A', newQty: 30, category: 'Branch Power', unit: 'EA' };

  it('Quick mode: status, then mode card, then job conditions, then the table', async () => {
    renderStep({ lines: [dupKept, dupNew, unmatched], duplicates: [dup] });
    await screen.findByTestId('lp-factor-chips');
    expectOrder('lp-status', 'lp-pricing-mode-row', 'lp-factor-chips', 'lp-table');
    expect(screen.getByTestId('lp-status').contains(screen.getByTestId('lp-duplicates'))).toBe(true);
    expect(screen.getByTestId('lp-status').contains(screen.getByTestId('lp-unmatched-banner'))).toBe(true);
    expectOrder('lp-duplicates', 'lp-unmatched-banner');
  });

  it('has no status region when nothing needs attention', () => {
    renderStep();
    expect(screen.queryByTestId('lp-status')).toBeNull();
  });

  it('describes the active pricing mode on the mode card', () => {
    renderStep();
    expect(screen.getByTestId('lp-mode-desc').textContent).toBe('Price comes from the labor rate, crew size and the markups below.');
  });

  it('recheck banner: the full sentence is already in the text, and Why? only toggles the second sentence', () => {
    const lines: EstimateLine[] = [{ id: 'r', line_key: 'R', category: 'Branch Power', description: 'Edited line', qty: 3, unit: 'EA', item_id: 'i1', source: 'takeoff', recheck_run_id: 'run1' }];
    renderStep({ lines });
    const banner = screen.getByTestId('lp-recheck-banner');
    expect(banner.textContent).toContain('1 line kept from the previous analysis run (you had edited it) — re-check it against the new takeoff.');
    expect(banner.textContent).toContain('Sync from takeoff re-binds');
    const why = screen.getByTestId('lp-recheck-why');
    const more = screen.getByTestId('lp-recheck-why-text');
    expect(why.getAttribute('aria-expanded')).toBe('false');
    expect(why.getAttribute('aria-controls')).toBe(more.id);
    expect(more.hasAttribute('hidden')).toBe(true);
    fireEvent.click(why);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(more.hasAttribute('hidden')).toBe(false);
    expect(why.textContent).toBe('Hide');
  });

  it('Accubid mode: the blocking warnings sit in the status region (never inside a card) and the Accubid GET happens once', async () => {
    const calls = routeAccubid(
      { quotes: [{ id: 'q1', description: 'Lighting package', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 }],
        fixturePackageQuestion: { quoteIds: ['q1'], fixtureMaterial: 3000, message: 'A vendor quote may be the fixture package.' } },
      { blocksSend: true, budgetPendingQuotes: [{ id: 'q1', description: 'Lighting package', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 }] },
    );
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' }, bidId: 'bid1' });
    const q = await screen.findByTestId('accubid-fixture-package-question');
    const hold = screen.getByTestId('accubid-blocks-send');
    const status = screen.getByTestId('lp-status');
    const panel = screen.getByTestId('accubid-pricing-panel');
    for (const el of [q, hold]) {
      expect(status.contains(el)).toBe(true);
      expect(panel.contains(el)).toBe(false);
      expect(el.closest('[hidden]')).toBeNull();
    }
    expectOrder('lp-status', 'lp-pricing-mode-row', 'lp-floors-above-2', 'accubid-pricing-panel', 'lp-table');
    expect(calls.filter(u => u === '/estimating/bid1/accubid')).toHaveLength(1);
  });
});

// ── UI cleanup round 2B, Task 3 — Job conditions card ──
describe('UI cleanup round 2B — Job conditions card', () => {
  it('summarises the picked factors and updates when they change', async () => {
    renderStep();
    await waitFor(() => expect(screen.getByTestId('lp-conditions-summary').textContent).toBe('None selected'));
    cleanup();
    renderStep({ settings: { ...baseSettings(), factor_ids: ['f1'] } });
    await waitFor(() => expect(screen.getByTestId('lp-conditions-summary').textContent).toBe('1 factor, +10% labor hours'));
  });

  it('folds, remembers it, and keeps the controls mounted (hidden, not removed)', async () => {
    renderStep();
    const toggle = await screen.findByTestId('lp-conditions-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('lp-conditions-body').hasAttribute('hidden')).toBe(true);
    expect(window.localStorage.getItem('est-lp-conditions-open')).toBe('0');
    expect(screen.getByTestId('lp-floors-above-2')).toBeTruthy();
    cleanup();
    renderStep();
    expect((await screen.findByTestId('lp-conditions-toggle')).getAttribute('aria-expanded')).toBe('false');
  });

  it('labels each group and marks chips with aria-pressed', async () => {
    renderStep({ settings: { ...baseSettings(), factor_ids: ['f1'] } });
    expect(await screen.findByText('Working height')).toBeTruthy();
    expect(screen.getByTestId('lp-factor-HEIGHT-10-14').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lp-factor-HEIGHT-20-PLUS').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a factor still on the bid that the library has since retired', async () => {
    get.mockResolvedValue({ data: { items: [], assemblies: [], factors: [
      { id: 'f1', code: 'HEIGHT-10-14', label: 'Height 10-14', pct: 10, group_key: 'height', active: true },
      { id: 'f9', code: 'OLD', label: 'Old factor', pct: 5, group_key: 'access', active: false },
    ] } });
    renderStep({ settings: { ...baseSettings(), factor_ids: ['f9'] } });
    expect((await screen.findByTestId('lp-factor-retired')).textContent).toBe('Also applied: Old factor (+5%) — no longer offered in the library.');
    expect(screen.queryByTestId('lp-factor-OLD')).toBeNull();
  });

  it('explains the compounding in Accubid mode', async () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' } });
    expect((await screen.findByTestId('lp-conditions-body')).textContent).toContain('they multiply together (compound)');
  });
});

// ── UI cleanup round 2B, Task 4 — Rates & markups card ──
describe('UI cleanup round 2B — Rates & markups card (Quick mode)', () => {
  it('summarises the headline rates', () => {
    renderStep();
    expect(screen.getByTestId('lp-rates-summary').textContent).toBe('Labor $40/hr · Crew 3 · Overhead 10% · Profit 15% · Tax 7%');
  });

  it('groups the inputs under Labor and Markups legends', () => {
    renderStep();
    const legends = Array.from(screen.getByTestId('lp-rates').querySelectorAll('legend')).map(l => l.textContent);
    expect(legends).toEqual(['Labor', 'Markups']);
  });

  it('a folded card still holds its inputs: hidden is not removed, and editing still reaches setSettings', () => {
    const { setSettings } = renderStep();
    fireEvent.click(screen.getByTestId('lp-rates-toggle'));
    expect(screen.getByTestId('lp-rates-body').hasAttribute('hidden')).toBe(true);
    const input = screen.getByDisplayValue('40');
    fireEvent.change(input, { target: { value: '55' } });
    const updater = setSettings.mock.calls[0][0] as (prev: EstimateSettings) => EstimateSettings;
    expect(updater(baseSettings()).labor_rate).toBe(55);
    expect(window.localStorage.getItem('est-lp-rates-open')).toBe('0');
  });

  it('is absent in Accubid mode', () => {
    renderStep({ settings: { ...baseSettings(), pricing_mode: 'accubid' } });
    expect(screen.queryByTestId('lp-rates')).toBeNull();
  });
});
