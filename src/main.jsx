import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { BootstrapErrorBoundary } from '@/components/BootstrapErrorBoundary';

/**
 * Pre-render storage sanity sweep.
 *
 * Runs synchronously before React mounts.  Removes any localStorage entry
 * that cannot be parsed as valid JSON — these corrupt entries can crash
 * context providers that read them during initialisation.
 *
 * Auth tokens (sb-* keys set by Supabase) are intentionally skipped to
 * avoid forcing a re-login on every recovery.
 */
function sanitizeLocalStorage() {
  if (typeof window === 'undefined') return;
  try {
    const removed = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || key.startsWith('sb-')) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        JSON.parse(raw);
      } catch {
        try { localStorage.removeItem(key); } catch {}
        removed.push(key);
      }
    }
    if (removed.length > 0) {
      console.warn('[Bootstrap] Removed corrupted localStorage entries:', removed);
    }
  } catch (e) {
    console.warn('[Bootstrap] localStorage sanity sweep failed:', e?.message);
  }
}

sanitizeLocalStorage();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BootstrapErrorBoundary>
    <App />
  </BootstrapErrorBoundary>
);
