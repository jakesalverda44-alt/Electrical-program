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

  // Fix round 1 / N4 — "Calibration accepts two points any distance apart,
  // even 1pt. Require at least about 50pt and warn when the implied scale
  // is extreme."
  describe('minimum calibration distance and extreme-scale warning', () => {
    it('Set scale is disabled, with an error, when the two points are closer than 50pt', () => {
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 10, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '10' } });
      expect(screen.getByTestId('plan-scale-too-short-error')).toBeTruthy();
      expect((screen.getByText('Set scale') as HTMLButtonElement).disabled).toBe(true);
    });

    it('exactly 50pt is accepted (the boundary is inclusive)', () => {
      const onCommit = vi.fn();
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 50, y: 0 }]} titleBlockLabel={null} onCommit={onCommit} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '5' } });
      expect(screen.queryByTestId('plan-scale-too-short-error')).toBeNull();
      fireEvent.click(screen.getByText('Set scale'));
      expect(onCommit).toHaveBeenCalledWith(0.1, 'Calibrated: 5');
    });

    it('a distance well past 50pt shows no too-short error', () => {
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '10' } });
      expect(screen.queryByTestId('plan-scale-too-short-error')).toBeNull();
    });

    it('warns (but does not block) an implied scale that is unusually LARGE (a likely typo)', () => {
      const onCommit = vi.fn();
      // 100pt over a typed 1000ft -> ftPerPt 10, well past MAX_SANE_FT_PER_PT (5).
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={onCommit} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '1000' } });
      expect(screen.getByTestId('plan-scale-extreme-warning').textContent).toMatch(/unusually large/);
      fireEvent.click(screen.getByText('Set scale'));
      expect(onCommit).toHaveBeenCalledWith(10, 'Calibrated: 1000');
    });

    it('warns (but does not block) an implied scale that is unusually SMALL', () => {
      // 1000pt over a typed 1ft -> ftPerPt 0.001, well under MIN_SANE_FT_PER_PT (0.01).
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 1000, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '1' } });
      expect(screen.getByTestId('plan-scale-extreme-warning').textContent).toMatch(/unusually small/);
    });

    it('shows no extreme-scale warning for an ordinary architectural scale', () => {
      // 100pt over 11.11ft -> ftPerPt ≈ 0.1111 (a real 1/8"=1'-0" scale).
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 100, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '11.11' } });
      expect(screen.queryByTestId('plan-scale-extreme-warning')).toBeNull();
    });

    it('the too-short error takes priority — no extreme-scale warning shown at the same time', () => {
      render(<ScaleCalibrationPopover points={[{ x: 0, y: 0 }, { x: 10, y: 0 }]} titleBlockLabel={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Known length of this line:'), { target: { value: '1000' } });
      expect(screen.getByTestId('plan-scale-too-short-error')).toBeTruthy();
      expect(screen.queryByTestId('plan-scale-extreme-warning')).toBeNull();
    });
  });
});
