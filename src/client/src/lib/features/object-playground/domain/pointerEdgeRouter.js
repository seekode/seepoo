import { getRectBorderPoint } from '$lib/shared/domain/geometry.js';

export const OBJ_CAMERA_STORAGE_KEY = 'seepoo:objects-camera:v1';
export const OBJ_STEPS_STORAGE_KEY = 'seepoo:object-steps:v1';
export const OBJ_SIDEBAR_COLLAPSED_STORAGE_KEY = 'seepoo:objects-sidebar-collapsed:v1';
export const OBJ_EMOJI_VIEW_STORAGE_KEY = 'seepoo:objects-emoji-view:v1';

/**
 * Extrait le graphe `{ nodesData, edgesData }` quelle que soit l'imbrication renvoyée par le serveur
 */
export function extractGraphFromServerResponse(res) {
  return (
    res?.data?.snapshot?.snapshot?.graph ||
    res?.data?.snapshot?.graph ||
    res?.snapshot?.snapshot?.graph ||
    res?.snapshot?.graph ||
    null
  );
}

/**
 * Extrait les détails d'exécution (`returnValue`, `logs`) de la réponse serveur
 */
export function extractExecDetailsFromResponse(res) {
  return (
    res?.data?.snapshot?.snapshot?.executionDetails ||
    res?.data?.snapshot?.executionDetails ||
    res?.snapshot?.snapshot?.executionDetails ||
    res?.snapshot?.executionDetails ||
    null
  );
}

/**
 * Calcul des flèches de pointeurs mémoire entre objets (partant de la propriété ou du bord en vue emoji)
 */
export function computePointerEdges(
  currentObjects,
  cardSizes,
  propOffsets,
  isEmojiView = false,
  expandedObjectIds = new Set()
) {
  const edges = [];
  const objMap = new Map(currentObjects.map((o) => [o.id, o]));

  for (const srcObj of currentObjects) {
    const isSrcEmoji = isEmojiView && !expandedObjectIds.has(srcObj.id);
    const srcPos = srcObj.position || { x: 100, y: 100 };
    const srcSize = cardSizes[srcObj.id] || (isSrcEmoji ? { width: 56, height: 56 } : { width: 340, height: 240 });
    const srcRect = { x: srcPos.x, y: srcPos.y, width: srcSize.width, height: srcSize.height };
    const srcCenter = { x: srcPos.x + srcSize.width / 2, y: srcPos.y + srcSize.height / 2 };

    (srcObj.properties || []).forEach((prop, propIdx) => {
      const val = prop.value;
      const targets = [];

      if (val && typeof val === 'object' && val.__type === 'Pointer' && objMap.has(val.targetId)) {
        targets.push({ targetId: val.targetId, badge: 'ref' });
      } else if (Array.isArray(val)) {
        val.forEach((item, i) => {
          if (
            item &&
            typeof item === 'object' &&
            item.__type === 'Pointer' &&
            objMap.has(item.targetId)
          ) {
            targets.push({ targetId: item.targetId, badge: `[${i}]` });
          }
        });
      }

      targets.forEach(({ targetId, badge }, tIdx) => {
        if (targetId === srcObj.id) return;
        const tgtObj = objMap.get(targetId);
        const isTgtEmoji = isEmojiView && !expandedObjectIds.has(targetId);
        const tgtPos = tgtObj.position || { x: 400, y: 100 };
        const tgtSize = cardSizes[targetId] || (isTgtEmoji ? { width: 56, height: 56 } : { width: 340, height: 240 });
        const tgtRect = { x: tgtPos.x, y: tgtPos.y, width: tgtSize.width, height: tgtSize.height };
        const tgtCenter = { x: tgtRect.x + tgtRect.width / 2, y: tgtRect.y + tgtRect.height / 2 };

        let startPt;
        if (isSrcEmoji) {
          startPt = getRectBorderPoint(tgtCenter, srcRect, 0);
        } else {
          const propKey = `${srcObj.id}::${prop.name}`;
          const propOff = propOffsets[propKey];
          const isTargetToRight = tgtCenter.x >= srcCenter.x;
          startPt = propOff
            ? {
                x: srcPos.x + (isTargetToRight ? propOff.right : propOff.left),
                y: srcPos.y + propOff.centerY
              }
            : {
                x: srcPos.x + (isTargetToRight ? srcSize.width - 14 : 14),
                y: srcPos.y + 88 + propIdx * 34
              };
        }

        const endPt = getRectBorderPoint(startPt, tgtRect, 9);
        const curveOffset = targets.length > 1 ? (tIdx - (targets.length - 1) / 2) * 18 : 0;
        const midX = (startPt.x + endPt.x) / 2;
        const midY = (startPt.y + endPt.y) / 2 - 18 + curveOffset;

        const ctrlPt = {
          x: 2 * midX - 0.5 * (startPt.x + endPt.x),
          y: 2 * midY - 0.5 * (startPt.y + endPt.y)
        };

        const displayBadge = isSrcEmoji
          ? (badge === 'ref' ? prop.name : `${prop.name}${badge}`)
          : badge;

        edges.push({
          id: `ptr::${srcObj.id}::${prop.name}::${targetId}::${badge}`,
          startPt,
          endPt,
          labelX: midX,
          labelY: midY,
          badge: displayBadge,
          pathD: `M ${startPt.x} ${startPt.y} Q ${ctrlPt.x} ${ctrlPt.y} ${endPt.x} ${endPt.y}`
        });
      });
    });
  }

  return edges;
}
