import React, { createContext, useContext } from 'react';
import { User, Toast } from '../types';
import { AppSettings } from '../hooks/useAppSettings';

/**
 * App-wide context for the three pieces of truly global state that were
 * previously prop-drilled through App.tsx into nearly every page:
 *   - the signed-in user
 *   - the showToast notifier
 *   - app settings (+ a reload trigger)
 *
 * These providers only wrap the authenticated tree, so the consumer hooks
 * assume a logged-in user and throw if used outside <AppProviders>. That
 * keeps callers terse (no null checks) and surfaces wiring mistakes loudly.
 */

// --- User -----------------------------------------------------------------
const UserContext = createContext<User | null>(null);

export function useUser(): User {
  const u = useContext(UserContext);
  if (!u) throw new Error('useUser must be used within <AppProviders>');
  return u;
}

// --- Toast ----------------------------------------------------------------
type ShowToast = (t: Toast) => void;
const ToastContext = createContext<ShowToast | null>(null);

export function useShowToast(): ShowToast {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error('useShowToast must be used within <AppProviders>');
  return fn;
}

// --- Settings -------------------------------------------------------------
interface SettingsCtx {
  settings: AppSettings;
  reloadSettings: () => void | Promise<void>;
}
const SettingsContext = createContext<SettingsCtx | null>(null);

export function useSettings(): SettingsCtx {
  const c = useContext(SettingsContext);
  if (!c) throw new Error('useSettings must be used within <AppProviders>');
  return c;
}

// --- Provider -------------------------------------------------------------
export function AppProviders({
  user, showToast, settings, reloadSettings, children,
}: {
  user: User;
  showToast: ShowToast;
  settings: AppSettings;
  reloadSettings: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <UserContext.Provider value={user}>
      <ToastContext.Provider value={showToast}>
        <SettingsContext.Provider value={{ settings, reloadSettings }}>
          {children}
        </SettingsContext.Provider>
      </ToastContext.Provider>
    </UserContext.Provider>
  );
}
