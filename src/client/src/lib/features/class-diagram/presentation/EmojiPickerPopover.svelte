<script>
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { Search, X, Sparkles } from '@lucide/svelte';
  import {
    ALL_EMOJIS,
    OOP_POPULAR_EMOJIS,
    EMOJI_CATEGORIES,
    FRENCH_SYNONYMS
  } from '../domain/emojiData.js';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';

  let {
    className,
    currentEmoji,
    placement = 'bottom',
    isClosing = false,
    onSelect,
    onClose
  } = $props();

  let searchQuery = $state('');
  let selectedCategory = $state('popular'); // 'popular' | 'all' | 'objects' | ...
  let searchInputEl = $state(null);

  onMount(() => {
    // Focus automatique sur le champ de recherche
    tick().then(() => {
      searchInputEl?.focus();
    });

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  function normalizeText(text) {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  // Filtrage réactif ultra-rapide
  let filteredEmojis = $derived.by(() => {
    const rawQuery = searchQuery.trim();
    const query = normalizeText(rawQuery);

    if (query) {
      // Élargir avec les synonymes français si existants (ex: "banque" -> "bank money finance...")
      const words = query.split(/\s+/).filter(Boolean);
      const expandedTerms = new SvelteSet(words);
      for (const w of words) {
        if (FRENCH_SYNONYMS[w]) {
          FRENCH_SYNONYMS[w].split(/\s+/).forEach((syn) => expandedTerms.add(syn));
        }
      }
      const searchTerms = Array.from(expandedTerms);

      const matches = ALL_EMOJIS.filter((item) => {
        const itemText = `${normalizeText(item.n)} ${normalizeText(item.k)}`;
        return searchTerms.some((term) => itemText.includes(term));
      });

      return matches.slice(0, 140);
    }

    if (selectedCategory === 'popular') {
      return OOP_POPULAR_EMOJIS.map((e) => {
        const found = ALL_EMOJIS.find((item) => item.e === e);
        return found || { e, n: e, g: 'popular', k: '' };
      });
    }

    if (selectedCategory === 'all') {
      return ALL_EMOJIS.slice(0, 140);
    }

    return ALL_EMOJIS.filter((item) => item.g === selectedCategory).slice(0, 140);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
  class="relative z-50 w-80 sm:w-96 rounded-2xl bg-slate-900/98 backdrop-blur-md border border-slate-700 shadow-2xl flex flex-col overflow-hidden text-slate-100 select-none emoji-popover {isClosing
    ? 'emoji-popover-exit'
    : 'emoji-popover-enter'} {placement === 'top'
    ? 'emoji-popover-top'
    : 'emoji-popover-bottom'}"
>
  <!-- En-tête du sélecteur -->
  <div class="px-3.5 pt-3 pb-2 border-b border-slate-800 space-y-2.5">
    <div class="flex items-center justify-between">
      <span class="text-xs font-bold tracking-tight text-white flex items-center gap-1.5">
        <Sparkles class="w-3.5 h-3.5 text-indigo-400" />
        <span>{m.emoji_picker_title({ className }, { locale: $locale })}</span>
      </span>

      <button
        type="button"
        onclick={onClose}
        title="Fermer (Échap)"
        class="w-6 h-6 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Barre de recherche -->
    <div class="relative flex items-center">
      <Search class="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
      <input
        bind:this={searchInputEl}
        type="text"
        bind:value={searchQuery}
        placeholder={m.emoji_search_placeholder({}, { locale: $locale })}
        class="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => {
            searchQuery = '';
            searchInputEl?.focus();
          }}
          class="absolute right-2 text-slate-400 hover:text-white text-xs"
        >
          ✕
        </button>
      {/if}
    </div>

    <!-- Catégories d'emojis -->
    {#if !searchQuery}
      <div class="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar text-[11px]">
        {#each EMOJI_CATEGORIES as cat (cat.id)}
          {@const isActive = selectedCategory === cat.id}
          <button
            type="button"
            onclick={() => (selectedCategory = cat.id)}
            class="px-2 py-1 rounded-lg shrink-0 flex items-center gap-1 font-medium transition-colors cursor-pointer {isActive
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}"
          >
            <span>{cat.icon}</span>
            <span>{$locale === 'en' ? cat.labelEn : cat.labelFr}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Grille d'emojis avec défilement fluide -->
  <div class="p-2.5 max-h-60 overflow-y-auto custom-scrollbar">
    {#if filteredEmojis.length === 0}
      <div class="py-8 text-center text-xs text-slate-500">
        <p>{m.emoji_no_results({}, { locale: $locale })}</p>
      </div>
    {:else}
      <div class="grid grid-cols-7 sm:grid-cols-8 gap-1.5">
        {#each filteredEmojis as item (item.e)}
          {@const isSelected = item.e === currentEmoji}
          <button
            type="button"
            onclick={() => onSelect(item.e)}
            title={item.n}
            class="h-9 rounded-xl flex items-center justify-center text-xl hover:bg-slate-800 hover:scale-120 active:scale-90 transition-all duration-100 cursor-pointer {isSelected
              ? 'bg-indigo-600/35 ring-2 ring-indigo-400 scale-105'
              : ''}"
          >
            {item.e}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Pied avec compte et conseil -->
  <div
    class="px-3.5 py-1.5 bg-slate-950/80 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between"
  >
    <span>{m.emoji_count({ count: filteredEmojis.length }, { locale: $locale })}</span>
    <span class="text-slate-500">Entrée / Échap</span>
  </div>
</div>

<style>
  .emoji-popover {
    will-change: transform, opacity;
  }

  .emoji-popover-bottom {
    transform-origin: top left;
    --anim-enter-y: -10px;
    --anim-exit-y: -6px;
  }

  .emoji-popover-top {
    transform-origin: bottom left;
    --anim-enter-y: 10px;
    --anim-exit-y: 6px;
  }

  /* Entrée énergique avec léger rebond élastique spring */
  .emoji-popover-enter {
    animation: emoji-popover-spring 220ms cubic-bezier(0.34, 1.38, 0.64, 1) forwards;
  }

  /* Sortie rapide et propre en fondu + rétraction */
  .emoji-popover-exit {
    animation: emoji-popover-leave 150ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  @keyframes emoji-popover-spring {
    0% {
      opacity: 0;
      transform: scale(0.88) translateY(var(--anim-enter-y, -10px));
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @keyframes emoji-popover-leave {
    0% {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    100% {
      opacity: 0;
      transform: scale(0.92) translateY(var(--anim-exit-y, -6px));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .emoji-popover-enter,
    .emoji-popover-exit {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }
</style>
