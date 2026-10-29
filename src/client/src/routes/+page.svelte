<script>
  import { Layers, Box, Wifi, WifiOff, AlertTriangle, Code2 } from '@lucide/svelte';
  import ClassCanvas from '$lib/features/class-diagram/presentation/ClassCanvas.svelte';
  import ObjectPlayground from '$lib/features/object-playground/presentation/ObjectPlayground.svelte';
  import LanguageSwitcher from '$lib/features/i18n/presentation/LanguageSwitcher.svelte';
  import ThemeToggle from '$lib/features/theme/presentation/ThemeToggle.svelte';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';
  import {
    connected,
    architecture,
    saveDraft,
    instantiateObject,
    executeObjectMethod,
    selectLanguage
  } from '$lib/features/realtime/infrastructure/socketClient.js';

  let activeTab = $state('classes'); // 'classes' | 'objects'
</script>

<div class="h-screen w-screen flex flex-col bg-slate-950 text-slate-100">
  <!-- Barre de navigation supérieure -->
  <header
    class="h-14 px-6 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between shrink-0 gap-4"
  >
    <div class="flex items-center gap-3">
      <div
        class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30"
      >
        P
      </div>
      <div>
        <h1 class="text-sm font-bold tracking-tight flex items-center gap-2">
          SeePOO <span class="text-xs font-mono text-indigo-400">v1.0.0</span>
        </h1>
        <p class="text-[11px] text-slate-400">
          {m.app_subtitle({}, { locale: $locale })}
        </p>
      </div>
    </div>

    <!-- Sélecteur des 2 onglets principaux -->
    <nav class="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
      <button
        type="button"
        onclick={() => (activeTab = 'classes')}
        class="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all {activeTab ===
        'classes'
          ? 'bg-indigo-600 text-white shadow'
          : 'text-slate-400 hover:text-slate-200'}"
      >
        <Layers class="w-3.5 h-3.5" />
        <span>{m.tab_classes({}, { locale: $locale })}</span>
      </button>

      <button
        type="button"
        onclick={() => (activeTab = 'objects')}
        class="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all {activeTab ===
        'objects'
          ? 'bg-indigo-600 text-white shadow'
          : 'text-slate-400 hover:text-slate-200'}"
      >
        <Box class="w-3.5 h-3.5" />
        <span>{m.tab_objects({}, { locale: $locale })}</span>
      </button>
    </nav>

    <!-- Actions globales : Filtre Langage Code, Langue UI (Paraglide FR/EN), Thème (Clair/Sombre) & Statut WebSocket -->
    <div class="flex items-center gap-2.5 text-xs">
      <!-- Sélecteur de langage de programmation (Toutes / JS / TS / Python / Java) -->
      <div
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300"
        title={m.prog_lang_filter_title({}, { locale: $locale })}
      >
        <Code2 class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <select
          aria-label={m.prog_lang_filter_title({}, { locale: $locale })}
          value={$architecture.activeLanguage || 'all'}
          onchange={(e) => selectLanguage(e.currentTarget.value)}
          class="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer"
        >
          <option value="all" class="bg-slate-900 text-slate-100">
            {m.prog_lang_all({}, { locale: $locale })}
          </option>
          <option value="javascript" class="bg-slate-900 text-slate-100">JavaScript (.js)</option>
          <option value="typescript" class="bg-slate-900 text-slate-100">TypeScript (.ts)</option>
          <option value="python" class="bg-slate-900 text-slate-100">Python (.py)</option>
          <option value="java" class="bg-slate-900 text-slate-100">Java (.java)</option>
        </select>
      </div>

      <LanguageSwitcher />
      <ThemeToggle />

      {#if $connected}
        <span
          class="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-full"
        >
          <Wifi class="w-3.5 h-3.5" />
          <span class="hidden md:inline">{m.ws_connected({}, { locale: $locale })}</span>
        </span>
      {:else}
        <span
          class="flex items-center gap-1.5 text-rose-400 bg-rose-950/60 border border-rose-500/30 px-2.5 py-1 rounded-full"
        >
          <WifiOff class="w-3.5 h-3.5" />
          <span class="hidden md:inline">{m.ws_disconnected({}, { locale: $locale })}</span>
        </span>
      {/if}
    </div>
  </header>

  <!-- Bannière d'erreurs de syntaxe éventuelles -->
  {#if $architecture.errors?.length > 0}
    <div
      class="bg-rose-950/90 border-b border-rose-500/40 px-6 py-2 text-xs text-rose-200 flex items-center gap-2"
    >
      <AlertTriangle class="w-4 h-4 text-rose-400 shrink-0" />
      <span>
        <strong>
          {m.syntax_error_prefix({ file: $architecture.errors[0].file }, { locale: $locale })}
        </strong>
        {$architecture.errors[0].message}
      </span>
    </div>
  {/if}

  <!-- Contenu principal -->
  <main class="flex-1 min-h-0 relative">
    {#if activeTab === 'classes'}
      <ClassCanvas
        classes={$architecture.classes}
        draft={$architecture.draft}
        onSaveDraft={saveDraft}
      />
    {:else}
      <ObjectPlayground
        classes={$architecture.classes}
        draft={$architecture.draft}
        onSaveDraft={saveDraft}
        onInstantiate={instantiateObject}
        onExecuteMethod={executeObjectMethod}
      />
    {/if}
  </main>
</div>
