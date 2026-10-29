import { writable } from 'svelte/store';
import { m } from '$lib/paraglide/messages.js';
import { getLocale, setLocale as setParaglideLocale, locales } from '$lib/paraglide/runtime.js';

function detectInitialLocale() {
  if (typeof window === 'undefined') return 'fr';
  try {
    const current = getLocale();
    if (locales.includes(current)) return current;
  } catch {
    // Fallback
  }
  return 'fr';
}

export const locale = writable(detectInitialLocale());

/**
 * Change la langue active (FR / EN) via Paraglide sans recharger la page
 * et met à jour l'attribut lang de <html>.
 */
export function switchLocale(nextLocale) {
  if (!locales.includes(nextLocale)) return;
  try {
    setParaglideLocale(nextLocale, { reload: false });
  } catch {
    // Fallback localStorage direct
    try {
      localStorage.setItem('PARAGLIDE_LOCALE', nextLocale);
    } catch {
      // ignore
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = nextLocale;
  }
  locale.set(nextLocale);
}

export { m, locales };
