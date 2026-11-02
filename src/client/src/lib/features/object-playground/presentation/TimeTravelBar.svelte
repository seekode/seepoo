<script>
  import { History, ChevronLeft, ChevronRight, Save, RotateCcw, Trash2, X } from '@lucide/svelte';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';

  let {
    steps = [],
    currentStepIndex = 0,
    onSelectStep,
    onSaveStep,
    onDeleteStep,
    onResetPlayground
  } = $props();

  let totalSteps = $derived(steps.length);
  let isViewingPast = $derived(currentStepIndex < totalSteps - 1);
  let currentStepData = $derived(steps[currentStepIndex]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  onpointerdown={(e) => e.stopPropagation()}
  class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3 text-slate-100 flex-wrap"
>
  <div class="flex items-center gap-2 text-xs font-bold text-indigo-400 pr-1">
    <History class="w-4 h-4" />
    <span>{m.tt_title({}, { locale: $locale })}</span>
  </div>

  <div class="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
    <button
      type="button"
      disabled={currentStepIndex <= 0}
      onclick={() => onSelectStep?.(currentStepIndex - 1)}
      class="p-1 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300"
      title={m.tt_prev_step({}, { locale: $locale })}
    >
      <ChevronLeft class="w-4 h-4" />
    </button>

    <div class="flex items-center gap-1 px-1">
      {#each steps as st, idx (idx)}
        {@const isActive = idx === currentStepIndex}
        <div class="relative group flex items-center">
          <button
            type="button"
            onclick={() => onSelectStep?.(idx)}
            title={st.label || m.obj_step_badge({ step: idx }, { locale: $locale })}
            class="px-2.5 py-1 {steps.length > 1 ? 'pr-5' : ''} rounded-lg text-xs font-mono font-bold transition-all {isActive
              ? 'bg-indigo-600 text-white shadow'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'}"
          >
            {m.obj_step_badge({ step: idx }, { locale: $locale })}
          </button>

          {#if steps.length > 1}
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                onDeleteStep?.(idx);
              }}
              title={m.tt_delete_step_title({ step: idx }, { locale: $locale })}
              class="absolute right-1 w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500/80 hover:text-white text-slate-400 cursor-pointer"
            >
              <X class="w-2.5 h-2.5" />
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <button
      type="button"
      disabled={currentStepIndex >= totalSteps - 1}
      onclick={() => onSelectStep?.(currentStepIndex + 1)}
      class="p-1 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300"
      title={m.tt_next_step({}, { locale: $locale })}
    >
      <ChevronRight class="w-4 h-4" />
    </button>
  </div>

  <button
    type="button"
    onclick={onSaveStep}
    title={m.tt_save_title({}, { locale: $locale })}
    class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
  >
    <Save class="w-3.5 h-3.5" />
    <span>{m.tt_save_btn({}, { locale: $locale })}</span>
  </button>

  {#if currentStepData}
    <div
      class="border-l border-slate-800 pl-3 text-[11px] font-mono text-slate-400 hidden sm:flex items-center gap-2"
    >
      <span>
        {m.tt_objects_count({ count: currentStepData.objects?.length || 0 }, { locale: $locale })}
      </span>
      {#if currentStepData.savedAt}
        <span class="text-slate-500">· {currentStepData.savedAt}</span>
      {/if}
    </div>
  {/if}

  {#if isViewingPast}
    <button
      type="button"
      onclick={() => onSelectStep?.(totalSteps - 1)}
      class="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl hover:bg-amber-500/30 font-semibold"
    >
      <RotateCcw class="w-3.5 h-3.5" />
      <span>{m.tt_current_step_btn({ step: totalSteps - 1 }, { locale: $locale })}</span>
    </button>
  {/if}

  {#if steps.length > 1}
    <button
      type="button"
      onclick={() => onDeleteStep?.(currentStepIndex)}
      title={m.tt_delete_current_step_title({ step: currentStepIndex }, { locale: $locale })}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:scale-95 text-rose-300 border border-rose-500/30 text-xs font-semibold shadow-lg shadow-rose-950/40 transition-all cursor-pointer"
    >
      <Trash2 class="w-3.5 h-3.5" />
      <span class="hidden sm:inline">{m.tt_delete_step_btn({}, { locale: $locale })}</span>
    </button>
  {/if}

  <button
    type="button"
    onclick={onResetPlayground}
    title={m.tt_reset_title({}, { locale: $locale })}
    class="p-1.5 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700/60 hover:border-rose-500/40 transition-colors"
  >
    <Trash2 class="w-3.5 h-3.5" />
  </button>
</div>
