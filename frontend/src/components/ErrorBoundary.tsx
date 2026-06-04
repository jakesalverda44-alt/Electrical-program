import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; message?: string; }

/**
 * Catches render-time errors anywhere in the tree and shows a friendly fallback
 * instead of a blank white screen. Without this, one unhandled exception unmounts
 * the entire app.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown, info: unknown) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
        fontFamily: 'system-ui, sans-serif', background: '#0E1626', color: '#E6EDF7', textAlign: 'center',
      }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: '#94a3b8', maxWidth: 440, lineHeight: 1.6 }}>
          An unexpected error occurred. Try reloading the page. If the problem continues, contact an administrator.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#4D8DF7', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
