import { useEffect } from 'react';

/**
 * Prevents the browser's back button from exiting the SPA.
 *
 * Strategy: push a sentinel history entry after login. When the user hits
 * back, popstate fires — we push the sentinel again so the page never
 * leaves the app. Navigation inside the app remains untouched because we
 * don't use the browser history for that (state-based routing).
 *
 * This is app-level safety net only. It does NOT replace proper routing.
 *
 * @param {boolean} active  — enable the guard (usually: only when logged in)
 * @param {() => void} [onBack] — optional callback when back is intercepted
 */
export function useBackButtonGuard(active, onBack) {
  useEffect(() => {
    if (!active) return;

    // Push an initial sentinel so there's always something to pop to
    try { window.history.pushState({ __omega: true }, ''); } catch { /* ignore */ }

    function onPop() {
      // Put the sentinel back and stay put
      try { window.history.pushState({ __omega: true }, ''); } catch { /* ignore */ }
      if (typeof onBack === 'function') {
        try { onBack(); } catch { /* ignore */ }
      }
    }

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active, onBack]);
}
