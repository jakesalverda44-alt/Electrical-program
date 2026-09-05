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

  // Review round 1 B4: Modal used to call `e.stopPropagation()` on Escape
  // inside a document CAPTURE listener, which killed the event before it
  // ever reached an inner element's own bubble-phase Escape handler
  // (SurveyMarkupEditor's exit-fullscreen, LeadDetailDrawer's cancel-note) —
  // so Escape always closed the whole Modal instead of letting the inner
  // handler consume it first.
  describe('an inner handler consuming Escape (review round 1 B4)', () => {
    function ConsumingHarness({ onClose, onInnerEscape }: { onClose: () => void; onInnerEscape: () => void }) {
      return (
        <Modal open onClose={onClose} title="Consuming test">
          <div className="modal-body">
            <input
              aria-label="inner"
              onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onInnerEscape(); } }}
            />
          </div>
        </Modal>
      );
    }

    it('does not close the Modal when an inner handler calls preventDefault()', () => {
      const onClose = vi.fn();
      const onInnerEscape = vi.fn();
      render(<ConsumingHarness onClose={onClose} onInnerEscape={onInnerEscape}/>);
      screen.getByLabelText('inner').focus();
      fireEvent.keyDown(screen.getByLabelText('inner'), { key: 'Escape' });
      expect(onInnerEscape).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('still closes the Modal for an Escape nothing else consumes', () => {
      const onClose = vi.fn();
      render(<Harness onClose={onClose}/>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Review round 2 N7: the `e.defaultPrevented` check (added for the Escape
  // case directly above) used to run BEFORE the `e.key === 'Escape'` branch,
  // so it also gated the Tab focus trap below it — an inner handler that
  // calls `preventDefault()` on a Tab keydown for its own unrelated reason
  // would have silently disabled the trap entirely. The check must only
  // suppress Modal's own Escape handling.
  it("an inner handler's preventDefault() on Tab does not disable the focus trap (review round 2 N7)", () => {
    function TabConsumingHarness({ onClose }: { onClose: () => void }) {
      return (
        <Modal open onClose={onClose} title="Tab test">
          <div className="modal-body">
            <input aria-label="first" />
            <input
              aria-label="second"
              // Some unrelated inner behavior (not Modal's) consumes Tab.
              onKeyDown={e => { if (e.key === 'Tab') e.preventDefault(); }}
            />
          </div>
        </Modal>
      );
    }
    render(<TabConsumingHarness onClose={vi.fn()}/>);
    const second = screen.getByLabelText('second');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    // The trap must still wrap focus from the last element back to the
    // first, exactly as it would with no inner handler at all.
    expect(document.activeElement).toBe(closeBtn);
  });

  // Review round 1 S2: the ConfirmLeaveDialog shown while `isDirty` and the
  // user tries to close is rendered outside `containerRef`, so the Tab trap
  // must not keep cycling focus inside the (now-hidden-behind-the-guard)
  // dialog box — that would make "Leave without saving" keyboard-unreachable.
  it('does not trap Tab while the discard-changes guard is open (review round 1 S2)', () => {
    render(<Harness isDirty onClose={vi.fn()}/>);
    fireEvent.keyDown(document, { key: 'Escape' }); // opens the guard
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    const stayBtn = screen.getByText('Keep editing');
    stayBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // The Tab trap must not have forced focus back into the (still-mounted,
    // now-inert-behind-the-guard) dialog box's own focusable elements.
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close' }));
  });

  // Review round 1 S3: focus restore used to call `opener.focus()`
  // unconditionally, a silent no-op on a detached node that leaves focus on
  // `<body>` when the opener unmounted while the dialog was open.
  it('falls back to a stable landmark when the opener has unmounted (review round 1 S3)', async () => {
    function UnmountingOpenerHarness() {
      const [showOpener, setShowOpener] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <div>
          {showOpener && <button onClick={() => setOpen(true)}>Opener</button>}
          <Modal
            open={open}
            onClose={() => { setShowOpener(false); setOpen(false); }}
            title="Unmounting opener test"
          >
            <div className="modal-body">content</div>
          </Modal>
        </div>
      );
    }
    render(<UnmountingOpenerHarness/>);
    const opener = screen.getByText('Opener');
    fireEvent.click(opener);
    await new Promise(r => setTimeout(r, 0));
    // Close via Escape — onClose also unmounts the opener button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Opener')).toBeNull();
    const root = document.getElementById('root');
    expect(document.activeElement).toBe(root ?? document.body);
  });

  // Review round 1 S7: the stack used to be push-order, so an outer Modal and
  // a Modal nested INSIDE its own children mounting in the same commit would
  // have the outer one (whose join-effect runs after its child's) wrongly
  // end up "topmost". Topmost is now computed from the live DOM tree.
  it('Escape closes only the inner Modal when it is nested inside the outer one\'s children, even mounted in the same commit (review round 1 S7)', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal open onClose={outerClose} title="Outer with nested child">
        <div className="modal-body">
          outer content
          <Modal open onClose={innerClose} title="Inner (nested in children)">
            <div className="modal-body">inner content</div>
          </Modal>
        </div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  // The "nits" list: aria-labelledby should only be emitted when there is
  // actually a title/labelledBy element to point at.
  describe('aria-labelledby / aria-label fallback', () => {
    it('omits aria-labelledby and uses aria-label when there is no title or labelledBy', () => {
      render(
        <Modal open onClose={vi.fn()} ariaLabel="Untitled dialog">
          <div className="modal-body">content</div>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog.hasAttribute('aria-labelledby')).toBe(false);
      expect(dialog.getAttribute('aria-label')).toBe('Untitled dialog');
    });

    it('still uses aria-labelledby (not aria-label) when a title is given', () => {
      render(<Harness onClose={vi.fn()}/>);
      const dialog = screen.getByRole('dialog');
      expect(dialog.hasAttribute('aria-labelledby')).toBe(true);
      expect(dialog.hasAttribute('aria-label')).toBe(false);
    });
  });
});
