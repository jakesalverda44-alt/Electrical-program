// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScaleBanner, { scaleBannerMode } from './ScaleBanner';
import { SheetRow } from '../types';

afterEach(cleanup);

const QUARTER = 1 / (0.25 * 72);
const EIGHTH = 1 / (0.125 * 72);

function sheet(over: Partial<SheetRow> = {}): SheetRow {
  return {
    bid_id: 'b', document_id: 'd', page_index: 0, sheet_no: 'E1.0', title: 'Plan', discipline: 'E', kind: 'plan',
    width_pt: 792, height_pt: 612, rotation: 0, origin_x_pt: 0, origin_y_pt: 0,
    ft_per_pt: null, scale_source: null, scale_label: null, has_text_layer: false,
    suggested_ft_per_pt: null, suggested_label: null, scale_ambiguous: false, half_size: false,
    page_group: 'drawing', ...over,
  };
}
const AI = { ai_scale_label: `1/4" = 1'-0"`, ai_ft_per_pt: QUARTER, ai_scale_ambiguous: false };

function setup(s: SheetRow) {
  const onCommit = vi.fn(); const onMeasure = vi.fn();
  render(<ScaleBanner sheet={s} busy={false} onCommit={onCommit} onMeasure={onMeasure} />);
  return { onCommit, onMeasure };
}

describe('scaleBannerMode', () => {
  it('picks the banner state per sheet', () => {
    expect(scaleBannerMode(sheet())).toBe('needed');
    expect(scaleBannerMode(sheet({ ...AI }))).toBe('ai');
    expect(scaleBannerMode(sheet({ suggested_ft_per_pt: EIGHTH, suggested_label: `1/8" = 1'-0"` }))).toBe('suggestion');
    expect(scaleBannerMode(sheet({ scale_ambiguous: true }))).toBe('ambiguous');
    expect(scaleBannerMode(sheet({ ft_per_pt: 0.05 }))).toBeNull();
    expect(scaleBannerMode(sheet({ page_group: 'spec' }))).toBeNull();
    expect(scaleBannerMode(sheet({ page_group: 'other' }))).toBeNull();
    expect(scaleBannerMode(sheet({ page_group: 'other', ...AI }))).toBe('ai');
  });
  it('title block wins when it agrees with the AI read; a disagreement needs a pick', () => {
    expect(scaleBannerMode(sheet({ ...AI, suggested_ft_per_pt: QUARTER, suggested_label: `1/4" = 1'-0"` }))).toBe('suggestion');
    expect(scaleBannerMode(sheet({ ...AI, suggested_ft_per_pt: EIGHTH, suggested_label: `1/8" = 1'-0"` }))).toBe('conflict');
  });
});

describe('ScaleBanner', () => {
  it('needed: dropdown lists every standard scale; picking + Set scale saves a "standard" scale labelled (picked)', () => {
    const { onCommit } = setup(sheet());
    expect(screen.getByTestId('plan-scale-needed-banner')).toBeTruthy();
    const select = screen.getByLabelText('Pick a scale') as HTMLSelectElement;
    expect(select.querySelectorAll('option[value]:not([value=""])')).toHaveLength(19);
    expect((screen.getByText('Set scale') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'arch-1/4' } });
    fireEvent.click(screen.getByText('Set scale'));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(QUARTER, 9), `1/4" = 1'-0" (picked)`, 'standard');
  });
  it('half-size set: the picked scale is doubled exactly once', () => {
    const { onCommit } = setup(sheet({ half_size: true }));
    fireEvent.change(screen.getByLabelText('Pick a scale'), { target: { value: 'eng-20' } });
    fireEvent.click(screen.getByText('Set scale'));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(2 * 20 / 72, 9), `1" = 20' (picked)`, 'standard');
  });
  it('ai: states what the AI read with [Use it] [Pick another] [Measure]; Use it saves the effective scale', () => {
    const { onCommit, onMeasure } = setup(sheet({ ...AI }));
    expect(screen.getByTestId('plan-scale-ai-banner').textContent).toContain(`The AI read SCALE: 1/4" = 1'-0" on this sheet.`);
    expect(screen.queryByLabelText('Pick a scale')).toBeNull();
    fireEvent.click(screen.getByText('Measure'));
    expect(onMeasure).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Use it'));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(QUARTER, 9), `1/4" = 1'-0" (AI read, confirmed)`, 'standard');
  });
  it('ai + half-size: Use it is not double-applied (raw x2 once)', () => {
    const { onCommit } = setup(sheet({ ...AI, half_size: true }));
    fireEvent.click(screen.getByText('Use it'));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(QUARTER * 2, 9), expect.any(String), 'standard');
  });
  it('ai: Pick another reveals the dropdown pre-selected to the AI scale, with the confirm hint', () => {
    setup(sheet({ ...AI }));
    fireEvent.click(screen.getByText('Pick another'));
    expect((screen.getByLabelText('Pick a scale') as HTMLSelectElement).value).toBe('arch-1/4');
    expect(screen.getByTestId('plan-scale-ai-hint').textContent).toBe('Read from the drawing by the AI — confirm');
  });
  it('suggestion: Confirm still saves the title-block scale as titleblock; the AI pre-selection hint shows when it agrees', () => {
    const { onCommit } = setup(sheet({ ...AI, suggested_ft_per_pt: QUARTER, suggested_label: `1/4" = 1'-0"` }));
    expect(screen.getByTestId('plan-scale-suggestion-banner')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm'));
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(QUARTER, 9), `1/4" = 1'-0"`, 'titleblock');
  });
  it('conflict: shows both reads, no pre-selection, and requires a pick', () => {
    const { onCommit } = setup(sheet({ ...AI, suggested_ft_per_pt: EIGHTH, suggested_label: `1/8" = 1'-0"` }));
    const banner = screen.getByTestId('plan-scale-conflict-banner');
    expect(banner.textContent).toContain(`The title block says 1/8" = 1'-0" but the AI read 1/4" = 1'-0"`);
    expect((screen.getByLabelText('Pick a scale') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('Confirm')).toBeNull();
    fireEvent.click(screen.getByText(`Use title block (1/8" = 1'-0")`));
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(EIGHTH, 9), `1/8" = 1'-0"`, 'titleblock');
    fireEvent.click(screen.getByText(`Use AI read (1/4" = 1'-0")`));
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(QUARTER, 9), expect.stringContaining('AI read'), 'standard');
  });
  it('ambiguous (several scales in the text layer): dropdown + measure, no AI auto-use', () => {
    setup(sheet({ scale_ambiguous: true, ai_scale_ambiguous: true }));
    expect(screen.getByTestId('plan-scale-ambiguous-banner')).toBeTruthy();
    expect(screen.getByLabelText('Pick a scale')).toBeTruthy();
    expect(screen.getByTestId('plan-set-scale')).toBeTruthy();
  });
  it('renders nothing once the sheet has a scale', () => {
    setup(sheet({ ft_per_pt: 0.05 }));
    expect(screen.queryByTestId('plan-scale-needed-banner')).toBeNull();
  });
});
