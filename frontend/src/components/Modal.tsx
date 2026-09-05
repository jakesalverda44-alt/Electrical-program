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
  /** Accessible name to use when there is no `title` and no `labelledBy` (no
   *  header element exists for `aria-labelledby` to point at). */
  ariaLabel?: string;
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

/**
 * Review round 2 N1: a Modal nested inside a drawer (AwardKickoffModal inside
 * GenDetailDrawer, LeadSiteSurvey inside LeadDetailDrawer) needs an overlay
 * z-index above BOTH the desktop `.overlay`/`.drawer-overlay` (150/160) and
 * the mobile `@media (max-width: 768px)` bump that raises both of those to
 * 240 — round 1's B3 fix picked 170, which clears the desktop drawer but
 * loses to the mobile one, so on phones the "stacked" dialog rendered UNDER
 * the drawer backdrop. 250 clears both and stays under `.toast-wrap` (350).
 * Pass this as `overlayStyle={{ zIndex: Z_ABOVE_DRAWER }}` at any call site
 * that opens a Modal from inside a drawer/modal, instead of guessing a
 * number — `ConfirmDialog` uses the same constant for the same reason (round
 * 2 N2): it's an app-root-level dialog that must always paint above whatever
 * drawer/modal is open beneath it.
 */
export const Z_ABOVE_DRAWER = 250;

// A handful of these components open a second Modal on top of themselves —
// LeadDetailDrawer's site survey, GenDetailDrawer's kickoff modal, the
// signed-contract card's countersign confirmation. Every open Modal attaches
// its own document-level keydown listener, so without something like this,
// Escape over a nested dialog would fire both instances' handlers.
//
// Review round 1 S7: this used to be a push-order stack (only the
// most-recently-pushed id was "topmost"). That breaks when an outer Modal and
// a Modal nested in its children both open in the same React commit (e.g. via
// an `autoKickoff`/`autoCountersign`-style prop): React runs child effects
// before parent effects, so the INNER Modal's "join the stack" effect would
// run first and get pushed first, and the OUTER Modal's effect — running
// second, being the parent — would land on top of the stack and be (wrongly)
// treated as topmost. Refs are already attached to real DOM nodes by the time
// any effect from this commit runs (React attaches refs during the commit
// phase, before effects), so topmost is now computed from the live DOM tree
// at keydown time instead of registration order: a Modal nested *inside*
// another's DOM (SignedContractCard's confirm, rendered within
// GenDetailDrawer's own children) is topmost regardless of mount order; two
// Modals that are DOM siblings (GenDetailDrawer + the kickoff modal rendered
// after it, sibling-after-drawer per B3) resolve by document order — whichever
// one is later in the DOM is topmost, matching how the app actually renders
// "the dialog opened most recently" as the later JSX/DOM sibling.
interface OpenModalEntry { id: symbol; getEl: () => HTMLElement | null }
let openModals: OpenModalEntry[] = [];

function isTopmostModal(id: symbol): boolean {
  const self = openModals.find(m => m.id === id)?.getEl();
  if (!self) return false;
  for (const other of openModals) {
    if (other.id === id) continue;
    const otherEl = other.getEl();
    if (!otherEl || otherEl === self) continue;
    if (self.contains(otherEl)) return false; // other is nested inside self -> other is deeper, self is not topmost
    if (otherEl.contains(self)) continue; // self is nested inside other -> self can still be topmost overall
    // Siblings (no containment either way): whichever is later in document order wins.
    if (self.compareDocumentPosition(otherEl) & Node.DOCUMENT_POSITION_FOLLOWING) return false;
  }
  return true;
}

// Review round 1 S3: focus restore falls back here when the element that
// opened the dialog has since unmounted (e.g. it lived inside a list row that
// was removed while the dialog was open) — `opener.focus()` on a detached
// node is a silent no-op, leaving focus on `<body>` with nothing announced.
function focusStableLandmark() {
  const el = (document.getElementById('root') ?? document.body) as HTMLElement | null;
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus();
}

export default function Modal({
  open, onClose, title, labelledBy, isDirty = false, variant = 'modal', role = 'dialog',
  closeLabel = 'Close', hideClose = false, overlayClassName, overlayStyle, className, style, ariaLabel,
  discardTitle, discardBody, discardLabel, children,
}: ModalProps) {
  const autoId = useId();
  const titleId = labelledBy ?? autoId;
  const hasLabelElement = title !== undefined || labelledBy !== undefined;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(false);
  const stackIdRef = useRef<symbol | null>(null);
  if (!stackIdRef.current) stackIdRef.current = Symbol('modal');
  const [asking, setAsking] = useState(false);

  // Join/leave the registry of currently-open Modals so the keydown handler
  // below can tell whether this instance is the topmost (only that one should
  // react) — see `isTopmostModal` above for how "topmost" is determined.
  useEffect(() => {
    if (!open) return;
    const entry: OpenModalEntry = { id: stackIdRef.current!, getEl: () => containerRef.current };
    openModals.push(entry);
    return () => { openModals = openModals.filter(e => e !== entry); };
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
      // Review round 1 S3: an opener that has since unmounted (e.g. it lived
      // in a list row removed while the dialog was open) can't take focus —
      // `.focus()` on a detached node is a silent no-op that leaves focus on
      // `<body>`. Fall back to a stable landmark instead.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else focusStableLandmark();
    };
  }, [open]);

  // Escape (routed through the dirty check) and a Tab/Shift-Tab focus trap.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Only the topmost open Modal reacts — a nested one (e.g. a confirm
      // dialog opened from within this one) takes over until it closes.
      if (!isTopmostModal(stackIdRef.current!)) return;
      if (e.key === 'Escape') {
        // Review round 1 B4: an inner handler (SurveyMarkupEditor's
        // exit-fullscreen, LeadDetailDrawer's cancel-note) that wants to
        // consume this Escape itself calls `e.preventDefault()` — checking
        // that here (instead of this handler unconditionally calling
        // `e.stopPropagation()`, which used to run in the capture phase and
        // killed the event before it ever reached those handlers) lets the
        // inner handler win without Modal *also* closing.
        //
        // Review round 2 N7: this check used to run BEFORE the `e.key`
        // branch, so it also gated the Tab focus-trap below — a future inner
        // handler that calls `preventDefault()` on a Tab keydown (for its
        // own reason, unrelated to Escape) would have silently disabled the
        // focus trap. Scoped to the Escape branch, it only ever suppresses
        // Modal's own Escape handling.
        if (e.defaultPrevented) return;
        if (asking) { setAsking(false); return; }
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Review round 1 S2: the dirty-discard ConfirmLeaveDialog renders
      // outside `containerRef` while `asking` is true, so trapping Tab here
      // would make its "Leave without saving" button keyboard-unreachable.
      if (asking) return;
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
    // Review round 1 B4: bubble phase, not capture. A capture-phase listener
    // on `document` fires before the event ever reaches an inner element's
    // own handler, so this used to always "win" no matter what — the
    // `e.stopPropagation()` this handler called on Escape was actually
    // redundant with the topmost check above (which already prevents
    // double-handling between stacked Modals) and its only real effect was
    // to make inner Escape handlers unreachable. Bubble phase lets an inner
    // handler run and call `preventDefault()` first.
    document.addEventListener('keydown', onKeyDown, false);
    return () => document.removeEventListener('keydown', onKeyDown, false);
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
        <div
          className={boxClass} style={style} role={role} aria-modal="true"
          aria-labelledby={hasLabelElement ? titleId : undefined}
          aria-label={hasLabelElement ? undefined : ariaLabel}
          ref={containerRef}
        >
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
