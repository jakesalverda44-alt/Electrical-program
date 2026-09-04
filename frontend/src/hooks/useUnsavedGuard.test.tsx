// @vitest-environment happy-dom
// The screens where the most work happens (both proposal builders, the
// estimating workspace's Pricing tab, the survey markup editor, the project
// Overview/Schedule drafts) hold that work in memory until an explicit Save.
// Before this hook, leaving one threw it away silently — no dialog, no
// beforeunload, nothing.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { UnsavedGuardProvider, useConfirmLeave } from '../contexts/UnsavedGuardContext';
import { useUnsavedGuard } from './useUnsavedGuard';

afterEach(cleanup);

/** A stand-in for a builder: a field, a Save, and a nav button. */
function Screen({ onNavigated }: { onNavigated: () => void }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  useUnsavedGuard(value !== saved);
  const confirmLeave = useConfirmLeave();
  return (
    <div>
      <input aria-label="field" value={value} onChange={e => setValue(e.target.value)}/>
      <button onClick={() => setSaved(value)}>Save</button>
      <button onClick={() => confirmLeave(onNavigated)}>Go to Dashboard</button>
    </div>
  );
}

function setup() {
  const onNavigated = vi.fn();
  render(
    <UnsavedGuardProvider>
      <Screen onNavigated={onNavigated}/>
    </UnsavedGuardProvider>,
  );
  return { onNavigated };
}

const type = (v: string) => fireEvent.change(screen.getByLabelText('field'), { target: { value: v } });
const navigate = () => fireEvent.click(screen.getByText('Go to Dashboard'));

describe('useUnsavedGuard', () => {
  it('blocks navigation with the app dialog when the screen is dirty', () => {
    const { onNavigated } = setup();

    type('half a proposal');
    navigate();

    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    expect(onNavigated).not.toHaveBeenCalled();
  });

  it('navigates once the user confirms', () => {
    const { onNavigated } = setup();

    type('half a proposal');
    navigate();
    fireEvent.click(screen.getByText('Leave without saving'));

    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('"Keep editing" dismisses the dialog and stays put', () => {
    const { onNavigated } = setup();

    type('half a proposal');
    navigate();
    fireEvent.click(screen.getByText('Keep editing'));

    expect(onNavigated).not.toHaveBeenCalled();
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    // Still dirty, so the next attempt asks again.
    navigate();
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
  });

  it('does not ask when nothing has changed', () => {
    const { onNavigated } = setup();

    navigate();

    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('saving clears the dirty state', () => {
    const { onNavigated } = setup();

    type('a proposal');
    fireEvent.click(screen.getByText('Save'));
    navigate();

    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('undoing an edit back to the saved value clears it too', () => {
    // The reason the predicate is a snapshot comparison and not a keystroke
    // flag: a flag never resets, so the dialog becomes noise.
    const { onNavigated } = setup();

    type('typo');
    type('');
    navigate();

    expect(onNavigated).toHaveBeenCalledTimes(1);
  });

  it('registers a beforeunload handler only while dirty', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      setup();
      expect(add.mock.calls.some(c => c[0] === 'beforeunload')).toBe(false);

      type('unsaved');
      expect(add.mock.calls.some(c => c[0] === 'beforeunload')).toBe(true);

      fireEvent.click(screen.getByText('Save'));
      expect(remove.mock.calls.some(c => c[0] === 'beforeunload')).toBe(true);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('a screen that unmounts stops blocking navigation', () => {
    function Host() {
      const [show, setShow] = useState(true);
      const [value, setValue] = useState('dirty from the start');
      const confirmLeave = useConfirmLeave();
      const onNavigated = navSpy;
      useUnsavedGuard(false); // host itself is never dirty
      return (
        <div>
          {show && <Dirty value={value} setValue={setValue}/>}
          <button onClick={() => setShow(false)}>Close editor</button>
          <button onClick={() => confirmLeave(onNavigated)}>Go</button>
        </div>
      );
    }
    function Dirty({ value }: { value: string; setValue: (v: string) => void }) {
      useUnsavedGuard(value.length > 0);
      return <div>editor</div>;
    }
    const navSpy = vi.fn();

    render(<UnsavedGuardProvider><Host/></UnsavedGuardProvider>);

    fireEvent.click(screen.getByText('Go'));
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep editing'));

    fireEvent.click(screen.getByText('Close editor'));
    fireEvent.click(screen.getByText('Go'));

    expect(navSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useConfirmLeave outside the provider', () => {
  it('just proceeds rather than throwing', () => {
    const onNavigated = vi.fn();
    render(<Screen onNavigated={onNavigated}/>);

    type('unsaved, but nothing is watching');
    navigate();

    expect(onNavigated).toHaveBeenCalledTimes(1);
  });
});
