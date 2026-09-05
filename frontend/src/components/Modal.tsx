import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';
import { ConfirmLeaveDialog } from '../contexts/UnsavedGuardContext';

/**
 * The one modal/drawer shell in the app (audit ux #12, #13, #14). Before this,
 * 9 different components each hand-rolled their own `.overlay`/`.drawer-overlay`
 * pair with no `role="dialog"`, no focus trap, and — in 8 of the 9 — no Escape
 * or backdrop dismissal. This owns that chrome; callers keep everything else
 * (their own header content, form, footer) as `children`.
 *
 * Two ways to label the dialog for assistive tech:
 *  - pass `title` (a string) and Modal renders the standard header row (title +
 *    close button) for you — the common case.
 *  - pass `labelledBy` (an id) when the caller renders its own richer header
 *    (an eyebrow line, a badge, tabs) — give that header's own title element
 *    that id and skip `title` entirely; Modal then renders no header of its
 *    own and the caller is responsible for its own close button (wire it to
 *    the `requestClose` passed into the render-prop form of `children`).
 *
 * `isDirty` is the one thing Modal needs from the caller to route Escape/
 * backdrop through the same "Discard your changes?" prompt Batch 2 already
 * uses (`ConfirmLeaveDialog`) instead of silently closing over typed work.
 * Leave it `false` (the default) for anything that has nothing to lose, or
 * already manages its own close-time save (LeadSiteSurvey autosaves instead
 * of discarding).
 */

export interface ModalRenderProps {
  /** Wire this to a form's own Cancel/close-x so it goes through the same
   *  dirty check as Escape/backdrop, instead of calling `onClose` directly. */
  requestClose: () => void;
  /** The id Modal put on its own title element — only meaningful when `title`
   *  was passed; with `labelledBy` the caller already owns that id. */
  titleId: string;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Renders the default header (title text + close button). Omit and use
   *  `labelledBy` when the caller renders its own header. */
  title?: React.ReactNode;
  /** Id of an element (rendered by the caller, inside `children`) that labels
   *  the dialog. Use instead of `title` for a custom header. */
  labelledBy?: string;
  /** True while the content holds unsaved work. Escape/backdrop then ask
   *  before closing instead of closing immediately. Default false. */
  isDirty?: boolean;
  variant?: 'modal' | 'drawer';
  /** ARIA role for the dialog box. 'alertdialog' for yes/no confirmations. */
  role?: 'dialog' | 'alertdialog';
  closeLabel?: string;
  /** Suppress Modal's own close button (only meaningful with `title`). */
  hideClose?: boolean;
  /** Extra class/style for the overlay (backdrop) element. */
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
  /** Extra class/style for the dialog box element. */
  className?: string;
  style?: React.CSSProperties;
  /** Copy for the built-in "discard unsaved changes" prompt shown when
   *  `isDirty` and the user tries to close. */
  discardTitle?: string;
  discardBody?: string;
  discardLabel?: string;
  children: React.ReactNode | ((props: ModalRenderProps) => React.ReactNode);
}

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// A handful of these components open a second Modal on top of themselves —
// LeadDetailDrawer's site survey, GenDetailDrawer's kickoff modal, the
// signed-contract card's countersign confirmation. Every open Modal attaches
// its own document-level keydown listener, so without this, Escape over a
// nested dialog would fire both instances' handlers (registration order, not
// DOM depth). This tracks which open Modal is topmost so only that one acts.
let modalStack: symbol[] = [];

export default function Modal({
  open, onClose, title, labelledBy, isDirty = false, variant = 'modal', role = 'dialog',
  closeLabel = 'Close', hideClose = false, overlayClassName, overlayStyle, className, style,
  discardTitle, discardBody, discardLabel, children,
}: ModalProps) {
  const autoId = useId();
  const titleId = labelledBy ?? autoId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(false);
  const stackIdRef = useRef<symbol | null>(null);
  if (!stackIdRef.current) stackIdRef.current = Symbol('modal');
  const [asking, setAsking] = useState(false);

  // Join/leave the stack of currently-open Modals so the keydown handler
  // below can tell whether it is the topmost (only that one should react).
  useEffect(() => {
    if (!open) return;
    const id = stackIdRef.current!;
    modalStack.push(id);
    return () => { modalStack = modalStack.filter(x => x !== id); };
  }, [open]);

  const requestClose = useCallback(() => {
    if (isDirty) setAsking(true);
    else onClose();
  }, [isDirty, onClose]);

  // Captured during render (before this open content commits/mounts), not in
  // an effect: React's own `autoFocus` on a child field runs as part of the
  // commit that inserts it, which happens before any effect in this
  // component would fire — by then `document.activeElement` would already be
  // that field, not the real opener.
  if (open && !wasOpenRef.current) openerRef.current = document.activeElement;
  wasOpenRef.current = open;

  // Focus in on open — unless a child already claimed it via its own
  // `autoFocus` — and restore focus to the opener on close.
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (container && !container.contains(document.activeElement)) {
      container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  // Escape (routed through the dirty check) and a Tab/Shift-Tab focus trap.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Only the topmost open Modal reacts — a nested one (e.g. a confirm
      // dialog opened from within this one) takes over until it closes.
      if (modalStack[modalStack.length - 1] !== stackIdRef.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (asking) { setAsking(false); return; }
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const activeInside = container.contains(document.activeElement);
      if (e.shiftKey) {
        if (!activeInside || document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (!activeInside || document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    // Capture phase so this wins over content-level handlers (e.g. a textarea's
    // own Escape) and so nested modals only see this from their own listener.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, asking, requestClose]);

  useEffect(() => { if (!open) setAsking(false); }, [open]);

  if (!open) return null;

  const overlayClass = (variant === 'drawer' ? 'drawer-overlay' : 'overlay') + (overlayClassName ? ` ${overlayClassName}` : '');
  const boxClass = (variant === 'drawer' ? 'drawer' : 'modal') + (className ? ` ${className}` : '');
  const hdrClass = variant === 'drawer' ? 'drawer-hdr' : 'modal-hdr';

  return (
    <>
      <div
        className={overlayClass}
        style={overlayStyle}
        onMouseDown={e => { if (e.target === e.currentTarget) requestClose(); }}
      >
        <div className={boxClass} style={style} role={role} aria-modal="true" aria-labelledby={titleId} ref={containerRef}>
          {title !== undefined && (
            <div className={hdrClass}>
              <h3 id={titleId}>{title}</h3>
              {!hideClose && (
                <button type="button" className="close-x" aria-label={closeLabel} onClick={requestClose}>
                  <Icon name="x" size={16} stroke={2}/>
                </button>
              )}
            </div>
          )}
          {typeof children === 'function' ? children({ requestClose, titleId }) : children}
        </div>
      </div>
      {asking && (
        <ConfirmLeaveDialog
          title={discardTitle}
          body={discardBody}
          leaveLabel={discardLabel}
          onStay={() => setAsking(false)}
          onLeave={() => { setAsking(false); onClose(); }}
        />
      )}
    </>
  );
}
