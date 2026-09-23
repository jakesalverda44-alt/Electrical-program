// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScaleCalibrationPopover from './ScaleCalibrationPopover';

afterEach(cleanup);

describe('ScaleCalibrationPopover', () => {
  it('computes ftPerPt from the typed known length and the two points\' distance', () => {
    const onCommit = vi.fn();
    // Points 100pt apart horizontally.
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '10' } }); // 10 real feet over 100pt
    fireEvent.click(screen.getByText('Set scale'));
    expect(onCommit).toHaveBeenCalledWith(0.1, 'Calibrated: 10');
  });

  it('the Set scale button is disabled until a valid length is typed', () => {
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByText('Set scale') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '12\'6"' } });
    expect((screen.getByText('Set scale') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an inline error for unparseable input without committing', () => {
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: 'garbage' } });
    expect(screen.getByText(/Enter a length like/)).toBeTruthy();
  });

  it('offers a one-click "Use <title-block label>" button when a suggestion is available', () => {
    const onCommit = vi.fn();
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 720, y: 0 }]} titleBlockLabel={`1/8" = 1'-0"`} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText(`Use 1/8" = 1'-0"`));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(1 / (0.125 * 72), 10), `1/8" = 1'-0"`);
  });

  it('renders no title-block button when no suggestion is available', () => {
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/^Use /)).toBeNull();
  });

  it('Escape in the input calls onCancel', () => {
    const onCancel = vi.fn();
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText('Known length of this line:'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter in the input commits when valid', () => {
    const onCommit = vi.fn();
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '10' } });
    fireEvent.keyDown(screen.getByLabelText('Known length of this line:'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
