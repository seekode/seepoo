export const HTML_TYPE_REGEX =
  /^(?:HTML\w*Element|Element|Node|HTMLElement|SVGElement|NodeList|HTMLCollection|HTML)$/i;

export const DOM_MEMBER_NAMES = new Set([
  'appendChild',
  'removeChild',
  'replaceChild',
  'insertBefore',
  'append',
  'prepend',
  'remove',
  'replaceWith',
  'addEventListener',
  'removeEventListener',
  'setAttribute',
  'getAttribute',
  'removeAttribute',
  'hasAttribute',
  'toggleAttribute',
  'querySelector',
  'querySelectorAll',
  'getElementsByClassName',
  'getElementsByTagName',
  'closest',
  'matches',
  'cloneNode',
  'classList',
  'className',
  'innerHTML',
  'outerHTML',
  'textContent',
  'innerText',
  'style',
  'dataset',
  'children',
  'childNodes',
  'parentElement',
  'parentNode',
  'firstElementChild',
  'lastElementChild',
  'nextElementSibling',
  'previousElementSibling',
  'tagName',
  'nodeName',
  'offsetWidth',
  'offsetHeight',
  'clientWidth',
  'clientHeight',
  'getBoundingClientRect'
]);

/**
 * Normalise une chaîne de type JSDoc (ex: "CompteBancaire[]", "Cell[][]", "HTMLElement", "number")
 * en { valueType, arrayItemType }
 */
export function parseTypeDescriptor(rawType) {
  if (!rawType) return { valueType: null, arrayItemType: null };
  let cleaned = rawType.trim();

  // Cas 1 : Array<Type>, Array.<Type> ou Array<Array<Type>>
  let isGenericArray = false;
  let genericMatch = cleaned.match(/^Array\.?<\s*(.+)\s*>$/i);
  while (genericMatch) {
    isGenericArray = true;
    cleaned = genericMatch[1].trim();
    genericMatch = cleaned.match(/^Array\.?<\s*(.+)\s*>$/i);
  }

  // Cas 2 : Type[] ou Type[][] (tableaux 1D ou multidimensionnels)
  const bracketMatch = cleaned.match(/^([^\[\]]+)(?:\[\])+$/);
  if (bracketMatch) {
    const inner = bracketMatch[1].trim();
    if (HTML_TYPE_REGEX.test(inner)) {
      return { valueType: 'HTML', arrayItemType: null };
    }
    return { valueType: 'Array', arrayItemType: inner };
  }

  if (isGenericArray) {
    if (HTML_TYPE_REGEX.test(cleaned)) {
      return { valueType: 'HTML', arrayItemType: null };
    }
    return { valueType: 'Array', arrayItemType: cleaned || 'any' };
  }

  if (HTML_TYPE_REGEX.test(cleaned)) {
    return { valueType: 'HTML', arrayItemType: null };
  }

  if (/^array$/i.test(cleaned)) {
    return { valueType: 'Array', arrayItemType: 'any' };
  }

  return { valueType: cleaned, arrayItemType: null };
}

/**
 * Infère un type simple depuis une expression de valeur par défaut JS (ex: "100" -> "number")
 */
export function inferTypeFromCodeLiteral(codeStr) {
  if (!codeStr) return { valueType: null, arrayItemType: null };
  const s = codeStr.trim();

  // Détection d'appels DOM retournant une ou plusieurs balises HTML
  if (
    /(?:^|\.)(?:createElement|createElementNS|createTextNode|createDocumentFragment|getElementById|querySelector|querySelectorAll|getElementsByClassName|getElementsByTagName|getElementsByName|closest|cloneNode)\s*\(/.test(
      s
    ) ||
    /^new\s+(?:HTML\w*Element|Element|Text|Comment|DocumentFragment|Image|Audio)\s*\(/.test(s)
  ) {
    return { valueType: 'HTML', arrayItemType: null };
  }

  if (/^['"`].*['"`]$/.test(s)) {
    if (/^['"`]\s*<[a-zA-Z][a-zA-Z0-9-]*\b[^>]*>/.test(s)) {
      return { valueType: 'HTML', arrayItemType: null };
    }
    return { valueType: 'string', arrayItemType: null };
  }
  if (/^-?\d+(\.\d+)?$/.test(s) || /^Number\(/.test(s)) {
    return { valueType: 'number', arrayItemType: null };
  }
  if (s === 'true' || s === 'false' || /^Boolean\(/.test(s)) {
    return { valueType: 'boolean', arrayItemType: null };
  }
  if (s.startsWith('[')) {
    if (
      /(?:createElement|getElementById|querySelector|querySelectorAll|getElementsByClassName|getElementsByTagName)\s*\(/.test(
        s
      )
    ) {
      return { valueType: 'HTML', arrayItemType: null };
    }
    const itemNewMatch = s.match(/new\s+([A-Za-z0-9_$]+)\s*\(/);
    return {
      valueType: 'Array',
      arrayItemType: itemNewMatch ? itemNewMatch[1] : 'any'
    };
  }
  if (s.startsWith('{')) return { valueType: 'Object', arrayItemType: null };
  const newMatch = s.match(/^new\s+([A-Za-z0-9_$]+)\s*\(/);
  if (newMatch) {
    if (newMatch[1] === 'Array') return { valueType: 'Array', arrayItemType: 'any' };
    return { valueType: newMatch[1], arrayItemType: null };
  }
  return { valueType: null, arrayItemType: null };
}

/**
 * Extrait le nom lisible d'un paramètre de méthode (Identifier, AssignmentPattern, RestElement)
 */
export function extractParamInfo(paramNode, sourceCode) {
  if (paramNode.type === 'Identifier') {
    return { name: paramNode.name, defaultValue: null };
  }
  if (paramNode.type === 'AssignmentPattern' && paramNode.left.type === 'Identifier') {
    return {
      name: paramNode.left.name,
      defaultValue: sourceCode.slice(paramNode.right.start, paramNode.right.end)
    };
  }
  if (paramNode.type === 'RestElement' && paramNode.argument.type === 'Identifier') {
    return { name: `...${paramNode.argument.name}`, defaultValue: null };
  }
  return { name: 'arg', defaultValue: null };
}

/**
 * Remonte une chaîne d'accès `this.prop`, `this.prop[y]` ou `this.prop[y][x]`
 * pour retrouver la propriété racine de l'instance (`this.prop`).
 */
export function extractRootThisProperty(exprNode) {
  let curr = exprNode;
  let indexedDepth = 0;

  while (curr && curr.type === 'MemberExpression' && curr.computed) {
    indexedDepth++;
    curr = curr.object;
  }

  if (curr && curr.type === 'MemberExpression' && curr.object.type === 'ThisExpression') {
    const isPrivate = curr.property.type === 'PrivateName';
    const propName = isPrivate ? `#${curr.property.id.name}` : curr.property.name;
    if (propName) {
      return { propName, isPrivate, indexedDepth };
    }
  }

  return null;
}
