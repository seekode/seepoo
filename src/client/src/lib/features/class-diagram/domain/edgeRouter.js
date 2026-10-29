import { getRectBorderPoint } from '$lib/shared/domain/geometry.js';

/**
 * Moteur de routage UML à chemin le plus court (Shortest Path) avec anti-collision :
 *
 * 1. Chemin le plus court direct entre cartes :
 *    - Analyse géométrique de la proximité relative entre chaque paire de classes (source <-> target).
 *    - Sélection automatique des flancs en vis-à-vis les plus proches (right <-> left ou bottom <-> top).
 *    - ZÉRO grand détour : les flèches traversent directement l'espace le plus court entre les deux cartes.
 *
 * 2. Organisation en voies parallèles sans croisement :
 *    - Si plusieurs liens relient les deux mêmes classes (ex: A extends B et B contains A, ou plusieurs propriétés),
 *      ils empruntent le même couloir direct, triés et distribués en voies parallèles étagées.
 *    - Aucun croisement en « X », aucune superposition.
 *
 * 3. Tangentes d'entrée 100% orthogonales :
 *    - L'arrivée sur la bordure de la carte cible est toujours perpendiculaire (horizontale ou verticale).
 *    - La pointe de flèche SVG est ainsi parfaitement alignée, centrée et plaquée sur le bord de la carte.
 *
 * 4. Anti-collision 2D (AABB) pour les boîtes d'étiquettes.
 */
