// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import LogGenJobModal from './LogGenJobModal';

afterEach(cleanup);

vi.mock('../../api/client', () => ({ default: { post: vi.fn() } }));

describe('LogGenJobModal required-field labelling (review round 1 S10)', () => {
  it('the Customer input is reachable by its label text, including "required"', () => {
    render(<LogGenJobModal onClose={() => {}} onAdded={() => {}}/>);
    const input = screen.getByLabelText(/customer.*required/i);
    expect(input).toBeTruthy();
    expect(input.tagName).toBe('INPUT');
  });
});

describe('LogGenJobModal discard-changes copy (review round 1 S11)', () => {
  it('keeps the pre-batch4 useDirtyDismiss copy instead of the Modal default', () => {
    render(<LogGenJobModal onClose={() => {}} onAdded={() => {}}/>);
    fireEvent.change(screen.getByLabelText(/customer.*required/i), { target: { value: 'Debra Gierach' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(screen.getByText('You have unsaved changes in this form. Closing it will discard them.')).toBeTruthy();
    expect(screen.getByText('Discard')).toBeTruthy();
    // The Modal-default copy must not appear instead.
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(screen.queryByText('Leave without saving')).toBeNull();
  });
});
