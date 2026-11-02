import { getRectBorderPoint } from '$lib/shared/domain/geometry.js';

export const OBJ_CAMERA_STORAGE_KEY = 'seepoo:objects-camera:v1';
export const OBJ_STEPS_STORAGE_KEY = 'seepoo:object-steps:v1';

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
 * Calcul des flèches de pointeurs mémoire entre objets (partant directement de la ligne de la propriété)
 */
export function computePointerEdges(currentObjects, cardSizes, propOffsets) {
  const edges = [];
  const objMap = new Map(currentObjects.map((o) => [o.id, o]));

  for (const srcObj of currentObjects) {
    const srcPos = srcObj.position || { x: 100, y: 100 };
    const srcSize = cardSizes[srcObj.id] || { width: 340, height: 240 };
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
        const tgtPos = tgtObj.position || { x: 400, y: 100 };
        const tgtSize = cardSizes[targetId] || { width: 340, height: 240 };
        const tgtRect = { x: tgtPos.x, y: tgtPos.y, width: tgtSize.width, height: tgtSize.height };
        const tgtCenter = { x: tgtRect.x + tgtRect.width / 2, y: tgtRect.y + tgtRect.height / 2 };

        const propKey = `${srcObj.id}::${prop.name}`;
        const propOff = propOffsets[propKey];
        const isTargetToRight = tgtCenter.x >= srcCenter.x;

        const startPt = propOff
          ? {
              x: srcPos.x + (isTargetToRight ? propOff.right : propOff.left),
              y: srcPos.y + propOff.centerY
            }
          : {
              x: srcPos.x + (isTargetToRight ? srcSize.width - 14 : 14),
              y: srcPos.y + 88 + propIdx * 34
            };

        const endPt = getRectBorderPoint(startPt, tgtRect, 9);
        const curveOffset = targets.length > 1 ? (tIdx - (targets.length - 1) / 2) * 16 : 0;
        const midX = (startPt.x + endPt.x) / 2;
        const midY = (startPt.y + endPt.y) / 2 - 18 + curveOffset;

        const ctrlPt = {
          x: 2 * midX - 0.5 * (startPt.x + endPt.x),
          y: 2 * midY - 0.5 * (startPt.y + endPt.y)
        };

        edges.push({
          id: `ptr::${srcObj.id}::${prop.name}::${targetId}::${badge}`,
          startPt,
          endPt,
          labelX: midX,
          labelY: midY,
          badge,
          pathD: `M ${startPt.x} ${startPt.y} Q ${ctrlPt.x} ${ctrlPt.y} ${endPt.x} ${endPt.y}`
        });
      });
    });
  }

  return edges;
}
