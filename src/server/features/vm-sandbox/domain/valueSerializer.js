/**
 * Sérialise une valeur JS et détecte si elle pointe vers une autre instance en mémoire
 */
export function serializeValue(val, instanceToId, instances, depth = 0, seen = new WeakSet()) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'function') return '[Function]';
  if (typeof val === 'symbol') return val.toString();
  if (typeof val !== 'object') return val;

  if (val.__seepooDomStub) {
    return val.__label || '[HTMLElement]';
  }

  if (instanceToId.has(val)) {
    const targetId = instanceToId.get(val);
    const targetEntry = instances.get(targetId);
    return {
      __type: 'Pointer',
      targetId,
      targetLabel: targetEntry?.label,
      targetClass: targetEntry?.className
    };
  }

  if (seen.has(val)) {
    return '[Circular]';
  }
  if (depth > 4) {
    const ctorName = val.constructor?.name;
    return ctorName && ctorName !== 'Object' ? `[${ctorName}]` : '[Object]';
  }

  seen.add(val);

  if (Array.isArray(val)) {
    return val.map((item) => serializeValue(item, instanceToId, instances, depth + 1, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = serializeValue(v, instanceToId, instances, depth + 1, seen);
  }
  return out;
}

/**
 * Crée automatiquement une arête de pointeur lorsqu'une propriété stocke une référence vers un objet B
 */
export function extractEdgesFromProperty(sourceId, propName, serializedValue, edgesList) {
  if (serializedValue && serializedValue.__type === 'Pointer') {
    edgesList.push({
      id: `edge_${sourceId}_${propName}_${serializedValue.targetId}`,
      source: sourceId,
      sourceHandle: `prop-${propName}`,
      target: serializedValue.targetId,
      targetHandle: 'instance-target',
      label: propName,
      animated: true
    });
  } else if (Array.isArray(serializedValue)) {
    serializedValue.forEach((item, idx) => {
      if (item && item.__type === 'Pointer') {
        edgesList.push({
          id: `edge_${sourceId}_${propName}_${idx}_${item.targetId}`,
          source: sourceId,
          sourceHandle: `prop-${propName}`,
          target: item.targetId,
          targetHandle: 'instance-target',
          label: `${propName}[${idx}]`,
          animated: true
        });
      }
    });
  }
}
