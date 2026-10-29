<script>
  import { Languages } from '@lucide/svelte';
  import { locale, switchLocale, m } from '../application/i18nStore.js';
</script>

<div
  title={m.lang_switch_title({}, { locale: $locale })}
  class="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-950 border border-slate-800"
>
  <Languages class="w-3.5 h-3.5 text-indigo-400 ml-2 mr-1 shrink-0" />
  <button
    type="button"
    onclick={() => switchLocale('fr')}
    class="px-2 py-1 rounded-lg text-[11px] font-bold uppercase transition-all {$locale === 'fr'
      ? 'bg-indigo-600 text-white shadow'
      : 'text-slate-400 hover:text-slate-200'}"
  >
    FR
  </button>
  <button
    type="button"
    onclick={() => switchLocale('en')}
    class="px-2 py-1 rounded-lg text-[11px] font-bold uppercase transition-all {$locale === 'en'
      ? 'bg-indigo-600 text-white shadow'
      : 'text-slate-400 hover:text-slate-200'}"
  >
    EN
  </button>
</div>
