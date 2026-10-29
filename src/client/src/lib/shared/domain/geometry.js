/**
 * Calcule le point d'intersection exact entre le segment (fromPoint -> centre de targetRect)
 * et le bord extérieur du rectangle `targetRect` avec une marge `pad`.
 */
export function getRectBorderPoint(fromPoint, targetRect, pad = 6) {
  const cx = targetRect.x + targetRect.width / 2;
  const cy = targetRect.y + targetRect.height / 2;
  const dx = fromPoint.x - cx;
  const dy = fromPoint.y - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = targetRect.width / 2 + pad;
  const halfH = targetRect.height / 2 + pad;

  const scaleX = halfW / Math.abs(dx || 0.0001);
  const scaleY = halfH / Math.abs(dy || 0.0001);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: cx + dx * scale,
    y: cy + dy * scale
  };
}

/**
 * Formate l'affichage du type d'une propriété (ex: "number", "CompteBancaire", "Array<CompteBancaire>")
 */
export function formatPropertyType(prop) {
  if (!prop.valueType) return 'any';
  if (prop.valueType === 'Array') {
    return `Array<${prop.arrayItemType || 'any'}>`;
  }
  return prop.valueType;
}

/**
 * Retire les accolades externes `{ ... }` du BlockStatement Babel et réaligne l'indentation
 * pour éviter la double accolade visuelle.
 */
export function formatMethodBody(rawBody, emptyLabel = '// Corps vide') {
  if (!rawBody) return '';
  let inner = rawBody.trim();
  if (inner.startsWith('{') && inner.endsWith('}')) {
    inner = inner.slice(1, -1);
  }
  const lines = inner.replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '').split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return emptyLabel;

  const minIndent = Math.min(
    ...nonEmptyLines.map((l) => (l.match(/^\s*/)?.[0] || '').length)
  );
  return lines.map((l) => l.slice(minIndent)).join('\n');
}
