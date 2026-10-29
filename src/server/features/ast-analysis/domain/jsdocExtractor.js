import { parseTypeDescriptor } from './typeInference.js';

/**
 * Nettoie un bloc de commentaire JSDoc brut en texte lisible structuré
 */
export function extractJSDoc(comments) {
  if (!comments || comments.length === 0) return null;

  const jsdocComment = [...comments]
    .reverse()
    .find((c) => c.type === 'CommentBlock' && c.value.startsWith('*'));

  if (!jsdocComment) return null;

  const lines = jsdocComment.value
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0);

  const summaryLines = [];
  const tags = [];

  for (const line of lines) {
    if (line.startsWith('@')) {
      const match = line.match(/^@(\w+)\s*(.*)$/);
      if (match) {
        tags.push({ tag: match[1], content: match[2] });
      }
    } else if (tags.length === 0) {
      summaryLines.push(line);
    }
  }

  return {
    raw: lines.join('\n'),
    summary: summaryLines.join(' '),
    tags
  };
}

/**
 * Extrait un dictionnaire { [paramName]: { valueType, arrayItemType } } depuis les tags @param d'une JSDoc
 */
export function extractParamTypesFromJsDoc(jsdoc) {
  const map = {};
  if (!jsdoc?.tags) return map;

  for (const t of jsdoc.tags) {
    if (t.tag === 'param') {
      const m = t.content.match(/^\{([^}]+)\}\s+\[?([A-Za-z0-9_$]+)/);
      if (m) {
        map[m[2]] = parseTypeDescriptor(m[1]);
      }
    }
  }
  return map;
}

/**
 * Extrait le tag @type {Type} éventuel d'une propriété
 */
export function extractPropertyTypeFromJsDoc(jsdoc) {
  if (!jsdoc?.tags) return { valueType: null, arrayItemType: null };
  const typeTag = jsdoc.tags.find((t) => t.tag === 'type');
  if (!typeTag) return { valueType: null, arrayItemType: null };
  const m = typeTag.content.match(/^\{([^}]+)\}/);
  return m ? parseTypeDescriptor(m[1]) : { valueType: null, arrayItemType: null };
}
