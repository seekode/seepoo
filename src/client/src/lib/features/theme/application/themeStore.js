import { writable } from 'svelte/store';

const COLOR_SCHEME_KEY = 'color-scheme';

function getSystemScheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialResolvedTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(COLOR_SCHEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return getSystemScheme();
}

export const theme = writable(getInitialResolvedTheme());

function syncDomWithScheme(metaValue, resolvedTheme) {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = metaValue;
  }
  document.documentElement.dataset.theme = resolvedTheme;
  theme.set(resolvedTheme);
}

/**
 * Initialise les écouteurs système (`prefers-color-scheme`) et `storage` inter-onglets
 * conformément aux bonnes pratiques `dark-mode-toggle`.
 */
export function initThemeListeners() {
  if (typeof window === 'undefined') return () => {};

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = (e) => {
    try {
      const stored = localStorage.getItem(COLOR_SCHEME_KEY);
      if (stored !== 'light' && stored !== 'dark') {
        syncDomWithScheme('light dark', e.matches ? 'dark' : 'light');
      }
    } catch {
      syncDomWithScheme('light dark', e.matches ? 'dark' : 'light');
    }
  };

  const onStorageChange = (e) => {
    if (e.key === COLOR_SCHEME_KEY) {
      const val = e.newValue;
      const resolved = val === 'light' || val === 'dark' ? val : getSystemScheme();
      syncDomWithScheme(val ?? 'light dark', resolved);
    }
  };

  mql.addEventListener('change', onSystemChange);
  window.addEventListener('storage', onStorageChange);

  // Synchronisation initiale
  const currentResolved = getInitialResolvedTheme();
  let stored = null;
  try {
    stored = localStorage.getItem(COLOR_SCHEME_KEY);
  } catch {
    // ignore
  }
  syncDomWithScheme(stored ?? 'light dark', currentResolved);

  return () => {
    mql.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorageChange);
  };
}

/**
 * Bascule entre le thème Clair et le thème Sombre :
 * - Si la cible correspond à la préférence système actuelle, supprime la surcharge dans localStorage
 *   et remet `<meta name="color-scheme" content="light dark">`.
 * - Sinon, stocke la surcharge explicite (`light` ou `dark`) et met à jour `<meta name="color-scheme">`.
 */
export function toggleTheme() {
  if (typeof window === 'undefined') return;

  let currentRendered = getSystemScheme();
  try {
    const stored = localStorage.getItem(COLOR_SCHEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      currentRendered = stored;
    }
  } catch {
    // ignore
  }

  const targetScheme = currentRendered === 'dark' ? 'light' : 'dark';
  const systemScheme = getSystemScheme();

  try {
    if (targetScheme === systemScheme) {
      localStorage.removeItem(COLOR_SCHEME_KEY);
      syncDomWithScheme('light dark', targetScheme);
    } else {
      localStorage.setItem(COLOR_SCHEME_KEY, targetScheme);
      syncDomWithScheme(targetScheme, targetScheme);
    }
  } catch {
    syncDomWithScheme(targetScheme, targetScheme);
  }
}
