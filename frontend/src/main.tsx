import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { UnsavedGuardProvider } from './contexts/UnsavedGuardContext';
import './styles.css';

// Register the push/PWA service worker at boot so it's active (and offline-install-ready)
// even before the user ever visits Settings → Notifications. Safe to call alongside
// push.ts's lazy getRegistration() — registering the same scriptURL twice just resolves
// to the existing registration.
if ('serviceWorker' in navigator) {
  // Registration failing (private mode, an unsupported browser, a blocked
  // scope) only costs offline install and push, not the app itself.
  navigator.serviceWorker.register('/sw.js')
    // optional: nothing to recover — the app runs without a service worker.
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {/* Above App so App's own navigation primitive can consult it. */}
        <UnsavedGuardProvider>
          <App />
        </UnsavedGuardProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
