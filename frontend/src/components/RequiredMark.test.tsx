// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RequiredMark from './RequiredMark';

afterEach(cleanup);

describe('RequiredMark (audit ux #15)', () => {
  it('renders a visible asterisk that is hidden from assistive tech', () => {
    render(<label>Project name<RequiredMark/></label>);
    const asterisk = screen.getByText('*');
    expect(asterisk.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes "required" as text for a screen reader even though the asterisk is aria-hidden', () => {
    render(<label>Project name<RequiredMark/></label>);
    expect(screen.getByText('required')).toBeTruthy();
  });

  it('renders next to a required input\'s label, e.g. AddBidModal\'s "Project name"', () => {
    render(
      <div className="field">
        <label>Project name<RequiredMark/></label>
        <input required/>
      </div>,
    );
    const input = screen.getByRole('textbox');
    expect(input.hasAttribute('required')).toBe(true);
    expect(screen.getByText('*')).toBeTruthy();
  });
});
