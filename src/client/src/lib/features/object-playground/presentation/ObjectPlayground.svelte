<script>
  import { onMount, tick } from 'svelte';
  import {
    Lock,
    Unlock,
    Play,
    PlusCircle,
    Trash2,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    Link2,
    Sparkles,
    AlertCircle,
    CheckCircle2,
    X,
    ChevronLeft,
    ChevronRight,
    Smile,
    Minimize2
  } from '@lucide/svelte';
  import { DEFAULT_CLASS_EMOJI } from '$lib/features/class-diagram/domain/constants.js';
  import {
    OBJ_CAMERA_STORAGE_KEY,
    OBJ_STEPS_STORAGE_KEY,
    extractGraphFromServerResponse,
    extractExecDetailsFromResponse,
    computePointerEdges
  } from '../domain/pointerEdgeRouter.js';
  import TimeTravelBar from './TimeTravelBar.svelte';
  import { locale, m } from '$lib/features/i18n/application/i18nStore.js';
  import { theme } from '$lib/features/theme/application/themeStore.js';

  let {
    classes = [],
    draft = {},
    onSaveDraft,
    onInstantiate,
    onExecuteMethod
  } = $props();

  let viewportEl = $state(null);
  let cardEls = {};
  let propEls = {};
  let restoredFromDraft = false;
  let sessionInstanceIds = new Set();

  function loadInitialCamera() {
    if (typeof window === 'undefined') return { x: 0, y: 0, zoom: 1 };
    try {
      const saved = localStorage.getItem(OBJ_CAMERA_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed?.x === 'number' &&
          typeof parsed?.y === 'number' &&
          typeof parsed?.zoom === 'number'
        ) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return { x: 0, y: 0, zoom: 1 };
  }

  function loadInitialStepsState() {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(OBJ_STEPS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) {
            restoredFromDraft = true;
            const validIdx = Math.min(
              Math.max(0, parsed.currentStepIndex || 0),
              parsed.steps.length - 1
            );
            return { steps: parsed.steps, currentStepIndex: validIdx };
          }
        }
      } catch {
        // Fallback
      }
    }
    return {
      steps: [
        {
          stepNumber: 0,
          label: 'Étape 0',
          savedAt: null,
          objects: []
        }
      ],
      currentStepIndex: 0
    };
  }

  const initialStepsState = loadInitialStepsState();
  let camera = $state(loadInitialCamera());
  let steps = $state(initialStepsState.steps);
  let currentStepIndex = $state(initialStepsState.currentStepIndex);

  let isSidebarCollapsed = $state(false);
  let isEmojiView = $state(false);
  let expandedObjectIds = $state(new Set());
  let wasDraggingObject = false;

  let dragState = $state(null);
  let panDrag = $state(null);
  let isDraggingOverCanvas = $state(false);

  let cardSizes = $state({});
  let propOffsets = $state({});

  let methodArgs = $state({});
  let executingKey = $state(null);
  let feedbackByObj = $state({});

  let currentStepData = $derived(steps[currentStepIndex] || { objects: [] });
  let previousStepData = $derived(currentStepIndex > 0 ? steps[currentStepIndex - 1] : null);
  let currentObjects = $derived(currentStepData.objects || []);
  let isViewingPast = $derived(currentStepIndex < steps.length - 1);

  let effectiveCurrentObjects = $derived(
    currentObjects.map((o) => ({ ...o, properties: getEffectiveProperties(o) }))
  );
  let pointerEdges = $derived(
    computePointerEdges(effectiveCurrentObjects, cardSizes, propOffsets, isEmojiView, expandedObjectIds)
  );

  function getClassEmoji(clsName) {
    const draftEntry = (draft?.classes || []).find((c) => c.name === clsName);
    if (draftEntry?.emoji) return draftEntry.emoji;
    const clsEntry = classes.find((c) => c.name === clsName);
    return clsEntry?.emoji || DEFAULT_CLASS_EMOJI;
  }

  function getEffectiveProperties(obj) {
    if (!obj) return [];
    const clsMeta = classes.find((c) => c.name === obj.className);
    const existing = obj.properties || [];
    if (!clsMeta) return existing;

    const existingNames = new Set(existing.map((p) => p.name));
    const missing = [];

    for (const p of clsMeta.properties || []) {
      const rawName = p.name.startsWith('#') ? p.name.slice(1) : p.name;
      if (!existingNames.has(p.name) && !existingNames.has(rawName)) {
        existingNames.add(p.name);
        let defaultVal = null;
        if (p.defaultValue !== undefined && p.defaultValue !== null) {
          try {
            defaultVal = JSON.parse(p.defaultValue);
          } catch {
            defaultVal = p.defaultValue;
          }
        } else if (p.valueType === 'Array') {
          defaultVal = [];
        } else if (p.valueType === 'number') {
          defaultVal = 0;
        } else if (p.valueType === 'boolean') {
          defaultVal = false;
        }

        missing.push({
          name: p.name,
          isPrivate: Boolean(p.isPrivate),
          value: defaultVal,
          status: p.status
        });
      }
    }

    return [...existing, ...missing];
  }

  function isArrayProperty(prop, obj) {
    const clsMeta = classes.find((c) => c.name === obj.className);
    const propMeta = clsMeta?.properties?.find((p) => p.name === prop.name);
    return (
      propMeta?.valueType === 'Array' ||
      Array.isArray(prop.value) ||
      (typeof prop.value === 'string' &&
        prop.value.trim().startsWith('[') &&
        prop.value.trim().endsWith(']'))
    );
  }

  function getArrayItems(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore
      }
    }
    if (val && typeof val === 'object' && val.__type === 'Pointer') {
      return [val];
    }
    return [];
  }

  function handleAddArrayItem(objId, propNameVal, targetObj) {
    const targetPointer = {
      __type: 'Pointer',
      targetId: targetObj.id,
      targetLabel: targetObj.label,
      targetClass: targetObj.className
    };

    updateCurrentStepObjects((prev) =>
      prev.map((obj) => {
        if (obj.id !== objId) return obj;
        const currentProps = [...getEffectiveProperties(obj)];
        const idx = currentProps.findIndex((p) => p.name === propNameVal);
        if (idx >= 0) {
          const currentItems = getArrayItems(currentProps[idx].value);
          currentProps[idx] = {
            ...currentProps[idx],
            value: [...currentItems, targetPointer]
          };
        } else {
          const clsMeta = classes.find((c) => c.name === obj.className);
          const propMeta = clsMeta?.properties?.find((p) => p.name === propNameVal);
          currentProps.push({
            name: propNameVal,
            isPrivate: Boolean(propMeta?.isPrivate),
            status: propMeta?.status,
            value: [targetPointer]
          });
        }
        return { ...obj, properties: currentProps };
      })
    );
  }

  function handleRemoveArrayItem(objId, propNameVal, indexToRemove) {
    updateCurrentStepObjects((prev) =>
      prev.map((obj) => {
        if (obj.id !== objId) return obj;
        const currentProps = [...getEffectiveProperties(obj)].map((p) => {
          if (p.name !== propNameVal) return p;
          const currentItems = getArrayItems(p.value);
          const nextItems = currentItems.filter((_, i) => i !== indexToRemove);
          return { ...p, value: nextItems };
        });
        return { ...obj, properties: currentProps };
      })
    );
  }

  function bindCardEl(node, objId) {
    cardEls[objId] = node;
    measureObjects();
    return {
      update(newId) {
        if (newId !== objId) {
          delete cardEls[objId];
          objId = newId;
          cardEls[objId] = node;
        }
        measureObjects();
      },
      destroy() {
        delete cardEls[objId];
      }
    };
  }

  function bindPropEl(node, propKey) {
    propEls[propKey] = node;
    measureObjects();
    return {
      update(newKey) {
        if (newKey !== propKey) {
          delete propEls[propKey];
          propKey = newKey;
          propEls[propKey] = node;
        }
        measureObjects();
      },
      destroy() {
        delete propEls[propKey];
      }
    };
  }

  function measureObjects() {
    const nextSizes = {};
    const nextPropOffsets = {};

    for (const obj of currentObjects) {
      const cardEl = cardEls[obj.id];
      if (cardEl) {
        const cardWidth = cardEl.offsetWidth || 340;
        const cardHeight = cardEl.offsetHeight || 240;
        nextSizes[obj.id] = { width: cardWidth, height: cardHeight };

        const cardRect = cardEl.getBoundingClientRect();
        const scale = cardRect.width / cardWidth || 1;

        for (const prop of getEffectiveProperties(obj)) {
          const propKey = `${obj.id}::${prop.name}`;
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

  // Persistance de la caméra
  $effect(() => {
    try {
      localStorage.setItem(
        OBJ_CAMERA_STORAGE_KEY,
        JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
      );
    } catch {
      // ignore
    }
  });

  // Restauration depuis .poo-draft.json si localStorage était vide
  $effect(() => {
    if (restoredFromDraft) return;
    const savedPlayground = draft?.positions?.__objectPlayground__;
    if (
      savedPlayground &&
      Array.isArray(savedPlayground.steps) &&
      savedPlayground.steps.length > 0
    ) {
      restoredFromDraft = true;
      steps = savedPlayground.steps;
      currentStepIndex = Math.min(
        Math.max(0, savedPlayground.currentStepIndex || 0),
        savedPlayground.steps.length - 1
      );
    }
  });

  // Sauvegarde automatique des étapes et objets dans localStorage + .poo-draft.json
  $effect(() => {
    const payload = { steps: $state.snapshot(steps), currentStepIndex };
    try {
      localStorage.setItem(OBJ_STEPS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }

    if (!onSaveDraft) return;
    const timer = setTimeout(() => {
      onSaveDraft({
        positions: {
          ...(draft?.positions || {}),
          __objectPlayground__: payload
        }
      });
    }, 400);

    return () => clearTimeout(timer);
  });

  // Remesure quand les objets ou l'étape changent
  $effect(() => {
    void currentObjects.length;
    void currentStepIndex;
    void camera.zoom;
    tick().then(measureObjects);
  });

  onMount(() => {
    measureObjects();
    const onResize = () => measureObjects();
    window.addEventListener('resize', onResize);

    const onWheelListener = (e) => handleWheel(e);
    if (viewportEl) {
      viewportEl.addEventListener('wheel', onWheelListener, { passive: false });
    }

    const onGlobalWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', onGlobalWheel, { passive: false });

    return () => {
      if (viewportEl) {
        viewportEl.removeEventListener('wheel', onWheelListener);
      }
      window.removeEventListener('wheel', onGlobalWheel);
      window.removeEventListener('resize', onResize);
    };
  });

  function updateCurrentStepObjects(updater) {
    const nextSteps = [...steps];
    const activeIdx = Math.min(currentStepIndex, nextSteps.length - 1);
    const currentList = nextSteps[activeIdx]?.objects || [];
    const updatedList = typeof updater === 'function' ? updater(currentList) : updater;

    nextSteps[activeIdx] = {
      ...nextSteps[activeIdx],
      objects: structuredClone($state.snapshot(updatedList))
    };
    steps = nextSteps;
    tick().then(measureObjects);
  }

  async function createObjectInstance(className, worldPosition) {
    const clsMeta = classes.find((c) => c.name === className);
    if (!clsMeta) return;

    const countSameClass = currentObjects.filter((o) => o.className === className).length;
    const customLabel = `${className.charAt(0).toLowerCase() + className.slice(1)}#${countSameClass + 1}`;

    if (clsMeta.status !== 'draft-only') {
      try {
        const res = await onInstantiate?.(className, customLabel, [], worldPosition);
        const createdId = res?.data?.instanceId || res?.instanceId;
        const graph = extractGraphFromServerResponse(res);

        if (createdId && graph?.nodesData) {
          sessionInstanceIds.add(createdId);
          const createdNode = graph.nodesData.find((n) => n.id === createdId);

          if (createdNode) {
            const effectiveProps = getEffectiveProperties({
              className,
              properties: createdNode.properties || []
            });
            const newObj = {
              ...createdNode,
              properties: effectiveProps,
              label: customLabel,
              position: worldPosition
            };
            updateCurrentStepObjects((prev) => [...prev, newObj]);
            return;
          }
        }
      } catch {
        // Fallback local
      }
    }

    const fallbackId = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    sessionInstanceIds.add(fallbackId);

    const initialProps = (clsMeta.properties || []).map((p) => {
      let defaultVal = null;
      if (p.defaultValue !== undefined && p.defaultValue !== null) {
        try {
          defaultVal = JSON.parse(p.defaultValue);
        } catch {
          defaultVal = p.defaultValue;
        }
      } else if (p.valueType === 'Array') {
        defaultVal = [];
      } else if (p.valueType === 'number') {
        defaultVal = 0;
      } else if (p.valueType === 'boolean') {
        defaultVal = false;
      }
      return {
        name: p.name,
        isPrivate: Boolean(p.isPrivate),
        status: p.status,
        value: defaultVal
      };
    });

    const newObj = {
      id: fallbackId,
      label: customLabel,
      className,
      position: worldPosition,
      properties: initialProps,
      methods: (clsMeta.methods || []).filter((mItem) => mItem.kind !== 'constructor')
    };

    updateCurrentStepObjects((prev) => [...prev, newObj]);
  }

  function handleSidebarDragStart(e, className) {
    e.dataTransfer.setData('text/plain', className);
    e.dataTransfer.setData('application/seepoo-class', className);
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  function handleCanvasDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingOverCanvas) isDraggingOverCanvas = true;
  }

  function handleCanvasDragLeave() {
    isDraggingOverCanvas = false;
  }

  async function handleCanvasDrop(e) {
    e.preventDefault();
    isDraggingOverCanvas = false;

    const className =
      e.dataTransfer.getData('application/seepoo-class') ||
      e.dataTransfer.getData('text/plain');
    if (!className) return;

    const rect = viewportEl.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const worldX = Math.round((screenX - camera.x) / camera.zoom - 150);
    const worldY = Math.round((screenY - camera.y) / camera.zoom - 40);

    await createObjectInstance(className, { x: worldX, y: worldY });
  }

  function handleObjectPointerDown(e, objId) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const targetObj = currentObjects.find((o) => o.id === objId);
    if (!targetObj) return;

    dragState = {
      objId,
      startX: e.clientX,
      startY: e.clientY,
      originX: targetObj.position?.x || 100,
      originY: targetObj.position?.y || 100,
      hasMoved: false
    };
  }

  function handleCanvasPointerDown(e) {
    if (e.button !== 0) return;
    panDrag = {
      startX: e.clientX,
      startY: e.clientY,
      originCamX: camera.x,
      originCamY: camera.y
    };
  }

  function handlePointerMove(e) {
    if (dragState) {
      const dx = (e.clientX - dragState.startX) / camera.zoom;
      const dy = (e.clientY - dragState.startY) / camera.zoom;
      if (Math.hypot(dx, dy) > 4) {
        dragState.hasMoved = true;
      }
      const newX = Math.round(dragState.originX + dx);
      const newY = Math.round(dragState.originY + dy);

      updateCurrentStepObjects((prev) =>
        prev.map((obj) =>
          obj.id === dragState.objId ? { ...obj, position: { x: newX, y: newY } } : obj
        )
      );
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

  function handlePointerUp() {
    if (dragState) {
      if (dragState.hasMoved) {
        wasDraggingObject = true;
        setTimeout(() => {
          wasDraggingObject = false;
        }, 80);
      }
      dragState = null;
    }
    if (panDrag) panDrag = null;
  }

  function handleToggleEmojiExpansion(e, objId) {
    if (wasDraggingObject) return;
    e.stopPropagation();
    if (expandedObjectIds.has(objId)) {
      expandedObjectIds.delete(objId);
    } else {
      expandedObjectIds.add(objId);
    }
    expandedObjectIds = new Set(expandedObjectIds);
    tick().then(measureObjects);
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
      zoomFactor = Math.exp(-e.deltaY * 0.006);
    } else {
      zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    }

    zoomFactor = Math.min(1.25, Math.max(0.75, zoomFactor));
    const nextZoom = Math.min(2, Math.max(0.35, Number((camera.zoom * zoomFactor).toFixed(3))));
    const nextX = mouseX - ((mouseX - camera.x) / camera.zoom) * nextZoom;
    const nextY = mouseY - ((mouseY - camera.y) / camera.zoom) * nextZoom;

    camera = { x: nextX, y: nextY, zoom: nextZoom };
    tick().then(measureObjects);
  }

  function handleWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      applyZoom(e);
      return;
    }

    if (isScrollableElement(e.target)) {
      return;
    }

    e.preventDefault();
    applyZoom(e);
  }

  function handleCenterOnObjects() {
    if (currentObjects.length === 0) {
      camera = { x: 0, y: 0, zoom: 1 };
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    currentObjects.forEach((obj) => {
      const pos = obj.position || { x: 100, y: 100 };
      const size = cardSizes[obj.id] || { width: 340, height: 240 };
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const vpRect = viewportEl?.getBoundingClientRect();
    const vpW = vpRect?.width || window.innerWidth;
    const vpH = vpRect?.height || window.innerHeight;

    camera = {
      x: Math.round(vpW / 2 - centerX),
      y: Math.round(vpH / 2 - centerY),
      zoom: 1
    };
  }

  function handleDeleteObject(objId) {
    sessionInstanceIds.delete(objId);
    updateCurrentStepObjects((prev) => prev.filter((o) => o.id !== objId));
  }

  function handleMutateProperty(objId, propNameVal, newValue) {
    updateCurrentStepObjects((prev) =>
      prev.map((obj) => {
        if (obj.id !== objId) return obj;
        const currentProps = [...getEffectiveProperties(obj)];
        const idx = currentProps.findIndex((p) => p.name === propNameVal);
        if (idx >= 0) {
          currentProps[idx] = { ...currentProps[idx], value: newValue };
        } else {
          const clsMeta = classes.find((c) => c.name === obj.className);
          const propMeta = clsMeta?.properties?.find((p) => p.name === propNameVal);
          currentProps.push({
            name: propNameVal,
            isPrivate: Boolean(propMeta?.isPrivate),
            status: propMeta?.status,
            value: newValue
          });
        }
        return {
          ...obj,
          properties: currentProps
        };
      })
    );
  }

  async function handleRunMethod(obj, method) {
    if (method.isPrivate) return;
    const key = `${obj.id}::${method.name}`;
    executingKey = key;
    feedbackByObj = { ...feedbackByObj, [obj.id]: null };

    const prepareArgs = (idMapping = {}) =>
      (method.params || []).map((param, idx) => {
        const raw = (methodArgs[key]?.[idx] ?? '').trim();
        if (raw === '') {
          return param.defaultValue ?? '';
        }
        if (raw.startsWith('@ref:')) {
          const oldTargetId = raw.slice(5);
          const mappedTargetId = idMapping[oldTargetId] || oldTargetId;
          return `@ref:${mappedTargetId}`;
        }
        return raw;
      });

    try {
      let targetObjId = obj.id;
      let res = await onExecuteMethod?.(targetObjId, method.name, prepareArgs());

      if (!res?.ok && res?.error?.includes('introuvable en mémoire')) {
        const idMap = {};
        for (const item of currentObjects) {
          const itemCls = classes.find((c) => c.name === item.className);
          if (itemCls && itemCls.status !== 'draft-only') {
            const instRes = await onInstantiate?.(item.className, item.label, [], item.position);
            const newId = instRes?.data?.instanceId || instRes?.instanceId;
            if (newId) {
              idMap[item.id] = newId;
              sessionInstanceIds.add(newId);
            }
          }
        }

        if (idMap[obj.id]) {
          targetObjId = idMap[obj.id];
          updateCurrentStepObjects((prevObjs) =>
            prevObjs.map((o) => ({
              ...o,
              id: idMap[o.id] || o.id,
              properties: (o.properties || []).map((p) =>
                p.value?.__type === 'Pointer' && idMap[p.value.targetId]
                  ? {
                      ...p,
                      value: { ...p.value, targetId: idMap[p.value.targetId] }
                    }
                  : p
              )
            }))
          );
          res = await onExecuteMethod?.(targetObjId, method.name, prepareArgs(idMap));
        }
      }

      if (!res?.ok) {
        feedbackByObj = {
          ...feedbackByObj,
          [targetObjId]: {
            type: 'error',
            message: res?.error || 'Error'
          }
        };
      } else {
        const graph = extractGraphFromServerResponse(res);
        const details = extractExecDetailsFromResponse(res);

        if (graph?.nodesData) {
          updateCurrentStepObjects((prevObjs) =>
            prevObjs.map((existingObj) => {
              const updatedNode = graph.nodesData.find((n) => n.id === existingObj.id);
              if (!updatedNode) return existingObj;
              const serverProps = updatedNode.properties || [];
              const serverNames = new Set(serverProps.map((p) => p.name));
              const localDraftProps = (existingObj.properties || []).filter(
                (p) => !serverNames.has(p.name)
              );
              return {
                ...existingObj,
                properties: [...serverProps, ...localDraftProps]
              };
            })
          );
        }

        feedbackByObj = {
          ...feedbackByObj,
          [targetObjId]: {
            type: 'success',
            method: method.name,
            returnValue: details?.returnValue,
            logs: details?.logs || []
          }
        };
      }
    } catch (err) {
      feedbackByObj = {
        ...feedbackByObj,
        [obj.id]: { type: 'error', message: err.message }
      };
    } finally {
      executingKey = null;
    }
  }

  function handleSaveStep() {
    const nowStr = new Date().toLocaleTimeString($locale === 'en' ? 'en-US' : 'fr-FR');
    const baseSteps = steps.slice(0, currentStepIndex + 1);
    const currentSnapshot = baseSteps[currentStepIndex];

    baseSteps[currentStepIndex] = {
      ...currentSnapshot,
      savedAt: nowStr
    };

    const nextStepNumber = baseSteps.length;
    const nextWorkingStep = {
      stepNumber: nextStepNumber,
      label: `Étape ${nextStepNumber}`,
      savedAt: null,
      objects: structuredClone($state.snapshot(currentSnapshot.objects || []))
    };

    const updated = [...baseSteps, nextWorkingStep];
    steps = updated;
    currentStepIndex = updated.length - 1;
  }

  function handleDeleteStep(stepIdx) {
    if (steps.length <= 1) return;
    const remaining = steps.filter((_, idx) => idx !== stepIdx);
    const updated = remaining.map((s, idx) => ({
      ...s,
      stepNumber: idx,
      label:
        s.label?.startsWith('Étape') || s.label?.startsWith('Step') || !s.label
          ? `Étape ${idx}`
          : s.label
    }));
    steps = updated;
    if (currentStepIndex >= updated.length) {
      currentStepIndex = updated.length - 1;
    } else if (currentStepIndex > stepIdx) {
      currentStepIndex -= 1;
    }
    tick().then(measureObjects);
  }

  function handleResetPlayground() {
    sessionInstanceIds.clear();
    feedbackByObj = {};
    try {
      localStorage.removeItem(OBJ_STEPS_STORAGE_KEY);
    } catch {
      // ignore
    }
    steps = [
      {
        stepNumber: 0,
        label: 'Étape 0',
        savedAt: null,
        objects: []
      }
    ];
    currentStepIndex = 0;
  }
</script>

<div class="h-full w-full flex overflow-hidden bg-slate-950 select-none">
  <!-- MENU LATÉRAL GAUCHE : CLASSES À GLISSER-DÉPOSER SUR LE PLAN -->
  <aside
    class="border-r border-slate-800 bg-slate-900/95 flex flex-col shrink-0 z-20 transition-[width] duration-300 ease-in-out overflow-hidden {isSidebarCollapsed
      ? 'w-16'
      : 'w-76'}"
  >
    {#if isSidebarCollapsed}
      <div class="p-2.5 flex flex-col items-center gap-3 w-16 h-full shrink-0">
        <button
          type="button"
          onclick={() => {
            isSidebarCollapsed = false;
            tick().then(measureObjects);
          }}
          title={m.sidebar_expand({}, { locale: $locale })}
          class="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronRight class="w-4 h-4" />
        </button>

        <div class="w-8 border-t border-slate-800"></div>

        <div class="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto custom-scrollbar py-1">
          {#each classes as cls (cls.name)}
            {@const emoji = getClassEmoji(cls.name)}
            {@const isDraft = cls.status === 'draft-only'}

            <button
              type="button"
              draggable="true"
              ondragstart={(e) => handleSidebarDragStart(e, cls.name)}
              onclick={() => {
                const vpRect = viewportEl?.getBoundingClientRect();
                const vpW = vpRect?.width || 800;
                const vpH = vpRect?.height || 600;
                const offset = (currentObjects.length % 5) * 35;
                const worldX = Math.round((vpW / 2 - camera.x) / camera.zoom - 150 + offset);
                const worldY = Math.round((vpH / 2 - camera.y) / camera.zoom - 110 + offset);
                createObjectInstance(cls.name, { x: worldX, y: worldY });
              }}
              title="{cls.name} — {m.obj_add_btn_title({ className: cls.name }, { locale: $locale })}"
              class="w-10 h-10 rounded-xl bg-slate-950 border flex items-center justify-center text-lg cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95 transition-all {isDraft
                ? 'border-dashed border-amber-500/60 hover:border-amber-400 hover:bg-amber-950/20'
                : 'border-slate-800 hover:border-indigo-500 hover:bg-slate-800/80'}"
            >
              {emoji}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="p-4 flex flex-col gap-4 w-76 h-full shrink-0">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="text-xs font-bold uppercase tracking-wider text-indigo-400">
              {m.obj_sidebar_title({}, { locale: $locale })}
            </h2>
            <p class="text-[11px] text-slate-400 mt-1">
              {m.obj_sidebar_desc({}, { locale: $locale })}
            </p>
          </div>
          <button
            type="button"
            onclick={() => {
              isSidebarCollapsed = true;
              tick().then(measureObjects);
            }}
            title={m.sidebar_collapse({}, { locale: $locale })}
            class="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 mt-0.5"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
        </div>

        <div class="space-y-2 overflow-y-auto flex-1 custom-scrollbar">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
            {m.obj_available_classes({ count: classes.length }, { locale: $locale })}
          </div>

          {#each classes as cls (cls.name)}
            {@const emoji = getClassEmoji(cls.name)}
            {@const isDraft = cls.status === 'draft-only'}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              draggable="true"
              ondragstart={(e) => handleSidebarDragStart(e, cls.name)}
              class="group p-3 rounded-xl bg-slate-950 border transition-all cursor-grab active:cursor-grabbing flex items-center justify-between {isDraft
                ? 'border-dashed border-amber-500/50 hover:border-amber-400'
                : 'border-slate-800 hover:border-indigo-500'}"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span
                  class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-base shrink-0"
                >
                  {emoji}
                </span>
                <div class="min-w-0">
                  <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                    <span>{cls.name}</span>
                    {#if isDraft}
                      <span
                        class="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
                      >
                        {m.badge_draft({}, { locale: $locale })}
                      </span>
                    {/if}
                  </div>
                  <div class="text-[10px] font-mono text-slate-400">
                    {m.obj_card_summary(
                      { propsCount: cls.properties.length, methodsCount: cls.methods.length },
                      { locale: $locale }
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onclick={() => {
                  const vpRect = viewportEl?.getBoundingClientRect();
                  const vpW = vpRect?.width || 800;
                  const vpH = vpRect?.height || 600;
                  const offset = (currentObjects.length % 5) * 35;
                  const worldX = Math.round((vpW / 2 - camera.x) / camera.zoom - 150 + offset);
                  const worldY = Math.round((vpH / 2 - camera.y) / camera.zoom - 110 + offset);
                  createObjectInstance(cls.name, { x: worldX, y: worldY });
                }}
                title={m.obj_add_btn_title({ className: cls.name }, { locale: $locale })}
                class="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors shrink-0"
              >
                <PlusCircle class="w-4 h-4" />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </aside>

  <!-- CANVAS INFINI DES OBJETS -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={viewportEl}
    onpointerdown={handleCanvasPointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    ondragover={handleCanvasDragOver}
    ondragleave={handleCanvasDragLeave}
    ondrop={handleCanvasDrop}
    style:background-image="radial-gradient({$theme === 'light' ? '#cbd5e1' : '#334155'} 1.5px, transparent 1.5px)"
    style:background-size="{24 * camera.zoom}px {24 * camera.zoom}px"
    style:background-position="{camera.x}px {camera.y}px"
    class="flex-1 h-full relative overflow-hidden cursor-grab active:cursor-grabbing transition-colors {isDraggingOverCanvas
      ? 'ring-4 ring-inset ring-indigo-500/50 bg-indigo-950/10'
      : ''}"
  >
    {#if currentObjects.length === 0}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
        <div
          class="max-w-md text-center p-6 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm"
        >
          <div class="text-2xl mb-2">📦</div>
          <h3 class="text-sm font-bold text-white">
            {m.obj_empty_title({ step: currentStepIndex }, { locale: $locale })}
          </h3>
          <p class="text-xs text-slate-400 mt-1 leading-relaxed">
            {m.obj_empty_desc({}, { locale: $locale })}
          </p>
        </div>
      </div>
    {/if}

    <!-- Contrôles de Zoom et Recentrage -->
    <div
      onpointerdown={(e) => e.stopPropagation()}
      class="absolute bottom-4 left-4 z-30 flex items-center gap-1 p-1.5 rounded-xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg text-xs text-slate-300"
    >
      <button
        type="button"
        onclick={() => {
          camera = { ...camera, zoom: Math.max(0.35, Number((camera.zoom - 0.1).toFixed(2))) };
          tick().then(measureObjects);
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
          tick().then(measureObjects);
        }}
        class="p-1.5 rounded-lg hover:bg-slate-800"
        title={m.zoom_in({}, { locale: $locale })}
      >
        <ZoomIn class="w-4 h-4" />
      </button>
      <button
        type="button"
        onclick={handleCenterOnObjects}
        class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
        title={m.recenter_objects({}, { locale: $locale })}
      >
        <RotateCcw class="w-3.5 h-3.5" />
      </button>

      <div class="h-4 w-px bg-slate-800 mx-0.5"></div>

      <!-- Toggle Vue Emoji -->
      <button
        type="button"
        onclick={() => {
          isEmojiView = !isEmojiView;
          if (isEmojiView) {
            expandedObjectIds.clear();
            expandedObjectIds = new Set();
          }
          tick().then(measureObjects);
        }}
        class="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer {isEmojiView
          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
          : 'hover:bg-slate-800 text-slate-300 hover:text-white'}"
        title={isEmojiView
          ? m.obj_view_detailed_title({}, { locale: $locale })
          : m.obj_view_emoji_title({}, { locale: $locale })}
      >
        <Smile class="w-3.5 h-3.5 {isEmojiView ? 'text-amber-400' : 'text-slate-400'}" />
        <span>{m.obj_view_emoji_btn({}, { locale: $locale })}</span>
      </button>
    </div>

    <!-- Conteneur Monde Infini accéléré GPU -->
    <div
      style:transform="translate3d({camera.x}px, {camera.y}px, 0) scale({camera.zoom})"
      style:transform-origin="0 0"
      class="absolute top-0 left-0 w-0 h-0 pointer-events-none"
    >
      <!-- Calque SVG des flèches de références mémoire (Pointeurs) -->
      <svg
        class="overflow-visible pointer-events-none"
        style="position: absolute; left: 0; top: 0; width: 1px; height: 1px; z-index: 35;"
      >
        <defs>
          <marker
            id="arrow-pointer"
            markerWidth="14"
            markerHeight="14"
            refX="12"
            refY="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              d="M 0 2 L 12 7 L 0 12 L 3 7 Z"
              fill="#06b6d4"
              stroke="#cffafe"
              stroke-width="1.2"
            />
          </marker>
        </defs>

        {#each pointerEdges as edge (edge.id)}
          {@const badgeText = edge.badge ? (edge.badge === 'ref' ? m.obj_pointer_badge({}, { locale: $locale }) : edge.badge) : m.obj_pointer_badge({}, { locale: $locale })}
          {@const badgeWidth = Math.max(54, badgeText.length * 7.5 + 16)}
          <g>
            <circle
              cx={edge.startPt.x}
              cy={edge.startPt.y}
              r="4"
              fill="#06b6d4"
              stroke="#cffafe"
              stroke-width="1.5"
            />
            <path
              d={edge.pathD}
              fill="none"
              stroke="#06b6d4"
              stroke-width="2.4"
              stroke-dasharray="8 4"
              marker-end="url(#arrow-pointer)"
            />
            <g transform="translate({edge.labelX}, {edge.labelY})">
              <rect
                x={-badgeWidth / 2}
                y="-11"
                width={badgeWidth}
                height="22"
                rx="6"
                fill={$theme === 'light' ? '#ecfeff' : '#083344'}
                stroke="#06b6d4"
                stroke-width="1.2"
              />
              <text
                x="0"
                y="3.5"
                text-anchor="middle"
                fill={$theme === 'light' ? '#0e7490' : '#a5f3fc'}
                font-size="10"
                font-family="monospace"
                font-weight="bold"
              >
                {badgeText}
              </text>
            </g>
          </g>
        {/each}
      </svg>

      <!-- Cartes des instances d'objets sur le plan (Largeur auto-adaptative !) -->
      {#each currentObjects as obj (obj.id)}
        {@const pos = obj.position || { x: 100, y: 100 }}
        {@const isBeingDragged = dragState?.objId === obj.id}
        {@const emoji = getClassEmoji(obj.className)}
        {@const prevObj = previousStepData?.objects?.find((p) => p.id === obj.id)}
        {@const otherObjects = currentObjects.filter((o) => o.id !== obj.id)}
        {@const feedback = feedbackByObj[obj.id]}
        {@const effectiveProps = getEffectiveProperties(obj)}

        {@const isEmojiOnly = isEmojiView && !expandedObjectIds.has(obj.id)}

        {#if isEmojiOnly}
          <!-- VUE PURE EMOJI (TRÈS GRAPHIQUE, AUCUNE CARTE) -->
          <div
            use:bindCardEl={obj.id}
            role="button"
            tabindex="0"
            style:transform="translate3d({pos.x}px, {pos.y}px, 0)"
            onpointerdown={(e) => handleObjectPointerDown(e, obj.id)}
            onclick={(e) => handleToggleEmojiExpansion(e, obj.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleEmojiExpansion(e, obj.id);
              }
            }}
            title="{obj.label} ({obj.className}) — {m.obj_expand_from_emoji({}, { locale: $locale })}"
            class="pointer-events-auto absolute top-0 left-0 flex flex-col items-center justify-center cursor-pointer select-none group transition-transform duration-200 {isBeingDragged
              ? 'z-30 scale-125'
              : 'z-20 hover:scale-120 active:scale-95'}"
            style="width: 56px; height: 56px;"
          >
            <span
              class="text-5xl select-none filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)] group-hover:drop-shadow-[0_0_16px_rgba(99,102,241,0.8)] transition-all"
            >
              {emoji}
            </span>
            <span
              class="text-[9px] font-mono font-bold text-slate-300 bg-slate-900/90 px-1.5 py-0.5 rounded-md border border-slate-700/80 shadow -mt-0.5 truncate max-w-[84px] pointer-events-none opacity-85 group-hover:opacity-100 transition-opacity"
            >
              {obj.label}
            </span>
          </div>
        {:else}
          <div
            use:bindCardEl={obj.id}
            style:transform="translate3d({pos.x}px, {pos.y}px, 0)"
            style="min-width: 340px; width: max-content;"
            onpointerdown={(e) => e.stopPropagation()}
            class="pointer-events-auto absolute top-0 left-0 rounded-2xl bg-slate-900/95 border-2 transition-shadow {isBeingDragged
              ? 'z-30 border-indigo-400 shadow-2xl ring-2 ring-indigo-400/50'
              : 'z-10 border-slate-700 hover:border-indigo-500/70 shadow-xl'}"
          >
            <!-- En-tête de l'instance -->
            <div
              onpointerdown={(e) => handleObjectPointerDown(e, obj.id)}
              class="px-4 py-3 bg-gradient-to-r from-indigo-950/90 via-slate-900 to-slate-900 border-b border-slate-800 rounded-t-2xl flex items-center justify-between gap-4 cursor-grab active:cursor-grabbing"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-base shrink-0"
                >
                  {emoji}
                </span>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 whitespace-nowrap">
                    <span class="text-sm font-bold text-white">{obj.label}</span>
                    <span
                      class="text-[11px] font-mono text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-500/30"
                    >
                      : {obj.className}
                    </span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                {#if isViewingPast}
                  <span
                    class="text-[10px] font-semibold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded"
                  >
                    {m.obj_step_badge({ step: currentStepIndex }, { locale: $locale })}
                  </span>
                {/if}
                {#if isEmojiView}
                  <button
                    type="button"
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={(e) => {
                      e.stopPropagation();
                      expandedObjectIds.delete(obj.id);
                      expandedObjectIds = new Set(expandedObjectIds);
                      tick().then(measureObjects);
                    }}
                    title={m.obj_collapse_to_emoji({}, { locale: $locale })}
                    class="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/15 transition-colors cursor-pointer"
                  >
                    <Minimize2 class="w-3.5 h-3.5" />
                  </button>
                {/if}
                <button
                  type="button"
                  onpointerdown={(e) => e.stopPropagation()}
                  onclick={() => handleDeleteObject(obj.id)}
                  title={m.obj_delete_title({}, { locale: $locale })}
                  class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

          <!-- Section 1 : État des Propriétés de l'objet -->
          <div class="p-3.5 border-b border-slate-800 space-y-2">
            <div
              class="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between gap-4"
            >
              <span>
                {m.properties_count({ count: effectiveProps.length }, { locale: $locale })}
              </span>
              <span>{m.obj_current_value({}, { locale: $locale })}</span>
            </div>

            {#if effectiveProps.length === 0}
              <p class="text-xs text-slate-500 italic">
                {m.properties_empty({}, { locale: $locale })}
              </p>
            {:else}
              <div class="space-y-2">
                {#each effectiveProps as prop (prop.name)}
                  {@const propKey = `${obj.id}::${prop.name}`}
                  {@const val = prop.value}
                  {@const isPointer = val && typeof val === 'object' && val.__type === 'Pointer'}
                  {@const prevProp = prevObj?.properties?.find((p) => p.name === prop.name)}
                  {@const hasChangedSincePrevStep =
                    prevProp !== undefined && JSON.stringify(prevProp.value) !== JSON.stringify(val)}
                  {@const clsMeta = classes.find((c) => c.name === obj.className)}
                  {@const propMeta = clsMeta?.properties?.find((p) => p.name === prop.name)}
                  {@const isDraft = prop.status === 'draft-only' || propMeta?.status === 'draft-only'}
                  {@const isArray = isArrayProperty(prop, obj)}

                  {#if isArray}
                    {@const arrayItems = getArrayItems(val)}
                    <!-- Propriété de type Tableau (ex: allCompte) permettant de lier plusieurs objets -->
                    <div
                      use:bindPropEl={propKey}
                      class="flex flex-col gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-mono {prop.isPrivate
                        ? 'bg-slate-800/60 border-slate-700/60 text-slate-300'
                        : isDraft
                        ? 'bg-amber-500/10 border-dashed border-amber-500/60 text-amber-200'
                        : 'bg-slate-950/80 border-slate-800 text-slate-100'} {hasChangedSincePrevStep
                        ? 'ring-1 ring-amber-400 bg-amber-500/10'
                        : ''}"
                    >
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-1.5 whitespace-nowrap">
                          {#if prop.isPrivate}
                            <Lock
                              class="w-3.5 h-3.5 text-amber-400 shrink-0"
                              title={m.obj_private_locked_title({}, { locale: $locale })}
                            />
                          {:else}
                            <Unlock class="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          {/if}
                          <span class="font-semibold">{prop.name}</span>
                          <span
                            class="text-[10px] text-cyan-300 bg-cyan-950/80 border border-cyan-500/40 px-1.5 py-0.5 rounded font-sans"
                          >
                            Array{#if propMeta?.arrayItemType}&lt;{propMeta.arrayItemType}&gt;{/if}
                          </span>
                          {#if isDraft}
                            <span
                              class="text-[9px] font-sans font-semibold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded"
                            >
                              {m.badge_draft({}, { locale: $locale })}
                            </span>
                          {/if}
                          {#if hasChangedSincePrevStep}
                            <Sparkles
                              class="w-3 h-3 text-amber-400 shrink-0"
                              title={m.obj_changed_since_prev({}, { locale: $locale })}
                            />
                          {/if}
                        </div>

                        {#if !prop.isPrivate && otherObjects.length > 0}
                          <select
                            value=""
                            onchange={(e) => {
                              const targetId = e.currentTarget.value;
                              if (!targetId) return;
                              const targetObj = otherObjects.find((o) => o.id === targetId);
                              if (targetObj) {
                                handleAddArrayItem(obj.id, prop.name, targetObj);
                              }
                              e.currentTarget.value = '';
                            }}
                            title={m.obj_add_to_array({}, { locale: $locale })}
                            class="px-2 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded cursor-pointer"
                          >
                            <option value="">{m.obj_add_to_array({}, { locale: $locale })}</option>
                            {#each otherObjects as o (o.id)}
                              <option value={o.id}>
                                {getClassEmoji(o.className)} {o.label} ({o.className})
                              </option>
                            {/each}
                          </select>
                        {/if}
                      </div>

                      <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
                        {#if arrayItems.length === 0}
                          <span class="text-[10px] text-slate-500 italic font-sans">[ ] (vide)</span>
                        {:else}
                          {#each arrayItems as item, itemIdx (itemIdx)}
                            {@const isItemPointer =
                              item && typeof item === 'object' && item.__type === 'Pointer'}
                            {#if isItemPointer}
                              <span
                                class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 text-[10px] font-semibold whitespace-nowrap shadow-sm"
                              >
                                <span class="text-cyan-400 font-mono text-[9px] opacity-75">
                                  [{itemIdx}]
                                </span>
                                <Link2 class="w-3 h-3 text-cyan-400 shrink-0" />
                                <span>{getClassEmoji(item.targetClass)}</span>
                                <span>{item.targetLabel}</span>
                                {#if !prop.isPrivate}
                                  <button
                                    type="button"
                                    onclick={() =>
                                      handleRemoveArrayItem(obj.id, prop.name, itemIdx)}
                                    title={m.obj_remove_from_array({}, { locale: $locale })}
                                    class="hover:text-rose-400 hover:bg-rose-500/20 rounded p-0.5 ml-0.5 cursor-pointer text-slate-400 transition-colors"
                                  >
                                    <X class="w-3 h-3" />
                                  </button>
                                {/if}
                              </span>
                            {:else}
                              <span
                                class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px] font-mono whitespace-nowrap"
                              >
                                <span class="text-slate-500 text-[9px]">[{itemIdx}]</span>
                                <span>{typeof item === 'object' ? JSON.stringify(item) : item}</span>
                                {#if !prop.isPrivate}
                                  <button
                                    type="button"
                                    onclick={() =>
                                      handleRemoveArrayItem(obj.id, prop.name, itemIdx)}
                                    title={m.obj_remove_from_array({}, { locale: $locale })}
                                    class="hover:text-rose-400 hover:bg-rose-500/20 rounded p-0.5 ml-0.5 cursor-pointer text-slate-400 transition-colors"
                                  >
                                    <X class="w-3 h-3" />
                                  </button>
                                {/if}
                              </span>
                            {/if}
                          {/each}
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <!-- Propriété standard (simple valeur ou pointeur unique) -->
                    <div
                      use:bindPropEl={propKey}
                      class="flex items-center justify-between gap-4 px-2.5 py-1.5 rounded-xl border text-xs font-mono {prop.isPrivate
                        ? 'bg-slate-800/60 border-slate-700/60 text-slate-300'
                        : isDraft
                        ? 'bg-amber-500/10 border-dashed border-amber-500/60 text-amber-200'
                        : 'bg-slate-950/80 border-slate-800 text-slate-100'} {hasChangedSincePrevStep
                        ? 'ring-1 ring-amber-400 bg-amber-500/10'
                        : ''}"
                    >
                      <div class="flex items-center gap-1.5 whitespace-nowrap">
                        {#if prop.isPrivate}
                          <Lock
                            class="w-3.5 h-3.5 text-amber-400 shrink-0"
                            title={m.obj_private_locked_title({}, { locale: $locale })}
                          />
                        {:else}
                          <Unlock class="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        {/if}
                        <span>{prop.name}</span>
                        {#if isDraft}
                          <span
                            class="text-[9px] font-sans font-semibold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded"
                          >
                            {m.badge_draft({}, { locale: $locale })}
                          </span>
                        {/if}
                        {#if hasChangedSincePrevStep}
                          <Sparkles
                            class="w-3 h-3 text-amber-400 shrink-0"
                            title={m.obj_changed_since_prev({}, { locale: $locale })}
                          />
                        {/if}
                      </div>

                      <div class="flex items-center gap-1.5 shrink-0">
                        {#if isPointer}
                          <span
                            class="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 text-[11px] font-semibold whitespace-nowrap"
                          >
                            <Link2 class="w-3 h-3 text-cyan-400" />
                            <span>{val.targetLabel}</span>
                            {#if !prop.isPrivate}
                              <button
                                type="button"
                                onclick={() => handleMutateProperty(obj.id, prop.name, null)}
                                title={m.obj_unlink({}, { locale: $locale })}
                                class="hover:text-rose-400 hover:bg-rose-500/20 rounded p-0.5 ml-0.5 cursor-pointer text-slate-400 transition-colors"
                              >
                                <X class="w-3 h-3" />
                              </button>
                            {/if}
                          </span>
                        {:else if prop.isPrivate}
                          <span
                            title={m.obj_private_locked_title({}, { locale: $locale })}
                            class="px-2 py-0.5 rounded bg-slate-900 text-amber-200 border border-slate-700 text-[11px] whitespace-nowrap"
                          >
                            {JSON.stringify(val)}
                          </span>
                        {:else}
                          <input
                            type="text"
                            value={typeof val === 'string'
                              ? val
                              : val === null || val === undefined
                              ? ''
                              : JSON.stringify(val)}
                            placeholder="null"
                            oninput={(e) => {
                              const raw = e.currentTarget.value;
                              let parsed = raw;
                              if (raw === 'true') parsed = true;
                              else if (raw === 'false') parsed = false;
                              else if (raw !== '' && !Number.isNaN(Number(raw))) {
                                parsed = Number(raw);
                              }
                              handleMutateProperty(obj.id, prop.name, parsed);
                            }}
                            class="w-28 px-2 py-0.5 text-[11px] font-mono bg-slate-900 text-emerald-300 border border-slate-700 rounded focus:border-emerald-400 focus:outline-none"
                          />
                        {/if}

                        {#if !prop.isPrivate && otherObjects.length > 0}
                          <select
                            value={isPointer ? val.targetId : ''}
                            onchange={(e) => {
                              const targetId = e.currentTarget.value;
                              if (!targetId) {
                                handleMutateProperty(obj.id, prop.name, null);
                                return;
                              }
                              const targetObj = otherObjects.find((o) => o.id === targetId);
                              if (targetObj) {
                                handleMutateProperty(obj.id, prop.name, {
                                  __type: 'Pointer',
                                  targetId: targetObj.id,
                                  targetLabel: targetObj.label,
                                  targetClass: targetObj.className
                                });
                              }
                            }}
                            title={m.obj_link_prop_title({}, { locale: $locale })}
                            class="w-6 px-1 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded cursor-pointer"
                          >
                            <option value="">{m.obj_link_to_object({}, { locale: $locale })}</option>
                            {#each otherObjects as o (o.id)}
                              <option value={o.id}>
                                {getClassEmoji(o.className)} {o.label} ({o.className})
                              </option>
                            {/each}
                          </select>
                        {/if}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>

          <!-- Section 2 : Méthodes de l'objet -->
          <div class="p-3.5 space-y-2">
            <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {m.methods_count({ count: (obj.methods || []).length }, { locale: $locale })}
            </div>

            {#if (obj.methods || []).length === 0}
              <p class="text-xs text-slate-500 italic">
                {m.methods_empty({}, { locale: $locale })}
              </p>
            {:else}
              <div class="space-y-2">
                {#each obj.methods || [] as method (method.name)}
                  {@const isPriv = method.isPrivate}
                  {@const key = `${obj.id}::${method.name}`}

                  <div
                    class="p-2.5 rounded-xl border {isPriv
                      ? 'bg-slate-800/40 border-slate-800 opacity-60'
                      : 'bg-slate-950/70 border-slate-800'}"
                  >
                    <div class="flex items-center justify-between gap-4 whitespace-nowrap">
                      <span
                        class="text-xs font-mono font-bold text-indigo-300 flex items-center gap-1.5"
                      >
                        {#if isPriv}
                          <Lock class="w-3 h-3 text-amber-400 shrink-0" />
                        {/if}
                        <span>
                          {method.name}({(method.params || []).map((p) => p.name).join(', ')})
                        </span>
                      </span>

                      {#if !isPriv}
                        <button
                          type="button"
                          disabled={executingKey === key}
                          onclick={() => handleRunMethod(obj, method)}
                          class="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[11px] font-semibold transition-all"
                        >
                          <Play class="w-3 h-3 fill-current" />
                          <span>
                            {executingKey === key
                              ? '...'
                              : m.obj_execute_btn({}, { locale: $locale })}
                          </span>
                        </button>
                      {/if}
                    </div>

                    {#if !isPriv && (method.params || []).length > 0}
                      <div class="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5">
                        {#each method.params as param, pIdx (param.name)}
                          {@const currentVal = methodArgs[key]?.[pIdx] ?? ''}
                          <div class="flex items-center gap-2">
                            <span
                              class="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0"
                            >
                              {param.name}:
                            </span>
                            <input
                              type="text"
                              placeholder={param.defaultValue
                                ? m.obj_default_placeholder(
                                    { val: param.defaultValue },
                                    { locale: $locale }
                                  )
                                : m.obj_value_placeholder({}, { locale: $locale })}
                              value={currentVal}
                              oninput={(e) => {
                                const val = e.currentTarget.value;
                                const arr = [...(methodArgs[key] || [])];
                                arr[pIdx] = val;
                                methodArgs = { ...methodArgs, [key]: arr };
                              }}
                              class="flex-1 min-w-[120px] px-2 py-1 text-[11px] font-mono bg-slate-900 text-white border border-slate-700 rounded focus:border-indigo-500 focus:outline-none"
                            />

                            {#if otherObjects.length > 0}
                              <select
                                value={currentVal.startsWith('@ref:') ? currentVal : ''}
                                onchange={(e) => {
                                  const val = e.currentTarget.value;
                                  const arr = [...(methodArgs[key] || [])];
                                  arr[pIdx] = val;
                                  methodArgs = { ...methodArgs, [key]: arr };
                                }}
                                title={m.obj_pass_ref_title({}, { locale: $locale })}
                                class="w-7 px-1 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded cursor-pointer shrink-0"
                              >
                                <option value="">
                                  {m.obj_pass_ref_option({}, { locale: $locale })}
                                </option>
                                {#each otherObjects as o (o.id)}
                                  <option value={`@ref:${o.id}`}>
                                    {getClassEmoji(o.className)} {o.label}
                                  </option>
                                {/each}
                              </select>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Retour d'exécution ou Erreur -->
          {#if feedback}
            <div
              class="mx-3.5 mb-3.5 p-2.5 rounded-xl border text-xs font-mono {feedback.type ===
              'error'
                ? 'bg-rose-950/80 border-rose-500/40 text-rose-200'
                : 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'}"
            >
              {#if feedback.type === 'error'}
                <div class="flex items-start gap-1.5">
                  <AlertCircle class="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <span>{feedback.message}</span>
                </div>
              {:else}
                <div class="space-y-1">
                  <div class="flex items-center gap-1.5 font-bold text-emerald-300">
                    <CheckCircle2 class="w-3.5 h-3.5" />
                    <span>{feedback.method}()</span>
                  </div>
                  {#if feedback.returnValue !== undefined}
                    <div class="text-[11px] text-slate-300">
                      {m.obj_return_label({}, { locale: $locale })}
                      <span class="text-emerald-300">{JSON.stringify(feedback.returnValue)}</span>
                    </div>
                  {/if}
                  {#if feedback.logs?.length > 0}
                    <div
                      class="text-[10px] text-slate-400 border-t border-emerald-800/60 pt-1 mt-1 space-y-0.5"
                    >
                      {#each feedback.logs as logLine, logIdx (logIdx)}
                        <div>&gt; {logLine}</div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
          </div>
        {/if}
      {/each}
    </div>

    <!-- BARRE DE TIME-TRAVEL MANUELLE -->
    <TimeTravelBar
      {steps}
      {currentStepIndex}
      onSelectStep={(idx) => (currentStepIndex = idx)}
      onSaveStep={handleSaveStep}
      onDeleteStep={handleDeleteStep}
      onResetPlayground={handleResetPlayground}
    />
  </div>
</div>
