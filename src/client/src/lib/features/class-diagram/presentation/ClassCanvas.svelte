<script>
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    Lock,
    Unlock,
    Plus,
    FileCode,
    Trash2,
    Minimize2,
    Maximize2,
    MousePointerClick,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    ArrowLeftRight,
    ChevronRight,
    StickyNote
  } from '@lucide/svelte';
  import {
    JS_PRIMITIVE_TYPES,
    HTML_TYPE_EMOJI,
    DEFAULT_CLASS_EMOJI,
    POSTIT_COLORS,
    CAMERA_STORAGE_KEY,
    LANGUAGE_BADGE_META
  } from '../domain/constants.js';
  import { computeRoutedEdges } from '../domain/edgeRouter.js';
  import EmojiPickerPopover from './EmojiPickerPopover.svelte';
  import { formatPropertyType, formatMethodBody } from '$lib/shared/domain/geometry.js';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';
  import { theme } from '$lib/features/theme/application/themeStore.js';

  let { classes = [], draft = {}, onSaveDraft } = $props();

  let viewportEl = $state(null);
  let cardEls = {};
  let propEls = {};
  let noteTextareaEls = {};
  let cameraRestoredFromDraft = false;

  /**
   * Suivi des classes récemment déplacées par l'utilisateur pour empêcher tout "saut"
   * (jump) au relâchement du clic avant que l'aller-retour WebSocket ne revienne.
   */
  let pendingPositionSaves = new SvelteMap();

  let positions = $state({});
  let cardSizes = $state({});
  let propOffsets = $state({});
  let notes = $state([]);
  let noteDrag = $state(null);

  function loadInitialCamera() {
    if (typeof window === 'undefined') return { x: 0, y: 0, zoom: 1 };
    try {
      const saved = localStorage.getItem(CAMERA_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed?.x === 'number' &&
          typeof parsed?.y === 'number' &&
          typeof parsed?.zoom === 'number'
        ) {
          cameraRestoredFromDraft = true;
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return { x: 0, y: 0, zoom: 1 };
  }

  let camera = $state(loadInitialCamera());
  let expandedClassName = $state(null);
  let openMethodName = $state(null);
  let emojiPickerState = $state(null); // { clsName, screenX, screenY, placement }
  let isClosingEmojiPicker = $state(false);
  let emojiPickerCloseTimer = null;
  let hoveredEdgeId = $state(null);

  let dragState = $state(null);
  let panDrag = $state(null);
  let linkDrag = $state(null);

  let contextMenu = $state(null);
  let newClassName = $state('');

  let propName = $state('');
  let propIsPrivate = $state(false);
  let propValueType = $state('string');
  let propArrayItemType = $state('string');
  let propDefault = $state('');

  let methodName = $state('');
  let methodIsPrivate = $state(false);
  let methodParams = $state('');
  let methodJsdoc = $state('');

  let classNamesSet = $derived(new Set(classes.map((c) => c.name)));

  let routedEdges = $derived(
    computeRoutedEdges(classes, positions, cardSizes, propOffsets, classNamesSet)
  );

  function getClassEmoji(clsName) {
    const draftEntry = (draft?.classes || []).find((c) => c.name === clsName);
    if (draftEntry?.emoji) return draftEntry.emoji;
    const clsEntry = classes.find((c) => c.name === clsName);
    return clsEntry?.emoji || DEFAULT_CLASS_EMOJI;
  }

  function bindCardEl(node, clsName) {
    cardEls[clsName] = node;
    let resizeObs = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => {
        measureCardsAndProps();
      });
      resizeObs.observe(node);
    }
    measureCardsAndProps();
    return {
      update(newName) {
        if (newName !== clsName) {
          delete cardEls[clsName];
          clsName = newName;
          cardEls[clsName] = node;
        }
        measureCardsAndProps();
      },
      destroy() {
        if (resizeObs) resizeObs.disconnect();
        delete cardEls[clsName];
      }
    };
  }

  function bindPropEl(node, propKey) {
    propEls[propKey] = node;
    measureCardsAndProps();
    return {
      update(newKey) {
        if (newKey !== propKey) {
          delete propEls[propKey];
          propKey = newKey;
          propEls[propKey] = node;
        }
        measureCardsAndProps();
      },
      destroy() {
        delete propEls[propKey];
      }
    };
  }

  function bindNoteTextarea(node, noteId) {
    noteTextareaEls[noteId] = node;
    return {
      destroy() {
        delete noteTextareaEls[noteId];
      }
    };
  }

  function measureCardsAndProps() {
    const nextSizes = {};
    const nextPropOffsets = {};

    for (const cls of classes) {
      const cardEl = cardEls[cls.name];
      if (cardEl) {
        const cardWidth = cardEl.offsetWidth || 310;
        const cardHeight = cardEl.offsetHeight || 220;
        nextSizes[cls.name] = { width: cardWidth, height: cardHeight };

        const cardRect = cardEl.getBoundingClientRect();
        const scale = cardRect.width / cardWidth || 1;

        for (const prop of cls.properties || []) {
          const propKey = `${cls.name}::${prop.name}`;
          const propEl = propEls[propKey];
          if (propEl) {
            const propRect = propEl.getBoundingClientRect();
            nextPropOffsets[propKey] = {
              left: (propRect.left - cardRect.left) / scale,
              right: (propRect.right - cardRect.left) / scale,
              centerY: (propRect.top - cardRect.top + propRect.height / 2) / scale
            };
          }
        }
      }
    }
    cardSizes = nextSizes;
    propOffsets = nextPropOffsets;
  }

  // Synchronisation des notes et caméra depuis .poo-draft.json
  $effect(() => {
    if (noteDrag) return;
    const incomingNotes = Array.isArray(draft?.notes)
      ? draft.notes
      : Array.isArray(draft?.positions?.__notes__)
      ? draft.positions.__notes__
      : null;
    if (incomingNotes) {
      notes = incomingNotes;
    }

    if (!cameraRestoredFromDraft && draft?.positions?.__camera__) {
      const savedCam = draft.positions.__camera__;
      if (
        typeof savedCam.x === 'number' &&
        typeof savedCam.y === 'number' &&
        typeof savedCam.zoom === 'number'
      ) {
        cameraRestoredFromDraft = true;
        camera = savedCam;
      }
    }
  });

  // Sauvegarde automatique de la caméra
  $effect(() => {
    const camSnapshot = { x: camera.x, y: camera.y, zoom: camera.zoom };
    try {
      localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(camSnapshot));
    } catch {
      // ignore
    }

    const timer = setTimeout(() => {
      persistDraftUpdate({ updatedCamera: camSnapshot });
    }, 350);

    return () => clearTimeout(timer);
  });

  // Synchronisation des positions des classes sans provoquer de "saut" au relâchement du drag
  $effect(() => {
    const incomingClasses = classes;
    untrack(() => {
      const next = { ...positions };
      let changed = false;
      const now = Date.now();

      incomingClasses.forEach((cls, idx) => {
        const isCurrentlyDragged = dragState?.clsName === cls.name;
        if (isCurrentlyDragged) return;

        const pending = pendingPositionSaves.get(cls.name);
        if (pending) {
          if (
            cls.position &&
            cls.position.x === pending.x &&
            cls.position.y === pending.y
          ) {
            pendingPositionSaves.delete(cls.name);
          } else if (now - pending.timestamp < 1500) {
            return;
          } else {
            pendingPositionSaves.delete(cls.name);
          }
        }

        if (cls.position) {
          if (
            !next[cls.name] ||
            next[cls.name].x !== cls.position.x ||
            next[cls.name].y !== cls.position.y
          ) {
            next[cls.name] = { x: cls.position.x, y: cls.position.y };
            changed = true;
          }
        } else if (!next[cls.name]) {
          next[cls.name] = {
            x: 100 + (idx % 3) * 380,
            y: 100 + Math.floor(idx / 3) * 320
          };
          changed = true;
        }
      });

      if (changed) {
        positions = next;
      }
      tick().then(measureCardsAndProps);
    });
  });

  onMount(() => {
    measureCardsAndProps();
    const onResize = () => measureCardsAndProps();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (emojiPickerState) {
          closeEmojiPicker();
          return;
        }
        if (expandedClassName) closeExpandedCard();
        contextMenu = null;
        linkDrag = null;
      }
    };

    const onWheelListener = (e) => handleWheel(e);
    if (viewportEl) {
      viewportEl.addEventListener('wheel', onWheelListener, { passive: false });
    }

    // Intercepter Ctrl+Molette au niveau global pour empêcher le zoom natif de la page du navigateur
    const onGlobalWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', onGlobalWheel, { passive: false });

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (viewportEl) {
        viewportEl.removeEventListener('wheel', onWheelListener);
      }
      window.removeEventListener('wheel', onGlobalWheel);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  function toggleExpandedCard(clsName) {
    if (expandedClassName === clsName) {
      closeExpandedCard();
    } else {
      openMethodName = null;
      propName = '';
      propDefault = '';
      methodName = '';
      methodParams = '';
      methodJsdoc = '';
      expandedClassName = clsName;
      tick().then(measureCardsAndProps);
    }
  }

  function closeExpandedCard() {
    if (!expandedClassName) return;
    expandedClassName = null;
    openMethodName = null;
    tick().then(measureCardsAndProps);
  }

  async function persistDraftUpdate({
    updatedDraftClasses,
    updatedPositions,
    updatedNotes,
    updatedCamera
  }) {
    if (!onSaveDraft) return;
    const patch = {};
    if (updatedDraftClasses !== undefined) patch.classes = updatedDraftClasses;

    const basePositions =
      updatedPositions !== undefined
        ? { ...updatedPositions }
        : { ...(draft?.positions || {}), ...positions };

    const finalNotes = updatedNotes !== undefined ? updatedNotes : notes;
    const finalCamera = updatedCamera !== undefined ? updatedCamera : camera;

    basePositions.__notes__ = finalNotes;
    basePositions.__camera__ = finalCamera;

    patch.positions = basePositions;
    patch.notes = finalNotes;
    await onSaveDraft(patch);
  }

  function handleCenterOnClasses() {
    if (classes.length === 0) {
      camera = { x: 0, y: 0, zoom: 1 };
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    classes.forEach((cls, idx) => {
      const pos = positions[cls.name] ||
        cls.position || {
          x: 100 + (idx % 3) * 380,
          y: 100 + Math.floor(idx / 3) * 320
        };
      const size = cardSizes[cls.name] || { width: 310, height: 220 };

      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    });

    const worldCenterX = (minX + maxX) / 2;
    const worldCenterY = (minY + maxY) / 2;

    const vpRect = viewportEl?.getBoundingClientRect();
    const vpWidth = vpRect?.width || window.innerWidth;
    const vpHeight = vpRect?.height || window.innerHeight;

    const targetZoom = 1;
    camera = {
      x: Math.round(vpWidth / 2 - worldCenterX * targetZoom),
      y: Math.round(vpHeight / 2 - worldCenterY * targetZoom),
      zoom: targetZoom
    };
  }

  async function persistNotes(nextNotes) {
    notes = nextNotes;
    await persistDraftUpdate({ updatedNotes: nextNotes });
  }

  function ensureDraftClassEntry(draftClassesList, clsName) {
    let entry = draftClassesList.find((c) => c.name === clsName);
    if (!entry) {
      const existingAstCls = classes.find((c) => c.name === clsName);
      entry = {
        name: clsName,
        emoji: existingAstCls?.emoji || DEFAULT_CLASS_EMOJI,
        superClass: existingAstCls?.superClass || null,
        properties: [],
        methods: []
      };
      draftClassesList.push(entry);
    }
    return entry;
  }

  function closeEmojiPicker(immediate = false) {
    if (!emojiPickerState) return;
    if (emojiPickerCloseTimer) {
      clearTimeout(emojiPickerCloseTimer);
      emojiPickerCloseTimer = null;
    }
    if (immediate) {
      emojiPickerState = null;
      isClosingEmojiPicker = false;
      return;
    }
    isClosingEmojiPicker = true;
    emojiPickerCloseTimer = setTimeout(() => {
      emojiPickerState = null;
      isClosingEmojiPicker = false;
      emojiPickerCloseTimer = null;
    }, 150);
  }

  function handleOpenEmojiPicker(e, clsName) {
    e.stopPropagation();
    if (emojiPickerCloseTimer) {
      clearTimeout(emojiPickerCloseTimer);
      emojiPickerCloseTimer = null;
    }
    if (emojiPickerState?.clsName === clsName && !isClosingEmojiPicker) {
      closeEmojiPicker();
      return;
    }
    isClosingEmojiPicker = false;
    const btnRect = e.currentTarget.getBoundingClientRect();
    const popoverWidth = 360;
    const popoverHeight = 360;

    let left = btnRect.left;
    let top = btnRect.bottom + 6;
    let placement = 'bottom';

    // Ajuster si débordement à droite de l'écran
    if (left + popoverWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popoverWidth - 16);
    }
    // Ajuster si débordement en bas de l'écran
    if (top + popoverHeight > window.innerHeight - 16) {
      top = Math.max(16, btnRect.top - popoverHeight - 6);
      placement = 'top';
    }

    emojiPickerState = {
      clsName,
      screenX: Math.round(left),
      screenY: Math.round(top),
      placement
    };
  }

  async function handleSelectClassEmoji(clsName, newEmoji) {
    const currentDraftClasses = structuredClone(draft?.classes || []);
    const entry = ensureDraftClassEntry(currentDraftClasses, clsName);
    entry.emoji = newEmoji;
    closeEmojiPicker();
    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleSetInheritance(childClassName, parentClassName) {
    if (!childClassName || childClassName === parentClassName) return;

    const currentDraftClasses = structuredClone(draft?.classes || []);
    const childEntry = ensureDraftClassEntry(currentDraftClasses, childClassName);
    childEntry.superClass = parentClassName;

    if (parentClassName) {
      const parentCls = classes.find((c) => c.name === parentClassName);
      if (parentCls?.superClass === childClassName) {
        const parentEntry = ensureDraftClassEntry(currentDraftClasses, parentClassName);
        parentEntry.superClass = null;
      }
    }

    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleReverseInheritance(e, currentChildName, currentParentName) {
    e.stopPropagation();
    const currentDraftClasses = structuredClone(draft?.classes || []);

    const oldChildEntry = ensureDraftClassEntry(currentDraftClasses, currentChildName);
    oldChildEntry.superClass = null;

    const newChildEntry = ensureDraftClassEntry(currentDraftClasses, currentParentName);
    newChildEntry.superClass = currentChildName;

    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleDeleteInheritance(e, currentChildName) {
    e.preventDefault();
    e.stopPropagation();

    const currentDraftClasses = structuredClone(draft?.classes || []);
    const childEntry = ensureDraftClassEntry(currentDraftClasses, currentChildName);
    childEntry.superClass = null;

    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  function handleStartPlusLinkDrag(e, sourceClassName) {
    e.stopPropagation();
    e.preventDefault();
    contextMenu = null;

    const rect = viewportEl.getBoundingClientRect();
    const startX = (e.clientX - rect.left - camera.x) / camera.zoom;
    const startY = (e.clientY - rect.top - camera.y) / camera.zoom;

    linkDrag = {
      sourceClass: sourceClassName,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      hoveredTargetClass: null
    };
  }

  function isScrollableElement(target) {
    if (!target || !(target instanceof Element)) return false;
    let el = target;
    while (el && el !== viewportEl) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') {
        return true;
      }
      if (
        el.classList?.contains('custom-scrollbar') ||
        el.classList?.contains('overflow-y-auto') ||
        el.classList?.contains('overflow-x-auto') ||
        el.classList?.contains('overflow-auto')
      ) {
        return true;
      }
      try {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight
        ) {
          return true;
        }
        if (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          el.scrollWidth > el.clientWidth
        ) {
          return true;
        }
      } catch {
        // ignore
      }
      el = el.parentElement;
    }
    return false;
  }

  function applyZoom(e) {
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let zoomFactor;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch-to-zoom ou Ctrl+Molette : réponse exponentielle ultra-fluide
      zoomFactor = Math.exp(-e.deltaY * 0.006);
    } else {
      // Molette classique sur fond de canevas
      zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    }

    zoomFactor = Math.min(1.25, Math.max(0.75, zoomFactor));
    const nextZoom = Math.min(2, Math.max(0.35, Number((camera.zoom * zoomFactor).toFixed(3))));
    const nextX = mouseX - ((mouseX - camera.x) / camera.zoom) * nextZoom;
    const nextY = mouseY - ((mouseY - camera.y) / camera.zoom) * nextZoom;

    camera = { x: nextX, y: nextY, zoom: nextZoom };
    tick().then(measureCardsAndProps);
  }

  function handleWheel(e) {
    // 1. Si Ctrl est enfoncé (Ctrl+Molette) ou Trackpad pinch-to-zoom (ctrlKey === true) :
    // On bloque le zoom natif de la page du navigateur et on zoome l'application !
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      applyZoom(e);
      return;
    }

    // 2. Si le curseur est au-dessus d'un élément scrollable (ex: classe trop grande, popup emoji, note...) :
    // On laisse le défilement naturel s'effectuer sans bloquer et sans zoomer !
    if (isScrollableElement(e.target)) {
      return;
    }

    // 3. Sinon (curseur sur le fond du canevas ou zone non scrollable) :
    // La molette zoome le canevas
    e.preventDefault();
    applyZoom(e);
  }

  function handleCardPointerDown(e, clsName) {
    if (e.button !== 0) return;
    // Ignorer le drag si l'utilisateur clique dans un champ interactif (input, select, button, textarea, form)
    if (e.target.closest('button, input, select, textarea, label')) {
      return;
    }
    e.stopPropagation();
    contextMenu = null;

    const pos = positions[clsName] || { x: 100, y: 100 };
    dragState = {
      clsName,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false
    };
  }

  function handleNotePointerDown(e, noteId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    contextMenu = null;
    closeEmojiPicker();

    const targetNote = notes.find((n) => n.id === noteId);
    if (!targetNote) return;

    noteDrag = {
      id: noteId,
      startX: e.clientX,
      startY: e.clientY,
      originX: targetNote.x,
      originY: targetNote.y
    };
  }

  function handleCanvasPointerDown(e) {
    if (e.button !== 0) return;
    contextMenu = null;
    closeEmojiPicker();
    if (expandedClassName) {
      closeExpandedCard();
    }
    panDrag = {
      startX: e.clientX,
      startY: e.clientY,
      originCamX: camera.x,
      originCamY: camera.y
    };
  }

  function handlePointerMove(e) {
    if (linkDrag) {
      const rect = viewportEl.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - camera.x) / camera.zoom;
      const worldY = (e.clientY - rect.top - camera.y) / camera.zoom;

      let hoveredTarget = null;
      for (const cls of classes) {
        if (cls.name === linkDrag.sourceClass) continue;
        const pos = positions[cls.name];
        const size = cardSizes[cls.name] || { width: 310, height: 220 };
        if (
          pos &&
          worldX >= pos.x &&
          worldX <= pos.x + size.width &&
          worldY >= pos.y &&
          worldY <= pos.y + size.height
        ) {
          hoveredTarget = cls.name;
          break;
        }
      }

      linkDrag = {
        ...linkDrag,
        currentX: worldX,
        currentY: worldY,
        hoveredTargetClass: hoveredTarget
      };
      return;
    }

    if (noteDrag) {
      const dxScreen = e.clientX - noteDrag.startX;
      const dyScreen = e.clientY - noteDrag.startY;
      const newX = Math.round(noteDrag.originX + dxScreen / camera.zoom);
      const newY = Math.round(noteDrag.originY + dyScreen / camera.zoom);

      notes = notes.map((n) => (n.id === noteDrag.id ? { ...n, x: newX, y: newY } : n));
      return;
    }

    if (dragState) {
      const dxScreen = e.clientX - dragState.startX;
      const dyScreen = e.clientY - dragState.startY;
      const moved = dragState.moved || Math.hypot(dxScreen, dyScreen) > 5;

      const newX = Math.round(dragState.originX + dxScreen / camera.zoom);
      const newY = Math.round(dragState.originY + dyScreen / camera.zoom);

      dragState = { ...dragState, moved };
      positions = {
        ...positions,
        [dragState.clsName]: { x: newX, y: newY }
      };
      return;
    }

    if (panDrag) {
      const dx = e.clientX - panDrag.startX;
      const dy = e.clientY - panDrag.startY;
      camera = {
        ...camera,
        x: panDrag.originCamX + dx,
        y: panDrag.originCamY + dy
      };
    }
  }

  async function handlePointerUp() {
    if (linkDrag) {
      const { sourceClass, hoveredTargetClass } = linkDrag;
      linkDrag = null;
      if (hoveredTargetClass && hoveredTargetClass !== sourceClass) {
        await handleSetInheritance(sourceClass, hoveredTargetClass);
      }
      return;
    }

    if (noteDrag) {
      noteDrag = null;
      await persistNotes(notes);
      return;
    }

    if (dragState) {
      const { clsName, moved } = dragState;
      const finalPos = positions[clsName];
      if (moved && finalPos) {
        pendingPositionSaves.set(clsName, {
          x: finalPos.x,
          y: finalPos.y,
          timestamp: Date.now()
        });
      }
      dragState = null;

      if (!moved) {
        if (expandedClassName !== clsName) {
          toggleExpandedCard(clsName);
        }
      } else {
        await persistDraftUpdate({
          updatedPositions: {
            ...(draft?.positions || {}),
            ...positions
          }
        });
      }
    }

    if (panDrag) {
      panDrag = null;
    }
  }

  function handleCanvasContextMenu(e) {
    e.preventDefault();

    const rect = viewportEl.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const worldX = Math.round((screenX - camera.x) / camera.zoom - 120);
    const worldY = Math.round((screenY - camera.y) / camera.zoom - 25);

    contextMenu = { screenX, screenY, worldX, worldY, step: 'choose' };
    newClassName = '';
  }

  async function handleCreateNoteAtCursor() {
    if (!contextMenu) return;
    const newNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      x: contextMenu.worldX,
      y: contextMenu.worldY,
      text: '',
      color: 'yellow'
    };
    const nextNotes = [...notes, newNote];
    contextMenu = null;
    await persistNotes(nextNotes);

    requestAnimationFrame(() => {
      noteTextareaEls[newNote.id]?.focus();
    });
  }

  function handleUpdateNoteText(noteId, newText) {
    notes = notes.map((n) => (n.id === noteId ? { ...n, text: newText } : n));
  }

  async function handleSaveNotesToDisk() {
    await persistNotes(notes);
  }

  async function handleChangeNoteColor(noteId, newColor) {
    const nextNotes = notes.map((n) => (n.id === noteId ? { ...n, color: newColor } : n));
    await persistNotes(nextNotes);
  }

  async function handleDeleteNote(noteId) {
    const nextNotes = notes.filter((n) => n.id !== noteId);
    await persistNotes(nextNotes);
  }

  async function handleCreateClassAtCursor(e) {
    e.preventDefault();
    const cleanName = newClassName.trim();
    if (!cleanName || !contextMenu) return;

    const currentDraftClasses = [...(draft?.classes || [])];
    if (!currentDraftClasses.some((c) => c.name === cleanName)) {
      currentDraftClasses.push({
        name: cleanName,
        superClass: null,
        jsdoc: '',
        properties: [],
        methods: []
      });
    }

    const newPos = { x: contextMenu.worldX, y: contextMenu.worldY };
    pendingPositionSaves.set(cleanName, {
      x: newPos.x,
      y: newPos.y,
      timestamp: Date.now()
    });

    const updatedPositions = {
      ...(draft?.positions || {}),
      ...positions,
      [cleanName]: newPos
    };

    positions = updatedPositions;
    contextMenu = null;
    await persistDraftUpdate({
      updatedDraftClasses: currentDraftClasses,
      updatedPositions
    });
  }

  async function handleDeleteDraftClass(clsName) {
    const filteredClasses = (draft?.classes || []).filter((c) => c.name !== clsName);
    const updatedPositions = { ...(draft?.positions || {}), ...positions };
    delete updatedPositions[clsName];

    if (expandedClassName === clsName) {
      expandedClassName = null;
    }
    await persistDraftUpdate({
      updatedDraftClasses: filteredClasses,
      updatedPositions
    });
  }

  async function handleAddDraftProperty(e, clsName) {
    e.preventDefault();
    let raw = propName.trim();
    if (!raw) return;

    if (propIsPrivate && !raw.startsWith('#')) raw = `#${raw}`;
    else if (!propIsPrivate && raw.startsWith('#')) raw = raw.slice(1);

    const currentDraftClasses = structuredClone(draft?.classes || []);
    const targetDraftCls = ensureDraftClassEntry(currentDraftClasses, clsName);

    targetDraftCls.properties = targetDraftCls.properties || [];
    const existingIdx = targetDraftCls.properties.findIndex((p) => p.name === raw);

    const newPropObj = {
      name: raw,
      isPrivate: raw.startsWith('#'),
      valueType: propValueType,
      arrayItemType: propValueType === 'Array' ? propArrayItemType : null,
      defaultValue: propDefault.trim() || null
    };

    if (existingIdx >= 0) {
      targetDraftCls.properties[existingIdx] = newPropObj;
    } else {
      targetDraftCls.properties.push(newPropObj);
    }

    propName = '';
    propDefault = '';
    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleDeleteDraftProperty(clsName, targetPropName) {
    const currentDraftClasses = structuredClone(draft?.classes || []);
    const targetDraftCls = currentDraftClasses.find((c) => c.name === clsName);
    if (!targetDraftCls) return;

    targetDraftCls.properties = (targetDraftCls.properties || []).filter(
      (p) => p.name !== targetPropName
    );
    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleAddDraftMethod(e, clsName) {
    e.preventDefault();
    let raw = methodName.trim();
    if (!raw) return;

    if (methodIsPrivate && !raw.startsWith('#')) raw = `#${raw}`;
    else if (!methodIsPrivate && raw.startsWith('#')) raw = raw.slice(1);

    const paramsArray = methodParams
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const currentDraftClasses = structuredClone(draft?.classes || []);
    const targetDraftCls = ensureDraftClassEntry(currentDraftClasses, clsName);

    targetDraftCls.methods = targetDraftCls.methods || [];
    if (!targetDraftCls.methods.some((mItem) => mItem.name === raw)) {
      targetDraftCls.methods.push({
        name: raw,
        params: paramsArray,
        jsdoc: methodJsdoc.trim() || ''
      });
    }

    methodName = '';
    methodParams = '';
    methodJsdoc = '';
    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }

  async function handleDeleteDraftMethod(clsName, targetMethodName) {
    const currentDraftClasses = structuredClone(draft?.classes || []);
    const targetDraftCls = currentDraftClasses.find((c) => c.name === clsName);
    if (!targetDraftCls) return;

    targetDraftCls.methods = (targetDraftCls.methods || []).filter(
      (mItem) => mItem.name !== targetMethodName
    );
    await persistDraftUpdate({ updatedDraftClasses: currentDraftClasses });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={viewportEl}
  onpointerdown={handleCanvasPointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  oncontextmenu={handleCanvasContextMenu}
  style:background-image="radial-gradient({$theme === 'light' ? '#cbd5e1' : '#334155'} 1.5px, transparent 1.5px)"
  style:background-size="{24 * camera.zoom}px {24 * camera.zoom}px"
  style:background-position="{camera.x}px {camera.y}px"
  class="relative h-full w-full overflow-hidden select-none bg-slate-950 cursor-grab active:cursor-grabbing"
>
  <!-- Barre d'aide flottante en haut à gauche -->
  <div
    onpointerdown={(e) => e.stopPropagation()}
    class="absolute top-4 left-4 z-20 flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg text-xs text-slate-300 flex-wrap"
  >
    <span class="flex items-center gap-1.5">
      <MousePointerClick class="w-3.5 h-3.5 text-amber-400" />
      <strong>{m.help_right_click_bold({}, { locale: $locale })}</strong>
      {m.help_right_click_desc({}, { locale: $locale })}
    </span>
    <span class="text-slate-700">|</span>
    <span class="flex items-center gap-1.5">
      <Plus class="w-3.5 h-3.5 text-indigo-400" />
      <strong>{m.help_drag_plus_bold({}, { locale: $locale })}</strong>
      {m.help_drag_plus_desc({}, { locale: $locale })}
    </span>
    <span class="text-slate-700">|</span>
    <span class="flex items-center gap-1.5">
      <ArrowLeftRight class="w-3.5 h-3.5 text-emerald-400" />
      <strong>{m.help_extends_arrow_bold({}, { locale: $locale })}</strong>
      {m.help_extends_arrow_desc({}, { locale: $locale })}
    </span>
  </div>

  <!-- Contrôles de Zoom en bas à gauche -->
  <div
    onpointerdown={(e) => e.stopPropagation()}
    class="absolute bottom-4 left-4 z-20 flex items-center gap-1 p-1.5 rounded-xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg text-xs text-slate-300"
  >
    <button
      type="button"
      onclick={() => {
        camera = { ...camera, zoom: Math.max(0.35, Number((camera.zoom - 0.1).toFixed(2))) };
        tick().then(measureCardsAndProps);
      }}
      class="p-1.5 rounded-lg hover:bg-slate-800"
      title={m.zoom_out({}, { locale: $locale })}
    >
      <ZoomOut class="w-4 h-4" />
    </button>
    <span class="px-2 font-mono text-[11px]">{Math.round(camera.zoom * 100)}%</span>
    <button
      type="button"
      onclick={() => {
        camera = { ...camera, zoom: Math.min(2, Number((camera.zoom + 0.1).toFixed(2))) };
        tick().then(measureCardsAndProps);
      }}
      class="p-1.5 rounded-lg hover:bg-slate-800"
      title={m.zoom_in({}, { locale: $locale })}
    >
      <ZoomIn class="w-4 h-4" />
    </button>
    <button
      type="button"
      onclick={handleCenterOnClasses}
      class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
      title={m.recenter_classes({}, { locale: $locale })}
    >
      <RotateCcw class="w-3.5 h-3.5" />
    </button>
  </div>

  <!-- CONTENEUR MONDE INFINI ACCÉLÉRÉ GPU -->
  <div
    style:transform="translate3d({camera.x}px, {camera.y}px, 0) scale({camera.zoom})"
    style:transform-origin="0 0"
    class="absolute top-0 left-0 w-0 h-0 pointer-events-none"
  >
    <!-- Calque SVG des flèches routées sans collision -->
    <svg
      class="overflow-visible pointer-events-none"
      style="position: absolute; left: 0; top: 0; width: 1px; height: 1px; z-index: 5;"
    >
      <defs>
        <marker
          id="arrow-extends-solid"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1.5 L 11 6.5 L 1 11.5 Z" fill="#6366f1" stroke="#e0e7ff" stroke-width="1.5" stroke-linejoin="round" />
        </marker>

        <marker
          id="arrow-extends-draft"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1.5 L 11 6.5 L 1 11.5 Z" fill="#f59e0b" stroke="#fef3c7" stroke-width="1.5" stroke-linejoin="round" />
        </marker>

        <marker
          id="arrow-contains"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 1 1.5 L 11 6.5 L 1 11.5 L 3.5 6.5 Z"
            fill="#06b6d4"
            stroke="#cffafe"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </marker>

        <marker
          id="arrow-extends-dragging"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1.5 L 11 6.5 L 1 11.5 Z" fill="#10b981" stroke="#d1fae5" stroke-width="1.5" stroke-linejoin="round" />
        </marker>

        <marker
          id="arrow-extends-hovered"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1.5 L 11 6.5 L 1 11.5 Z" fill="#10b981" stroke="#d1fae5" stroke-width="1.5" stroke-linejoin="round" />
        </marker>

        <marker
          id="arrow-contains-hovered"
          markerWidth="13"
          markerHeight="13"
          refX="11"
          refY="6.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 1 1.5 L 11 6.5 L 1 11.5 L 3.5 6.5 Z"
            fill="#10b981"
            stroke="#d1fae5"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </marker>
      </defs>

      <!-- ÉTAPE 1 : Courbes (traits) avec survol synchronisé -->
      {#each routedEdges as edge (`line-${edge.id}`)}
        {@const isHovered = hoveredEdgeId === edge.id}
        {#if edge.kind === 'extends'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <g
            onpointerenter={() => (hoveredEdgeId = edge.id)}
            onpointerleave={() => {
              if (hoveredEdgeId === edge.id) hoveredEdgeId = null;
            }}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => handleReverseInheritance(e, edge.sourceClass, edge.targetClass)}
            oncontextmenu={(e) => handleDeleteInheritance(e, edge.sourceClass)}
            class="pointer-events-auto cursor-pointer"
          >
            <title>
              {m.edge_extends_tooltip(
                { target: edge.targetClass, source: edge.sourceClass },
                { locale: $locale }
              )}
            </title>
            <path d={edge.pathD} fill="none" stroke="transparent" stroke-width="24" />
            <path
              d={edge.pathD}
              fill="none"
              stroke={isHovered ? '#10b981' : edge.isDraft ? '#f59e0b' : '#818cf8'}
              stroke-width={isHovered ? '3.5' : '2.8'}
              stroke-dasharray={edge.isDraft ? '7 5' : undefined}
              marker-end={isHovered
                ? 'url(#arrow-extends-hovered)'
                : edge.isDraft
                ? 'url(#arrow-extends-draft)'
                : 'url(#arrow-extends-solid)'}
              class="transition-colors duration-150"
            />
          </g>
        {:else}
          <g
            onpointerenter={() => (hoveredEdgeId = edge.id)}
            onpointerleave={() => {
              if (hoveredEdgeId === edge.id) hoveredEdgeId = null;
            }}
            class="pointer-events-auto"
          >
            <circle
              cx={edge.startPt.x}
              cy={edge.startPt.y}
              r={isHovered ? '5' : '4'}
              fill={isHovered ? '#10b981' : '#06b6d4'}
              stroke={isHovered ? '#d1fae5' : '#cffafe'}
              stroke-width="1.5"
              class="transition-colors duration-150"
            />
            <path d={edge.pathD} fill="none" stroke="transparent" stroke-width="22" />
            <path
              d={edge.pathD}
              fill="none"
              stroke={isHovered ? '#10b981' : '#06b6d4'}
              stroke-width={isHovered ? '3.2' : '2.4'}
              stroke-dasharray={edge.isDraft ? '5 4' : '10 4'}
              marker-end={isHovered ? 'url(#arrow-contains-hovered)' : 'url(#arrow-contains)'}
              class="transition-colors duration-150"
            />
          </g>
        {/if}
      {/each}

      <!-- ÉTAPE 2 : Boîtes d'étiquettes anti-collision avec survol synchronisé -->
      {#each routedEdges as edge (`box-${edge.id}`)}
        {@const isHovered = hoveredEdgeId === edge.id}
        {#if edge.kind === 'extends'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <g
            transform="translate({edge.labelX}, {edge.labelY})"
            onpointerenter={() => (hoveredEdgeId = edge.id)}
            onpointerleave={() => {
              if (hoveredEdgeId === edge.id) hoveredEdgeId = null;
            }}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => handleReverseInheritance(e, edge.sourceClass, edge.targetClass)}
            oncontextmenu={(e) => handleDeleteInheritance(e, edge.sourceClass)}
            class="pointer-events-auto cursor-pointer"
          >
            <title>
              {m.edge_extends_tooltip(
                { target: edge.targetClass, source: edge.sourceClass },
                { locale: $locale }
              )}
            </title>
            <rect
              x={-edge.boxWidth / 2}
              y={-edge.boxHeight / 2}
              width={edge.boxWidth}
              height={edge.boxHeight}
              rx="8"
              fill={$theme === 'light'
                ? isHovered
                  ? '#ecfdf5'
                  : '#eef2ff'
                : isHovered
                ? '#064e3b'
                : '#0f172a'}
              stroke={isHovered ? '#10b981' : edge.isDraft ? '#f59e0b' : '#6366f1'}
              stroke-width={isHovered ? '2.4' : '1.5'}
              class="transition-colors duration-150"
            />
            <text
              x="0"
              y="4"
              text-anchor="middle"
              fill={isHovered
                ? $theme === 'light'
                  ? '#047857'
                  : '#a7f3d0'
                : edge.isDraft
                ? $theme === 'light'
                  ? '#b45309'
                  : '#fcd34d'
                : $theme === 'light'
                ? '#3730a3'
                : '#c7d2fe'}
              font-size="10"
              font-family="monospace"
              font-weight="bold"
            >
              extends &rarr; {edge.targetClass}
            </text>
          </g>
        {:else}
          <g
            transform="translate({edge.labelX}, {edge.labelY})"
            onpointerenter={() => (hoveredEdgeId = edge.id)}
            onpointerleave={() => {
              if (hoveredEdgeId === edge.id) hoveredEdgeId = null;
            }}
            class="pointer-events-auto"
          >
            <rect
              x={-edge.boxWidth / 2}
              y={-edge.boxHeight / 2}
              width={edge.boxWidth}
              height={edge.boxHeight}
              rx="8"
              fill={$theme === 'light'
                ? isHovered
                  ? '#ecfdf5'
                  : '#ecfeff'
                : isHovered
                ? '#064e3b'
                : '#083344'}
              stroke={isHovered ? '#10b981' : '#06b6d4'}
              stroke-width={isHovered ? '2.4' : '1.5'}
              class="transition-colors duration-150"
            />
            <text
              x="0"
              y="4"
              text-anchor="middle"
              fill={isHovered
                ? $theme === 'light'
                  ? '#047857'
                  : '#a7f3d0'
                : $theme === 'light'
                ? '#0e7490'
                : '#a5f3fc'}
              font-size="10.5"
              font-family="monospace"
            >
              <tspan
                fill={isHovered
                  ? $theme === 'light'
                    ? '#059669'
                    : '#6ee7b7'
                  : $theme === 'light'
                  ? '#0891b2'
                  : '#67e8f9'}
              >
                contains&nbsp;
              </tspan>
              <tspan
                font-weight="900"
                fill={$theme === 'light' ? '#0f172a' : '#ffffff'}
                font-size="11.5"
              >
                {edge.cardinality}
              </tspan>
            </text>
          </g>
        {/if}
      {/each}

      <!-- Flèche temporaire en cours de tirage depuis le bouton "+" -->
      {#if linkDrag}
        <line
          x1={linkDrag.startX}
          y1={linkDrag.startY}
          x2={linkDrag.currentX}
          y2={linkDrag.currentY}
          stroke="#10b981"
          stroke-width="3"
          stroke-dasharray="6 4"
          marker-end="url(#arrow-extends-dragging)"
        />
      {/if}
    </svg>

    <!-- Cartes des classes sur le schéma (s'agrandissent sur place au clic sans modale centrée) -->
    {#each classes as cls (cls.name)}
      {@const isDraftOnly = cls.status === 'draft-only'}
      {@const pos = positions[cls.name] || { x: 100, y: 100 }}
      {@const isBeingDragged = dragState?.clsName === cls.name}
      {@const isLinkTarget = linkDrag?.hoveredTargetClass === cls.name}
      {@const isExpanded = expandedClassName === cls.name}
      {@const isEmojiPickerOpen = emojiPickerState?.clsName === cls.name}
      {@const classEmoji = getClassEmoji(cls.name)}
      {@const langMeta = cls.language ? LANGUAGE_BADGE_META[cls.language] : null}

      <div
        use:bindCardEl={cls.name}
        style:transform="translate3d({pos.x}px, {pos.y}px, 0)"
        style:width={isExpanded ? '560px' : '310px'}
        style:max-height={isExpanded ? '640px' : '480px'}
        style:transition="width 300ms cubic-bezier(0.22, 1, 0.36, 1), max-height 340ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease"
        onpointerdown={(e) => handleCardPointerDown(e, cls.name)}
        oncontextmenu={(e) => e.stopPropagation()}
        class="group pointer-events-auto absolute top-0 left-0 rounded-2xl flex flex-col overflow-hidden {isEmojiPickerOpen
          ? 'z-50 shadow-2xl ring-2 ring-indigo-400'
          : isExpanded
          ? 'z-40 shadow-2xl ring-2 ring-indigo-500/80'
          : isLinkTarget
          ? 'z-30 ring-4 ring-emerald-400/60 border-2 border-emerald-400 bg-slate-900 scale-[1.02]'
          : isBeingDragged
          ? 'z-30 shadow-2xl ring-2 ring-indigo-400'
          : 'z-10 shadow-xl'} {!isLinkTarget
          ? isDraftOnly
            ? 'bg-slate-900/95 border-2 border-dashed border-amber-500/75 hover:border-amber-400 cursor-grab active:cursor-grabbing'
            : isExpanded
            ? 'bg-slate-900 border-2 border-indigo-500 cursor-grab active:cursor-grabbing'
            : 'bg-slate-900/95 border-2 border-slate-700 hover:border-indigo-400 cursor-grab active:cursor-grabbing'
          : ''}"
      >
        <!-- En-tête de la carte sur le schéma -->
        <div
          class="px-4 py-3 border-b rounded-t-2xl flex items-start justify-between gap-2 shrink-0 {isDraftOnly
            ? 'bg-amber-950/25 border-amber-500/30'
            : 'bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-900 border-slate-800'}"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <!-- BOUTON EMOJI (ouvre le sélecteur d'emoji au niveau racine) -->
              <button
                type="button"
                onclick={(e) => handleOpenEmojiPicker(e, cls.name)}
                onpointerdown={(e) => e.stopPropagation()}
                title={m.change_emoji_title({}, { locale: $locale })}
                class="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 hover:border-indigo-400 flex items-center justify-center text-base leading-none transition-transform hover:scale-110 cursor-pointer shrink-0 {isEmojiPickerOpen
                  ? 'ring-2 ring-indigo-400 bg-slate-700'
                  : ''}"
              >
                {classEmoji}
              </button>

              <span class="text-base font-bold text-white tracking-tight">{cls.name}</span>

              {#if langMeta}
                <span
                  title={langMeta.title}
                  class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border {langMeta.bg} {langMeta.text} {langMeta.border}"
                >
                  {langMeta.label}
                </span>
              {/if}

              <!-- BOUTON "+" POUR TIRER UN LIEN D'HÉRITAGE -->
              <button
                type="button"
                onpointerdown={(e) => handleStartPlusLinkDrag(e, cls.name)}
                title={m.drag_inheritance_title({ className: cls.name }, { locale: $locale })}
                class="w-6 h-6 rounded-full bg-indigo-600 hover:bg-emerald-500 text-white border border-indigo-400/60 shadow-md flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 cursor-crosshair shrink-0"
              >
                <Plus class="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              {#if cls.superClass}
                <span
                  class="text-[11px] font-mono text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-500/30"
                >
                  extends {cls.superClass}
                </span>
              {/if}
              {#if isDraftOnly}
                <span
                  class="text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded"
                >
                  {isExpanded
                    ? m.badge_draft_class({}, { locale: $locale })
                    : m.badge_draft({}, { locale: $locale })}
                </span>
              {/if}
            </div>

            {#if cls.file}
              <span class="flex items-center gap-1 text-[11px] font-mono text-slate-400 mt-1">
                <FileCode class="w-3 h-3 text-indigo-400" />
                {cls.file}
              </span>
            {/if}

            {#if isExpanded && cls.jsdoc?.summary}
              <p class="text-xs text-slate-300 mt-1.5 italic transition-all duration-200">
                « {cls.jsdoc.summary} »
              </p>
            {/if}
          </div>

          <div
            class="flex items-center gap-1.5 shrink-0"
            onpointerdown={(e) => e.stopPropagation()}
          >
            {#if isExpanded && isDraftOnly}
              <button
                type="button"
                onclick={() => handleDeleteDraftClass(cls.name)}
                class="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-colors cursor-pointer"
              >
                <Trash2 class="w-3 h-3" />
                <span>{m.delete_class_btn({}, { locale: $locale })}</span>
              </button>
            {/if}

            <button
              type="button"
              onclick={() => toggleExpandedCard(cls.name)}
              title={isExpanded
                ? m.collapse_card_title({}, { locale: $locale })
                : m.expand_card_title({}, { locale: $locale })}
              class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              {#if isExpanded}
                <Minimize2 class="w-3.5 h-3.5" />
              {:else}
                <Maximize2 class="w-3.5 h-3.5" />
              {/if}
            </button>
          </div>
        </div>

        <!-- Corps de la carte avec défilement fluide et hauteur max -->
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar transition-all duration-200">
          {#if !isExpanded}
            <!-- Aperçu compact des Propriétés & Méthodes -->
            <div class="p-3.5 space-y-3">
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  {m.properties_count({ count: cls.properties.length }, { locale: $locale })}
                </div>
                {#if cls.properties.length === 0}
                  <p class="text-[11px] text-slate-500 italic">
                    {m.properties_empty({}, { locale: $locale })}
                  </p>
                {:else}
                  <div class="space-y-1">
                    {#each cls.properties as p (p.name)}
                      {@const typeStr = formatPropertyType(p)}
                      {@const targetCls = p.valueType === 'Array' ? p.arrayItemType : p.valueType}
                      {@const isClassRef = classNamesSet.has(targetCls)}
                      {@const isHtmlRef = targetCls === 'HTML'}
                      {@const propKey = `${cls.name}::${p.name}`}

                      <div
                        use:bindPropEl={propKey}
                        class="flex items-center justify-between gap-2 px-2 py-1 rounded text-xs font-mono {p.status ===
                        'draft-only'
                          ? 'border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-200'
                          : p.isPrivate
                          ? 'bg-slate-800/70 text-slate-300'
                          : 'bg-slate-950/70 text-emerald-300'}"
                      >
                        <span class="flex items-center gap-1.5 truncate">
                          {#if p.isPrivate}
                            <Lock class="w-3 h-3 text-amber-400 shrink-0" />
                          {:else}
                            <Unlock class="w-3 h-3 text-emerald-400 shrink-0" />
                          {/if}
                          <span class="truncate">{p.name}</span>
                        </span>

                        <span
                          class="text-[10px] px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 {isClassRef
                            ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 font-semibold'
                            : isHtmlRef
                            ? 'bg-orange-950/80 text-orange-300 border border-orange-500/40 font-semibold'
                            : 'text-slate-400 bg-slate-900/80'}"
                        >
                          {#if isClassRef}
                            <span>{getClassEmoji(targetCls)}</span>
                          {/if}
                          {#if isHtmlRef}
                            <span>{HTML_TYPE_EMOJI}</span>
                          {/if}
                          <span>: {typeStr}</span>
                        </span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>

              <div class="border-t border-slate-800 pt-2.5">
                <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  {m.methods_count({ count: cls.methods.length }, { locale: $locale })}
                </div>
                {#if cls.methods.length === 0}
                  <p class="text-[11px] text-slate-500 italic">
                    {m.methods_empty({}, { locale: $locale })}
                  </p>
                {:else}
                  <div class="space-y-1">
                    {#each cls.methods as mItem (mItem.name)}
                      <div
                        class="flex items-center justify-between px-2 py-1 rounded text-xs font-mono {mItem.status ===
                        'draft-only'
                          ? 'border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-200'
                          : 'bg-slate-950/80 text-indigo-300'}"
                      >
                        <span class="truncate">
                          {mItem.name}({mItem.params.map((p) => p.name).join(', ')})
                        </span>
                        {#if mItem.status === 'draft-only'}
                          <span class="text-[10px] font-sans text-amber-300">
                            {m.badge_draft({}, { locale: $locale })}
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <!-- Vue détaillée agrandie SUR PLACE -->
            <div class="p-5 space-y-5 cursor-default">
              <!-- 1. PROPRIÉTÉS -->
              <div>
                <div
                  class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between gap-2 flex-wrap"
                >
                  <span>
                    {m.properties_count({ count: cls.properties.length }, { locale: $locale })}
                  </span>
                  <span class="text-[11px] font-normal text-slate-500">
                    {m.properties_contains_hint({}, { locale: $locale })}
                  </span>
                </div>

                <div class="space-y-1.5">
                  {#each cls.properties as p (p.name)}
                    {@const isPropDraft = p.status === 'draft-only'}
                    {@const typeStr = formatPropertyType(p)}
                    {@const targetCls = p.valueType === 'Array' ? p.arrayItemType : p.valueType}
                    {@const isClassRef = classNamesSet.has(targetCls)}
                    {@const isHtmlRef = targetCls === 'HTML'}
                    {@const propKey = `${cls.name}::${p.name}`}

                    <div
                      use:bindPropEl={propKey}
                      class="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono {isPropDraft
                        ? 'border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-200'
                        : p.isPrivate
                        ? 'bg-slate-800/80 text-slate-200'
                        : 'bg-slate-950 text-emerald-300 border border-slate-800'}"
                    >
                      <div class="flex items-center gap-2 flex-wrap">
                        {#if p.isPrivate}
                          <Lock class="w-3.5 h-3.5 text-amber-400" />
                        {:else}
                          <Unlock class="w-3.5 h-3.5 text-emerald-400" />
                        {/if}
                        <span class="font-semibold">{p.name}</span>

                        <span
                          class="px-2 py-0.5 rounded text-[11px] flex items-center gap-1 {isClassRef
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-semibold'
                            : isHtmlRef
                            ? 'bg-orange-950 text-orange-300 border border-orange-500/40 font-semibold'
                            : 'bg-slate-900 text-slate-400 border border-slate-800'}"
                        >
                          {#if isClassRef}
                            <span>{getClassEmoji(targetCls)}</span>
                          {/if}
                          {#if isHtmlRef}
                            <span>{HTML_TYPE_EMOJI}</span>
                          {/if}
                          <span>: {typeStr}</span>
                        </span>

                        {#if p.defaultValue}
                          <span class="text-slate-400">= {p.defaultValue}</span>
                        {/if}
                      </div>

                      <div class="flex items-center gap-2">
                        {#if isPropDraft}
                          <span
                            class="text-[10px] font-sans bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded"
                          >
                            {m.badge_draft({}, { locale: $locale })}
                          </span>
                          <button
                            type="button"
                            onclick={() => handleDeleteDraftProperty(cls.name, p.name)}
                            title={m.delete_draft_prop_title({}, { locale: $locale })}
                            class="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-colors cursor-pointer"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>

                <!-- Formulaire d'ajout de Propriété Draft -->
                <form
                  onsubmit={(e) => handleAddDraftProperty(e, cls.name)}
                  onpointerdown={(e) => e.stopPropagation()}
                  class="mt-3 p-3 rounded-xl bg-slate-950 border border-dashed border-slate-700 space-y-2.5"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onclick={() => (propIsPrivate = !propIsPrivate)}
                      class="px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-1 border cursor-pointer {propIsPrivate
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}"
                    >
                      {#if propIsPrivate}
                        <Lock class="w-3 h-3" /> {m.visibility_private({}, { locale: $locale })}
                      {:else}
                        <Unlock class="w-3 h-3" /> {m.visibility_public({}, { locale: $locale })}
                      {/if}
                    </button>

                    <input
                      type="text"
                      placeholder={propIsPrivate
                        ? m.prop_name_placeholder_priv({}, { locale: $locale })
                        : m.prop_name_placeholder_pub({}, { locale: $locale })}
                      bind:value={propName}
                      class="flex-1 min-w-[130px] px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none select-text"
                    />

                    <div class="flex items-center gap-1.5">
                      <label
                        class="text-[11px] text-slate-400 font-mono"
                        for="prop-type-select-{cls.name}"
                      >
                        {m.prop_type_label({}, { locale: $locale })}
                      </label>
                      <select
                        id="prop-type-select-{cls.name}"
                        bind:value={propValueType}
                        class="px-2.5 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-cyan-300 focus:border-cyan-400 focus:outline-none"
                      >
                        <optgroup label={m.optgroup_native_types({}, { locale: $locale })}>
                          {#each JS_PRIMITIVE_TYPES as t (t)}
                            <option value={t}>
                              {t === 'Array'
                                ? m.type_array_option({}, { locale: $locale })
                                : t === 'HTML'
                                ? m.type_html_option({}, { locale: $locale })
                                : t}
                            </option>
                          {/each}
                        </optgroup>
                        <optgroup label={m.optgroup_schema_classes({}, { locale: $locale })}>
                          {#each classes as c (c.name)}
                            <option value={c.name}>
                              {getClassEmoji(c.name)} {c.name}
                              {c.status === 'draft-only'
                                ? `(${m.badge_draft({}, { locale: $locale })})`
                                : ''}
                            </option>
                          {/each}
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 flex-wrap">
                    {#if propValueType === 'Array'}
                      <div
                        class="flex items-center gap-1.5 bg-cyan-950/40 border border-cyan-500/30 px-2.5 py-1 rounded-lg"
                      >
                        <label
                          class="text-[11px] text-cyan-300 font-mono"
                          for="prop-array-item-select-{cls.name}"
                        >
                          {m.array_items_label({}, { locale: $locale })}
                        </label>
                        <select
                          id="prop-array-item-select-{cls.name}"
                          bind:value={propArrayItemType}
                          class="px-2 py-1 text-xs font-mono bg-slate-900 border border-cyan-500/40 rounded text-cyan-200 focus:outline-none"
                        >
                          <optgroup label={m.optgroup_native_types({}, { locale: $locale })}>
                            {#each JS_PRIMITIVE_TYPES.filter((t) => t !== 'Array') as t (t)}
                              <option value={t}>{t}</option>
                            {/each}
                          </optgroup>
                          <optgroup label={m.optgroup_schema_classes({}, { locale: $locale })}>
                            {#each classes as c (c.name)}
                              <option value={c.name}>
                                {getClassEmoji(c.name)} {c.name}
                                {c.status === 'draft-only'
                                  ? `(${m.badge_draft({}, { locale: $locale })})`
                                  : ''}
                              </option>
                            {/each}
                          </optgroup>
                        </select>
                      </div>
                    {/if}

                    <input
                      type="text"
                      placeholder={m.prop_default_placeholder({}, { locale: $locale })}
                      bind:value={propDefault}
                      class="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none select-text"
                    />

                    <button
                      type="submit"
                      class="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      <Plus class="w-3.5 h-3.5" />
                      {m.add_property_btn({}, { locale: $locale })}
                    </button>
                  </div>
                </form>
              </div>

              <!-- 2. MÉTHODES (JSDoc toujours visible, Code masqué par défaut avec accordéon animé) -->
              <div class="border-t border-slate-800 pt-4">
                <div
                  class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between gap-2 flex-wrap"
                >
                  <span>
                    {m.methods_count({ count: cls.methods.length }, { locale: $locale })}
                  </span>
                  <span class="text-[11px] font-normal text-slate-500">
                    {m.methods_click_hint({}, { locale: $locale })}
                  </span>
                </div>

                <div class="space-y-2.5">
                  {#each cls.methods as mItem (mItem.name)}
                    {@const isMethodDraft = mItem.status === 'draft-only'}
                    {@const isMethodOpen = openMethodName === mItem.name}
                    {@const signature = `${mItem.name}(${mItem.params.map((p) => p.name).join(', ')})`}

                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      onpointerdown={(e) => e.stopPropagation()}
                      onclick={() =>
                        (openMethodName = openMethodName === mItem.name ? null : mItem.name)}
                      class="p-3.5 rounded-xl border transition-all duration-300 cursor-pointer select-none {isMethodDraft
                        ? 'border-dashed border-amber-500/60 bg-amber-500/10'
                        : isMethodOpen
                        ? 'border-indigo-500/70 bg-slate-950 shadow-lg shadow-indigo-950/40'
                        : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'}"
                    >
                      <div class="flex items-center justify-between font-mono text-xs gap-2">
                        <span
                          class="flex items-center gap-2 font-bold {isMethodDraft
                            ? 'text-amber-200'
                            : 'text-indigo-300'}"
                        >
                          <ChevronRight
                            class="w-4 h-4 shrink-0 transition-transform duration-300 {isMethodOpen
                              ? 'rotate-90 text-indigo-400'
                              : 'rotate-0 text-slate-400'}"
                          />
                          {#if mItem.isPrivate}
                            <Lock class="w-3.5 h-3.5 text-amber-400" />
                          {/if}
                          <span>{signature}</span>
                        </span>

                        <div class="flex items-center gap-2 shrink-0">
                          <span class="text-[10px] font-sans text-slate-500">
                            {isMethodOpen
                              ? m.method_hide_code({}, { locale: $locale })
                              : m.method_show_code({}, { locale: $locale })}
                          </span>
                          {#if isMethodDraft}
                            <span
                              class="text-[10px] font-sans bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded"
                            >
                              {m.badge_draft_unimplemented({}, { locale: $locale })}
                            </span>
                            <button
                              type="button"
                              onclick={(e) => {
                                e.stopPropagation();
                                handleDeleteDraftMethod(cls.name, mItem.name);
                              }}
                              title={m.delete_draft_method_title({}, { locale: $locale })}
                              class="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 class="w-4 h-4" />
                            </button>
                          {/if}
                        </div>
                      </div>

                      {#if mItem.jsdoc}
                        <div
                          class="mt-2.5 ml-6 p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200"
                        >
                          <p class="font-medium">📖 {mItem.jsdoc.summary}</p>
                          {#if mItem.jsdoc.tags?.length > 0}
                            <ul class="mt-1 space-y-0.5 text-[11px] font-mono text-indigo-300/80">
                              {#each mItem.jsdoc.tags as t, idx (idx)}
                                <li>@{t.tag} {t.content}</li>
                              {/each}
                            </ul>
                          {/if}
                        </div>
                      {/if}

                      <div
                        style="grid-template-rows: {isMethodOpen ? '1fr' : '0fr'}; transition: grid-template-rows 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease;"
                        class="grid {isMethodOpen ? 'opacity-100' : 'opacity-0'}"
                      >
                        <div class="overflow-hidden">
                          <div class="pt-2.5 ml-6 pl-3 border-l-2 border-indigo-500/40">
                            <pre
                              class="text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap bg-slate-900/90 p-3 rounded-lg border border-slate-800 select-text">{formatMethodBody(
                                mItem.bodyCode,
                                m.method_empty_body({}, { locale: $locale })
                              )}</pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>

                <!-- Formulaire d'ajout de Méthode Draft -->
                <form
                  onsubmit={(e) => handleAddDraftMethod(e, cls.name)}
                  onpointerdown={(e) => e.stopPropagation()}
                  class="mt-4 p-3 rounded-xl bg-slate-950 border border-dashed border-slate-700 space-y-2.5"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onclick={() => (methodIsPrivate = !methodIsPrivate)}
                      class="px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-1 border cursor-pointer {methodIsPrivate
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}"
                    >
                      {#if methodIsPrivate}
                        <Lock class="w-3 h-3" /> {m.visibility_private_f({}, { locale: $locale })}
                      {:else}
                        <Unlock class="w-3 h-3" /> {m.visibility_public_f({}, { locale: $locale })}
                      {/if}
                    </button>

                    <input
                      type="text"
                      placeholder={m.method_name_placeholder({}, { locale: $locale })}
                      bind:value={methodName}
                      class="flex-1 min-w-[120px] px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none select-text"
                    />

                    <input
                      type="text"
                      placeholder={m.method_params_placeholder({}, { locale: $locale })}
                      bind:value={methodParams}
                      class="w-44 px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none select-text"
                    />
                  </div>

                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={m.method_jsdoc_placeholder({}, { locale: $locale })}
                      bind:value={methodJsdoc}
                      class="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none select-text"
                    />

                    <button
                      type="submit"
                      class="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold cursor-pointer"
                    >
                      <Plus class="w-3.5 h-3.5" />
                      {m.add_method_btn({}, { locale: $locale })}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/each}

    <!-- Post-its / Notes de réflexion sur le schéma -->
    {#each notes as note (note.id)}
      {@const noteTheme = POSTIT_COLORS.find((c) => c.id === note.color) || POSTIT_COLORS[0]}
      {@const isBeingDragged = noteDrag?.id === note.id}

      <div
        style:transform="translate3d({note.x}px, {note.y}px, 0)"
        style:width="235px"
        onpointerdown={(e) => e.stopPropagation()}
        oncontextmenu={(e) => e.stopPropagation()}
        class="pointer-events-auto absolute top-0 left-0 rounded-xl border-2 {noteTheme.bg} {noteTheme.border} {isBeingDragged
          ? 'z-40 shadow-2xl scale-[1.02]'
          : 'z-20 shadow-xl'} flex flex-col overflow-hidden transition-shadow"
      >
        <div
          onpointerdown={(e) => handleNotePointerDown(e, note.id)}
          class="px-3 py-1.5 {noteTheme.headerBg} border-b {noteTheme.border} flex items-center justify-between cursor-grab active:cursor-grabbing"
        >
          <span
            class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider {noteTheme.text}"
          >
            <StickyNote class="w-3.5 h-3.5" />
            <span>{m.note_header({}, { locale: $locale })}</span>
          </span>

          <div class="flex items-center gap-1" onpointerdown={(e) => e.stopPropagation()}>
            {#each POSTIT_COLORS as c (c.id)}
              <button
                type="button"
                onclick={() => handleChangeNoteColor(note.id, c.id)}
                title={m.note_color_title({ label: c.label }, { locale: $locale })}
                class="w-3.5 h-3.5 rounded-full {c.dot} border {note.color === c.id ||
                (!note.color && c.id === 'yellow')
                  ? 'border-slate-900 scale-110 ring-1 ring-slate-900/40'
                  : 'border-slate-700/40 opacity-75 hover:opacity-100'}"
              ></button>
            {/each}

            <button
              type="button"
              onclick={() => handleDeleteNote(note.id)}
              title={m.note_delete_title({}, { locale: $locale })}
              class="ml-1 p-0.5 rounded hover:bg-black/10 {noteTheme.text}"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <textarea
          use:bindNoteTextarea={note.id}
          rows="4"
          value={note.text || ''}
          placeholder={m.note_placeholder({}, { locale: $locale })}
          oninput={(e) => handleUpdateNoteText(note.id, e.currentTarget.value)}
          onblur={handleSaveNotesToDisk}
          onpointerdown={(e) => e.stopPropagation()}
          class="w-full p-3 bg-transparent {noteTheme.text} {noteTheme.placeholder} text-xs font-medium leading-relaxed resize-y min-h-[96px] focus:outline-none select-text"
        ></textarea>
      </div>
    {/each}
  </div>

  <!-- Menu contextuel au Clic Droit dans le vide -->
  {#if contextMenu}
    <div
      style:left="{contextMenu.screenX}px"
      style:top="{contextMenu.screenY}px"
      onpointerdown={(e) => e.stopPropagation()}
      oncontextmenu={(e) => e.preventDefault()}
      class="absolute z-50 w-64 rounded-2xl bg-slate-900/95 backdrop-blur border border-slate-700 shadow-2xl overflow-hidden"
    >
      {#if contextMenu.step === 'choose'}
        <div class="p-2 space-y-1">
          <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {m.ctx_menu_header({}, { locale: $locale })}
          </div>

          <button
            type="button"
            onclick={() => (contextMenu = { ...contextMenu, step: 'create-class' })}
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-white hover:bg-indigo-600/25 hover:text-indigo-200 border border-transparent hover:border-indigo-500/40 transition-colors"
          >
            <span class="text-base leading-none">📦</span>
            <div>
              <div>{m.ctx_create_class_title({}, { locale: $locale })}</div>
              <div class="text-[10px] font-normal text-slate-400">
                {m.ctx_create_class_sub({}, { locale: $locale })}
              </div>
            </div>
          </button>

          <button
            type="button"
            onclick={handleCreateNoteAtCursor}
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-white hover:bg-amber-500/20 hover:text-amber-200 border border-transparent hover:border-amber-500/40 transition-colors"
          >
            <span class="text-base leading-none">📝</span>
            <div>
              <div>{m.ctx_create_note_title({}, { locale: $locale })}</div>
              <div class="text-[10px] font-normal text-slate-400">
                {m.ctx_create_note_sub({}, { locale: $locale })}
              </div>
            </div>
          </button>
        </div>
      {:else}
        <div class="p-4 space-y-3">
          <div class="text-xs font-bold text-amber-300">
            {m.ctx_new_draft_class({}, { locale: $locale })}
          </div>

          <form onsubmit={handleCreateClassAtCursor} class="space-y-2.5">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              autofocus
              placeholder={m.ctx_class_name_placeholder({}, { locale: $locale })}
              bind:value={newClassName}
              class="w-full px-3 py-1.5 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-white focus:border-amber-400 focus:outline-none"
            />

            <div class="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onclick={() => (contextMenu = { ...contextMenu, step: 'choose' })}
                class="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                {m.btn_back({}, { locale: $locale })}
              </button>
              <button
                type="submit"
                class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors"
              >
                {m.btn_create({}, { locale: $locale })}
              </button>
            </div>
          </form>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Popup Sélecteur d'emoji au niveau racine (non confiné ni coupé par la carte de classe) -->
  {#if emojiPickerState}
    <!-- Overlay avec transition d'opacité fluide pour fermer au clic en dehors -->
    <div
      class="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[1px] transition-opacity duration-150 {isClosingEmojiPicker
        ? 'opacity-0 pointer-events-none'
        : 'opacity-100'}"
      onpointerdown={(e) => {
        e.stopPropagation();
        closeEmojiPicker();
      }}
    ></div>

    <div
      style:left="{emojiPickerState.screenX}px"
      style:top="{emojiPickerState.screenY}px"
      class="fixed z-50 {isClosingEmojiPicker ? 'pointer-events-none' : 'pointer-events-auto'}"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <EmojiPickerPopover
        className={emojiPickerState.clsName}
        currentEmoji={getClassEmoji(emojiPickerState.clsName)}
        placement={emojiPickerState.placement || 'bottom'}
        isClosing={isClosingEmojiPicker}
        onSelect={(emoji) => {
          handleSelectClassEmoji(emojiPickerState.clsName, emoji);
        }}
        onClose={() => closeEmojiPicker()}
      />
    </div>
  {/if}
</div>
