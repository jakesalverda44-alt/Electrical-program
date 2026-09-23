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

  // Fix round 1 / B7 — "the '>2% verify scale' warning isn't implemented."
  describe('the >2% disagreement-with-the-title-block warning', () => {
    // 100pt apart; the title block says 1/8"=1'-0" -> ftPerPt ≈ 0.11111.
    const points: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const titleBlockLabel = `1/8" = 1'-0"`;

    it('shows the warning when the typed measurement disagrees by more than 2%', () => {
      render(<ScaleCalibrationPopover points={points} titleBlockLabel={titleBlockLabel} onCommit={vi.fn()} onCancel={vi.fn()} />);
      // 12ft over 100pt -> ftPerPt 0.12, an ~8% disagreement with 0.11111.
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '12' } });
      const warning = screen.getByTestId('plan-scale-disagreement-warning');
      expect(warning.textContent).toMatch(/disagrees with the title block's 1\/8" = 1'-0" by 8%/);
    });

    it('shows NO warning when the typed measurement is within 2%', () => {
      render(<ScaleCalibrationPopover points={points} titleBlockLabel={titleBlockLabel} onCommit={vi.fn()} onCancel={vi.fn()} />);
      // 11.2ft over 100pt -> ftPerPt 0.112, < 1% off 0.11111.
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '11.2' } });
      expect(screen.queryByTestId('plan-scale-disagreement-warning')).toBeNull();
    });

    it('shows no warning when there is no title-block suggestion to compare against at all', () => {
      render(<ScaleCalibrationPopover points={points} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '12' } });
      expect(screen.queryByTestId('plan-scale-disagreement-warning')).toBeNull();
    });

    it('never blocks committing — Set scale stays enabled even while the warning shows', () => {
      const onCommit = vi.fn();
      render(<ScaleCalibrationPopover points={points} titleBlockLabel={titleBlockLabel} onCommit={onCommit} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '12' } });
      expect(screen.getByTestId('plan-scale-disagreement-warning')).toBeTruthy();
      fireEvent.click(screen.getByText('Set scale'));
      expect(onCommit).toHaveBeenCalledWith(0.12, 'Calibrated: 12');
    });

    it('shows no warning before anything has been typed yet', () => {
      render(<ScaleCalibrationPopover points={points} titleBlockLabel={titleBlockLabel} onCommit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.queryByTestId('plan-scale-disagreement-warning')).toBeNull();
    });
  });
});
