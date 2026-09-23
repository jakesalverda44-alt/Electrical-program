// @vitest-environment happy-dom
// Estimating Phase B, Task 6 (deferral closed) — NewLineFromMarkupModal.tsx.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import NewLineFromMarkupModal, { NewLineFromMarkupModalProps } from './NewLineFromMarkupModal';
import { Library } from '../types';

afterEach(cleanup);

function library(): Library {
  return {
    items: [{ id: 'i1', code: 'LT-A1', name: 'Type A1 LED troffer', category: 'Interior Lighting', unit: 'EA', material_cost: 100, material_price_date: null, labor_hours: 1, aliases: [], source: 'seed', active: true }],
    assemblies: [{ id: 'a1', code: 'ASM-1', name: 'Duplex receptacle assembly', category: 'Branch Power', unit: 'LF', aliases: [], source: 'seed', active: true, components: [] }],
    factors: [],
  };
}

function baseProps(over: Partial<NewLineFromMarkupModalProps> = {}): NewLineFromMarkupModalProps {
  return {
    open: true,
    selectedCount: 2,
    unit: 'EA',
    categories: ['Branch Power', 'Interior Lighting'],
    library: library(),
    busy: false,
    onCancel: vi.fn(),
    onCreate: vi.fn(),
    ...over,
  };
}

describe('NewLineFromMarkupModal', () => {
  it('renders nothing when closed', () => {
    render(<NewLineFromMarkupModal {...baseProps({ open: false })} />);
    expect(screen.queryByText('New line from markup')).toBeNull();
  });

  it('shows the selected marker count and defaults qty to it', () => {
    render(<NewLineFromMarkupModal {...baseProps({ selectedCount: 3 })} />);
    expect(screen.getByText('3 markers selected — will be attached to this line once created.')).toBeTruthy();
    expect((screen.getByTestId('nlfm-qty') as HTMLInputElement).value).toBe('3');
  });

  it('only offers library candidates whose unit is compatible with the fixed unit (EA excludes the LF assembly)', () => {
    render(<NewLineFromMarkupModal {...baseProps({ unit: 'EA' })} />);
    expect(screen.getByTestId('nlfm-candidate-i1')).toBeTruthy();
    expect(screen.queryByTestId('nlfm-candidate-a1')).toBeNull();
  });

  it('clicking a candidate creates the line using the candidate\'s own name as description when none was typed', () => {
    const onCreate = vi.fn();
    render(<NewLineFromMarkupModal {...baseProps({ onCreate })} />);
    fireEvent.click(screen.getByTestId('nlfm-candidate-i1'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Type A1 LED troffer', itemId: 'i1', assemblyId: null, unit: 'EA', qty: 2,
    }));
  });

  it('a typed description overrides the candidate name', () => {
    const onCreate = vi.fn();
    render(<NewLineFromMarkupModal {...baseProps({ onCreate })} />);
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'My own label' } });
    fireEvent.click(screen.getByTestId('nlfm-candidate-i1'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ description: 'My own label', itemId: 'i1' }));
  });

  it('"Keep as manual line" is disabled until a description AND at least one of material/hours is entered', () => {
    render(<NewLineFromMarkupModal {...baseProps()} />);
    const btn = screen.getByTestId('nlfm-keep-manual') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom item' } });
    expect(btn.disabled).toBe(true); // still no material/hours
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '50' } });
    expect(btn.disabled).toBe(false);
  });

  it('"Keep as manual line" creates a manual line with the entered material/hours and no item/assembly', () => {
    const onCreate = vi.fn();
    render(<NewLineFromMarkupModal {...baseProps({ onCreate })} />);
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-hours'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Custom item', itemId: null, assemblyId: null, materialUnitOverride: 0, laborHoursOverride: 0.5,
    }));
  });

  it('searching filters candidates by name', () => {
    render(<NewLineFromMarkupModal {...baseProps()} />);
    fireEvent.change(screen.getByTestId('nlfm-search'), { target: { value: 'zzz-no-match' } });
    expect(screen.queryByTestId('nlfm-candidate-i1')).toBeNull();
    expect(screen.getByText('No unit-compatible library items match.')).toBeTruthy();
  });

  it('re-opening the modal resets the form (no stale description/qty from a previous open)', () => {
    const { rerender } = render(<NewLineFromMarkupModal {...baseProps({ open: false, selectedCount: 1 })} />);
    rerender(<NewLineFromMarkupModal {...baseProps({ open: true, selectedCount: 1 })} />);
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'typed once' } });
    rerender(<NewLineFromMarkupModal {...baseProps({ open: false, selectedCount: 1 })} />);
    rerender(<NewLineFromMarkupModal {...baseProps({ open: true, selectedCount: 5 })} />);
    expect((screen.getByTestId('nlfm-description') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('nlfm-qty') as HTMLInputElement).value).toBe('5');
  });
});
