// @vitest-environment happy-dom
// Fix round 1 / B8 — DropsSlackPopover.tsx.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DropsSlackPopover from './DropsSlackPopover';

afterEach(cleanup);

describe('DropsSlackPopover', () => {
  it('renders the current drops/dropFt/slackPct', () => {
    render(<DropsSlackPopover drops={2} dropFt={10} slackPct={15} onChange={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText('Drops (count):') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Feet per drop:') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Slack (%):') as HTMLInputElement).value).toBe('15');
  });

  it('renders blank inputs for null dropFt/slackPct, not "0" or "null"', () => {
    render(<DropsSlackPopover drops={0} dropFt={null} slackPct={null} onChange={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText('Feet per drop:') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Slack (%):') as HTMLInputElement).value).toBe('');
  });

  it('editing drops calls onChange with an integer, clamped at 0', () => {
    const onChange = vi.fn();
    render(<DropsSlackPopover drops={0} dropFt={null} slackPct={null} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Drops (count):'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ drops: 3 });
    fireEvent.change(screen.getByLabelText('Drops (count):'), { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledWith({ drops: 0 }); // never negative
  });

  it('editing feet-per-drop calls onChange, clamped at 0, or null when cleared', () => {
    const onChange = vi.fn();
    render(<DropsSlackPopover drops={0} dropFt={10} slackPct={null} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Feet per drop:'), { target: { value: '12.5' } });
    expect(onChange).toHaveBeenCalledWith({ dropFt: 12.5 });
    fireEvent.change(screen.getByLabelText('Feet per drop:'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ dropFt: null });
    fireEvent.change(screen.getByLabelText('Feet per drop:'), { target: { value: '-3' } });
    expect(onChange).toHaveBeenCalledWith({ dropFt: 0 });
  });

  it('editing slack calls onChange, clamped at 0, or null when cleared', () => {
    const onChange = vi.fn();
    render(<DropsSlackPopover drops={0} dropFt={null} slackPct={10} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Slack (%):'), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith({ slackPct: 25 });
    fireEvent.change(screen.getByLabelText('Slack (%):'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ slackPct: null });
  });

  it('"Done" calls onClose', () => {
    const onClose = vi.fn();
    render(<DropsSlackPopover drops={0} dropFt={null} slackPct={null} onChange={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape or Enter also calls onClose', () => {
    const onClose = vi.fn();
    render(<DropsSlackPopover drops={0} dropFt={null} slackPct={null} onChange={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('Drops (count):'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Drops (count):'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
