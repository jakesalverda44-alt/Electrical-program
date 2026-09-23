// @vitest-environment happy-dom
// Estimating Phase B, Task 6 (deferral closed) — ReassignMarkersModal.tsx.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import ReassignMarkersModal, { ReassignMarkersModalProps } from './ReassignMarkersModal';
import { EstimateLine } from '../types';

afterEach(cleanup);

function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return { category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'takeoff', line_key: 'k1', ...over };
}

function baseProps(over: Partial<ReassignMarkersModalProps> = {}): ReassignMarkersModalProps {
  return {
    open: true,
    selectedCount: 2,
    lines: [line(), line({ line_key: 'k2', description: 'Type A1 troffer', category: 'Interior Lighting' })],
    onCancel: vi.fn(),
    onReassign: vi.fn(),
    ...over,
  };
}

describe('ReassignMarkersModal', () => {
  it('renders nothing when closed', () => {
    render(<ReassignMarkersModal {...baseProps({ open: false })} />);
    expect(screen.queryByText('Reassign to line')).toBeNull();
  });

  it('lists every line that HAS a line_key', () => {
    render(<ReassignMarkersModal {...baseProps()} />);
    expect(screen.getByTestId('ram-line-k1')).toBeTruthy();
    expect(screen.getByTestId('ram-line-k2')).toBeTruthy();
  });

  it('excludes a line with no line_key (not yet saved — nothing to point a marker at)', () => {
    render(<ReassignMarkersModal {...baseProps({ lines: [line({ line_key: undefined })] })} />);
    expect(screen.queryByTestId(/ram-line-/)).toBeNull();
    expect(screen.getByText('No saved lines match.')).toBeTruthy();
  });

  it('clicking a line calls onReassign with its line_key', () => {
    const onReassign = vi.fn();
    render(<ReassignMarkersModal {...baseProps({ onReassign })} />);
    fireEvent.click(screen.getByTestId('ram-line-k2'));
    expect(onReassign).toHaveBeenCalledWith('k2');
  });

  it('"Unassign" calls onReassign with null', () => {
    const onReassign = vi.fn();
    render(<ReassignMarkersModal {...baseProps({ onReassign })} />);
    fireEvent.click(screen.getByTestId('ram-unassign'));
    expect(onReassign).toHaveBeenCalledWith(null);
  });

  it('searching filters by description or category', () => {
    render(<ReassignMarkersModal {...baseProps()} />);
    fireEvent.change(screen.getByTestId('ram-search'), { target: { value: 'a1' } });
    expect(screen.queryByTestId('ram-line-k1')).toBeNull();
    expect(screen.getByTestId('ram-line-k2')).toBeTruthy();

    fireEvent.change(screen.getByTestId('ram-search'), { target: { value: 'lighting' } });
    expect(screen.getByTestId('ram-line-k2')).toBeTruthy();
    expect(screen.queryByTestId('ram-line-k1')).toBeNull();
  });

  it('shows the selected marker count', () => {
    render(<ReassignMarkersModal {...baseProps({ selectedCount: 5 })} />);
    expect(screen.getByText('5 markers selected.')).toBeTruthy();
  });
});
