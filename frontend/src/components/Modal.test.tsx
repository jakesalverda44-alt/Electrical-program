// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Modal from './Modal';

afterEach(cleanup);

function Harness({ isDirty = false, onClose }: { isDirty?: boolean; onClose: () => void }) {
  return (
    <div>
      <button>Opener</button>
      <Modal open onClose={onClose} title="Test Dialog" isDirty={isDirty}>
        <div className="modal-body">
          <input aria-label="first" />
          <input aria-label="second" />
        </div>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('renders dialog semantics: role, aria-modal, aria-labelledby pointing at the title', () => {
    render(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Test Dialog');
  });

  it('gives the close button an accessible name', () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('calls onClose on Escape when not dirty', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement!;
    fireEvent.mouseDown(overlay, { target: overlay });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when a click starts inside the dialog box', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // DOM order inside the box is: h3, close button, then the children — so the
  // close button is the first focusable node and the last input is the last.
  it('traps Tab within the dialog, wrapping from the last focusable element back to the first', () => {
    render(<Harness onClose={vi.fn()} />);
    const second = screen.getByLabelText('second');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    second.focus();
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps Shift+Tab, wrapping from the first focusable element back to the last', () => {
    render(<Harness onClose={vi.fn()} />);
    const second = screen.getByLabelText('second');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('moves focus to an [autofocus] field on open in preference to the close button, and restores focus to the opener on close', async () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Opener</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Focus test">
            <div className="modal-body"><input aria-label="only" autoFocus /></div>
          </Modal>
        </div>
      );
    }
    render(<Wrapper />);
    const opener = screen.getByText('Opener');
    opener.focus();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    // Focus moves into the dialog asynchronously (a microtask) after mount.
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByLabelText('only'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('a dirty-content Escape opens the discard-changes guard instead of closing', () => {
    const onClose = vi.fn();
    render(<Harness isDirty onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    // "Keep editing" dismisses the guard without closing.
    fireEvent.click(screen.getByText('Keep editing'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('a dirty-content backdrop click opens the discard-changes guard, and leaving closes', () => {
    const onClose = vi.fn();
    render(<Harness isDirty onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement!;
    fireEvent.mouseDown(overlay, { target: overlay });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Leave without saving'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the topmost of two simultaneously-open Modals reacts to Escape', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <div>
        <Modal open onClose={outerClose} title="Outer">
          <div className="modal-body">outer content</div>
        </Modal>
        <Modal open onClose={innerClose} title="Inner">
          <div className="modal-body">inner content</div>
        </Modal>
      </div>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={vi.fn()} title="Hidden"><div>content</div></Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