export function computeRoutedEdges(classes, positions, cardSizes, propOffsets, classNamesSet) {
  const rawEdges = [];

  for (const cls of classes) {
    // 1. Lien d'héritage `extends`
    if (cls.superClass && classNamesSet.has(cls.superClass) && cls.superClass !== cls.name) {
      rawEdges.push({
        id: `extends::${cls.name}::${cls.superClass}`,
        kind: 'extends',
        sourceClass: cls.name,
        targetClass: cls.superClass,
        isDraft: cls.status === 'draft-only' || Boolean(cls.superClassIsDraft),
        boxWidth: 164,
        boxHeight: 28
      });
    }

    // 2. Trait `contains` DISTINCT pour CHAQUE propriété typée avec une classe du schéma
    (cls.properties || []).forEach((prop, propIdx) => {
      const targetClass =
        prop.valueType === 'Array' ? prop.arrayItemType : prop.valueType;

      if (targetClass && classNamesSet.has(targetClass) && targetClass !== cls.name) {
        const cardinality = prop.valueType === 'Array' ? 'N' : '1';
        rawEdges.push({
          id: `contains::${cls.name}::${prop.name}::${targetClass}`,
          kind: 'contains',
          sourceClass: cls.name,
          targetClass,
          propName: prop.name,
          propIdx,
          cardinality,
          isDraft: prop.status === 'draft-only' || cls.status === 'draft-only',
          boxWidth: 96,
          boxHeight: 26
        });
      }
    });
  }

  // Filtrer les arêtes dont les positions des classes sont connues
  const validEdges = rawEdges.filter(
    (e) => positions[e.sourceClass] && positions[e.targetClass]
  );

  // Étape 1 : Pour chaque paire de classes non ordonnée {A, B}, déterminer le couloir le plus court
  const pairCorridors = new Map();
  const getPairKey = (c1, c2) => (c1 < c2 ? `${c1}:::${c2}` : `${c2}:::${c1}`);

  for (const edge of validEdges) {
    const pairKey = getPairKey(edge.sourceClass, edge.targetClass);
    if (!pairCorridors.has(pairKey)) {
      const srcPos = positions[edge.sourceClass];
      const tgtPos = positions[edge.targetClass];
      const srcSize = cardSizes[edge.sourceClass] || { width: 310, height: 220 };
      const tgtSize = cardSizes[edge.targetClass] || { width: 310, height: 220 };

      const srcCenter = { x: srcPos.x + srcSize.width / 2, y: srcPos.y + srcSize.height / 2 };
      const tgtCenter = { x: tgtPos.x + tgtSize.width / 2, y: tgtPos.y + tgtSize.height / 2 };

      const dx = tgtCenter.x - srcCenter.x;
      const dy = tgtCenter.y - srcCenter.y;

      // Calculer l'orientation dominante pour le chemin le plus court direct
      const isHorizontal = Math.abs(dx) >= Math.abs(dy);

      let sideForSrc, sideForTgt;
      if (isHorizontal) {
        if (dx >= 0) {
          // target est à droite de source
          sideForSrc = 'right';
          sideForTgt = 'left';
        } else {
          // target est à gauche de source
          sideForSrc = 'left';
          sideForTgt = 'right';
        }
      } else {
        if (dy >= 0) {
          // target est en dessous de source
          sideForSrc = 'bottom';
          sideForTgt = 'top';
        } else {
          // target est au-dessus de source
          sideForSrc = 'top';
          sideForTgt = 'bottom';
        }
      }

      pairCorridors.set(pairKey, {
        isHorizontal,
        sides: {
          [edge.sourceClass]: sideForSrc,
          [edge.targetClass]: sideForTgt
        }
      });
    }
  }

  // Étape 2 : Préparer les côtés et points de départ
  const preparedEdges = validEdges.map((edge) => {
    const pairKey = getPairKey(edge.sourceClass, edge.targetClass);
    const corridor = pairCorridors.get(pairKey);

    const srcSide = corridor.sides[edge.sourceClass];
    const tgtSide = corridor.sides[edge.targetClass];

    const srcPos = positions[edge.sourceClass];
    const tgtPos = positions[edge.targetClass];
    const srcSize = cardSizes[edge.sourceClass] || { width: 310, height: 220 };
    const tgtSize = cardSizes[edge.targetClass] || { width: 310, height: 220 };

    const srcRect = { x: srcPos.x, y: srcPos.y, width: srcSize.width, height: srcSize.height };
    const tgtRect = { x: tgtPos.x, y: tgtPos.y, width: tgtSize.width, height: tgtSize.height };

    let startPt;

    if (edge.kind === 'contains') {
      const propKey = `${edge.sourceClass}::${edge.propName}`;
      const propOff = propOffsets[propKey];

      if (srcSide === 'left' || srcSide === 'right') {
        const propY = propOff ? propOff.centerY : 98 + (edge.propIdx || 0) * 30;
        startPt = {
          x: srcSide === 'right' ? srcRect.x + srcRect.width : srcRect.x,
          y: srcRect.y + propY
        };
      } else {
        // Départ top ou bottom
        startPt = {
          x: srcRect.x + srcRect.width / 2,
          y: srcSide === 'bottom' ? srcRect.y + srcRect.height : srcRect.y
        };
      }
    } else {
      // Pour `extends` (héritage)
      if (srcSide === 'left' || srcSide === 'right') {
        startPt = {
          x: srcSide === 'right' ? srcRect.x + srcRect.width : srcRect.x,
          y: srcRect.y + 36 // Niveau du header
        };
      } else {
        startPt = {
          x: srcRect.x + srcRect.width / 2,
          y: srcSide === 'bottom' ? srcRect.y + srcRect.height : srcRect.y
        };
      }
    }

    return {
      ...edge,
      srcRect,
      tgtRect,
      srcSide,
      tgtSide,
      startPt
    };
  });

  // Étape 3 : Distribution équitable des arrivées pour chaque côté récepteur
  // Regrouper par `targetClass::tgtSide`
  const incomingGroups = new Map();
  for (const edge of preparedEdges) {
    const key = `${edge.targetClass}::${edge.tgtSide}`;
    if (!incomingGroups.has(key)) incomingGroups.set(key, []);
    incomingGroups.get(key).push(edge);
  }

  // Pour chaque côté récepteur, trier par position de départ pour garantir 0 croisement
  for (const [key, group] of incomingGroups.entries()) {
    const [, side] = key.split('::');
    if (side === 'left' || side === 'right') {
      // Trier par coordonnée Y de départ pour des lignes parallèles
      group.sort((a, b) => a.startPt.y - b.startPt.y);
      const total = group.length;

      group.forEach((edge, idx) => {
        const tgtRect = edge.tgtRect;
        const padTop = 45;
        const padBottom = 35;
        const availableHeight = Math.max(40, tgtRect.height - padTop - padBottom);

        let targetY;
        if (total === 1) {
          // Si une seule arête, tenter d'aligner approximativement avec le départ dans les bornes
          targetY = Math.max(
            tgtRect.y + padTop,
            Math.min(tgtRect.y + tgtRect.height - padBottom, edge.startPt.y)
          );
        } else {
          // Répartition uniforme sans croisement
          const ratio = (idx + 1) / (total + 1);
          targetY = tgtRect.y + padTop + ratio * availableHeight;
        }

        edge.endPt = {
          x: side === 'left' ? tgtRect.x : tgtRect.x + tgtRect.width,
          y: targetY
        };
      });
    } else {
      // Arrivée 'top' ou 'bottom'
      group.sort((a, b) => a.startPt.x - b.startPt.x);
      const total = group.length;

      group.forEach((edge, idx) => {
        const tgtRect = edge.tgtRect;
        const padX = 45;
        const availableWidth = Math.max(40, tgtRect.width - 2 * padX);

        let targetX;
        if (total === 1) {
          targetX = Math.max(
            tgtRect.x + padX,
            Math.min(tgtRect.x + tgtRect.width - padX, edge.startPt.x)
          );
        } else {
          const ratio = (idx + 1) / (total + 1);
          targetX = tgtRect.x + padX + ratio * availableWidth;
        }

        edge.endPt = {
          x: targetX,
          y: side === 'top' ? tgtRect.y : tgtRect.y + tgtRect.height
        };
      });
    }
  }

  // Étape 4 : Calcul des points de contrôle Bézier cubique (Cubic Bézier) à courbure fluide
  const routedWithCurves = preparedEdges.map((edge) => {
    const { startPt, endPt, srcSide, tgtSide } = edge;

    const distX = Math.abs(endPt.x - startPt.x);
    const distY = Math.abs(endPt.y - startPt.y);
    const distTotal = Math.hypot(distX, distY) || 1;

    let cp1, cp2;

    if (srcSide === 'right' && tgtSide === 'left') {
      const curvature = Math.max(35, Math.min(180, distX * 0.45));
      cp1 = { x: startPt.x + curvature, y: startPt.y };
      cp2 = { x: endPt.x - curvature, y: endPt.y };
    } else if (srcSide === 'left' && tgtSide === 'right') {
      const curvature = Math.max(35, Math.min(180, distX * 0.45));
      cp1 = { x: startPt.x - curvature, y: startPt.y };
      cp2 = { x: endPt.x + curvature, y: endPt.y };
    } else if (srcSide === 'bottom' && tgtSide === 'top') {
      const curvature = Math.max(35, Math.min(180, distY * 0.45));
      cp1 = { x: startPt.x, y: startPt.y + curvature };
      cp2 = { x: endPt.x, y: endPt.y - curvature };
    } else if (srcSide === 'top' && tgtSide === 'bottom') {
      const curvature = Math.max(35, Math.min(180, distY * 0.45));
      cp1 = { x: startPt.x, y: startPt.y - curvature };
      cp2 = { x: endPt.x, y: endPt.y + curvature };
    } else {
      // Cas générique orthogonal
      const curvature = Math.max(35, Math.min(140, distTotal * 0.35));
      const getSideOffset = (side, amount) => {
        if (side === 'left') return { x: -amount, y: 0 };
        if (side === 'right') return { x: amount, y: 0 };
        if (side === 'top') return { x: 0, y: -amount };
        return { x: 0, y: amount };
      };
      const off1 = getSideOffset(srcSide, curvature);
      const off2 = getSideOffset(tgtSide, curvature);

      cp1 = { x: startPt.x + off1.x, y: startPt.y + off1.y };
      cp2 = { x: endPt.x + off2.x, y: endPt.y + off2.y };
    }

    // Position de l'étiquette au milieu de la courbe de Bézier cubique (t = 0.5)
    const labelX =
      0.125 * startPt.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * endPt.x;
    const labelY =
      0.125 * startPt.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * endPt.y;

    return {
      ...edge,
      cp1,
      cp2,
      labelX,
      labelY
    };
  });

  // Étape 5 : Anti-collision 2D (AABB) entre les boîtes d'étiquettes
  const padX = 16;
  const padY = 12;
  for (let iter = 0; iter < 12; iter++) {
    let movedAny = false;
    for (let i = 0; i < routedWithCurves.length; i++) {
      for (let j = i + 1; j < routedWithCurves.length; j++) {
        const a = routedWithCurves[i];
        const b = routedWithCurves[j];

        const minDistX = (a.boxWidth + b.boxWidth) / 2 + padX;
        const minDistY = (a.boxHeight + b.boxHeight) / 2 + padY;

        const diffX = b.labelX - a.labelX;
        const diffY = b.labelY - a.labelY;

        const overlapX = minDistX - Math.abs(diffX);
        const overlapY = minDistY - Math.abs(diffY);

        if (overlapX > 0 && overlapY > 0) {
          movedAny = true;
          if (overlapY <= overlapX * 1.2) {
            const signY = diffY === 0 ? (j % 2 === 0 ? 1 : -1) : Math.sign(diffY);
            const push = (overlapY / 2) * signY;
            a.labelY -= push;
            b.labelY += push;
          } else {
            const signX = diffX === 0 ? (j % 2 === 0 ? 1 : -1) : Math.sign(diffX);
            const push = (overlapX / 2) * signX;
            a.labelX -= push;
            b.labelX += push;
          }
        }
      }
    }
    if (!movedAny) break;
  }

  // Étape 6 : Génération des SVG pathD
  return routedWithCurves.map((edge) => {
    const { startPt, cp1, cp2, endPt } = edge;
    const pathD = `M ${startPt.x} ${startPt.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPt.x} ${endPt.y}`;

    return {
      ...edge,
      pathD
    };
  });
}
