<script>
  import { Sun, Moon } from '@lucide/svelte';
  import { theme, toggleTheme } from '../application/themeStore.js';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';
</script>

<button
  type="button"
  onclick={toggleTheme}
  title={m.theme_toggle_title({}, { locale: $locale })}
  class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition-colors cursor-pointer"
>
  {#if $theme === 'dark'}
    <Sun class="w-3.5 h-3.5 text-amber-400" />
    <span class="hidden sm:inline">{m.theme_light({}, { locale: $locale })}</span>
  {:else}
    <Moon class="w-3.5 h-3.5 text-indigo-400" />
    <span class="hidden sm:inline">{m.theme_dark({}, { locale: $locale })}</span>
  {/if}
</button>
