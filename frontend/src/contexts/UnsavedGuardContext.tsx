import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * The screens where the most work happens (the proposal builders, the
 * estimating workspace's Pricing tab, the survey markup editor, the project
 * Overview/Schedule drafts) hold that work in memory until an explicit Save.
 * Leaving them threw it away silently.
 *
 * `react-router-dom` 6.30's `useBlocker` only works under a data router
 * (`createBrowserRouter`); this app mounts `<BrowserRouter>` and migrating the
 * router is out of scope for this batch. So the guard is explicit instead:
 * screens register a dirty predicate here, and the app's own single navigation
 * primitive (App.tsx's `setView`) asks before it moves.
 *
 * Limitation: browser back/forward is a history event, not a call into
 * `setView`, so it is covered only by `beforeunload` on a full unload — an
 * in-app back button press is not intercepted. Fixing that needs the data
 * router (Batch 3).
 */

type DirtyCheck = () => boolean;

interface GuardApi {
  register: (id: object, check: DirtyCheck) => void;
  unregister: (id: object) => void;
  /** True if any registered screen currently has unsaved work. */
  isDirty: () => boolean;
  /**
   * Runs `proceed` immediately when nothing is dirty; otherwise shows the
   * confirm dialog and runs it only if the user chooses to leave.
   */
  confirmLeave: (proceed: () => void) => void;
}

const GuardContext = createContext<GuardApi | null>(null);

/** Registration side, used by `useUnsavedGuard`. */
export function useUnsavedGuardContext(): GuardApi | null {
  return useContext(GuardContext);
}

/**
 * Navigation side. Outside the provider it degrades to "just go", so a
 * component rendered in isolation (a test, a storybook) still works.
 */
export function useConfirmLeave(): (proceed: () => void) => void {
  const api = useContext(GuardContext);
  return useCallback((proceed: () => void) => {
    if (api) api.confirmLeave(proceed);
    else proceed();
  }, [api]);
}

export const UNSAVED_TITLE = 'You have unsaved changes';
export const UNSAVED_BODY = 'Leave without saving? The changes you have made on this screen will be lost.';

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  // A ref, not state: registering must not re-render the tree, and
  // `confirmLeave` has to read the live set at click time.
  const checks = useRef(new Map<object, DirtyCheck>());
  const [pending, setPending] = useState<(() => void) | null>(null);

  const register = useCallback((id: object, check: DirtyCheck) => {
    checks.current.set(id, check);
  }, []);

  const unregister = useCallback((id: object) => {
    checks.current.delete(id);
  }, []);

  const isDirty = useCallback(() => {
    for (const check of checks.current.values()) {
      try {
        if (check()) return true;
      } catch {
        // A predicate that throws must not wedge navigation.
      }
    }
    return false;
  }, []);

  const confirmLeave = useCallback((proceed: () => void) => {
    if (!isDirty()) { proceed(); return; }
    // Stored as a thunk so React does not call it as a state updater.
    setPending(() => proceed);
  }, [isDirty]);

  const api: GuardApi = { register, unregister, isDirty, confirmLeave };

  return (
    <GuardContext.Provider value={api}>
      {children}
      {pending && (
        <ConfirmLeaveDialog
          onStay={() => setPending(null)}
          onLeave={() => { const go = pending; setPending(null); go(); }}
        />
      )}
    </GuardContext.Provider>
  );
}

/** The app's own dialog, so the highest-stakes prompt is not an OS box. */
export function ConfirmLeaveDialog({ onStay, onLeave, title, body, leaveLabel }: {
  onStay: () => void;
  onLeave: () => void;
  title?: string;
  body?: string;
  leaveLabel?: string;
}) {
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-label={title ?? UNSAVED_TITLE}
      onMouseDown={e => e.target === e.currentTarget && onStay()}>
      <div className="modal" style={{ width: '100%', maxWidth: 420 }}>
        <div className="modal-hdr"><h3>{title ?? UNSAVED_TITLE}</h3></div>
        <div className="modal-body" style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.6 }}>
          {body ?? UNSAVED_BODY}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '0 22px 20px' }}>
          <button className="btn ghost" onClick={onStay} autoFocus>Keep editing</button>
          <button className="btn" onClick={onLeave} style={{ background: 'var(--red)', borderColor: 'var(--red)' }}>
            {leaveLabel ?? 'Leave without saving'}
          </button>
        </div>
      </div>
    </div>
  );
}
