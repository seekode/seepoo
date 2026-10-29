<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initThemeListeners } from '$lib/features/theme/application/themeStore.js';
  import { getSocket } from '$lib/features/realtime/infrastructure/socketClient.js';

  let { children } = $props();

  onMount(() => {
    getSocket();
    const cleanupTheme = initThemeListeners();
    return () => {
      cleanupTheme?.();
    };
  });
</script>

{@render children?.()}
