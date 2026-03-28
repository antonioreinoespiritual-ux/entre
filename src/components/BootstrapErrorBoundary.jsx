import React from 'react';

/**
 * Top-level error boundary.
 *
 * Prevents the entire screen from going blank when an unhandled render error
 * is thrown anywhere in the tree.  Provides a visible recovery UI and clears
 * any persisted state that might be causing a boot loop before reloading.
 */
export class BootstrapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Bootstrap] Error boundary caught an unhandled render error:', error);
    console.error('[Bootstrap] Component stack:', errorInfo?.componentStack);
  }

  handleReload() {
    window.location.reload();
  }

  handleClearAndReload() {
    try {
      // Clear only app-level storage, not auth tokens (Supabase stores those under
      // 'sb-*' keys – leaving them in place avoids forcing a re-login).
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !key.startsWith('sb-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => {
        try { localStorage.removeItem(k); } catch {}
      });
      console.warn('[Bootstrap] Cleared app storage before reload. Removed keys:', keysToRemove);
    } catch (e) {
      console.warn('[Bootstrap] Could not clear storage:', e);
    }

    // Also delete the comments-mode IndexedDB so stale data cannot re-trigger the error.
    try {
      window.indexedDB?.deleteDatabase('entre-comments-mode-db');
    } catch {}

    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message || 'Unknown error';

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
      }}>
        <div style={{
          maxWidth: 480,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: '2rem',
          boxShadow: '0 1px 8px rgba(0,0,0,0.07)',
        }}>
          <h2 style={{ color: '#111827', marginTop: 0, fontSize: '1.2rem' }}>
            Algo salió mal al cargar la app
          </h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', fontFamily: 'monospace', wordBreak: 'break-word' }}>
            {message}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '0.5rem 1rem',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Reintentar
            </button>
            <button
              onClick={this.handleClearAndReload}
              style={{
                padding: '0.5rem 1rem',
                background: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Limpiar caché y reintentar
            </button>
          </div>
          <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: 0, marginTop: '1rem' }}>
            Si el problema persiste, abre la consola del navegador para ver el detalle técnico.
          </p>
        </div>
      </div>
    );
  }
}

/**
 * Lightweight inner boundary used around individual route subtrees.
 * Falls back to a minimal inline message instead of crashing the whole layout.
 */
export class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RouteErrorBoundary] Render error in route:', error);
    console.error('[RouteErrorBoundary] Component stack:', errorInfo?.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        color: '#374151',
      }}>
        <h3 style={{ marginTop: 0 }}>Error al cargar esta sección</h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', fontFamily: 'monospace' }}>
          {this.state.error?.message || 'Unknown error'}
        </p>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{
            padding: '0.4rem 0.9rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}
