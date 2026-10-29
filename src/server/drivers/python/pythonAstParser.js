import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Normalise une annotation de type Python (`str`, `int`, `float`, `bool`, `list[Compte]`, `Optional[Compte]`)
 * vers le schéma de types universel SeePOO (`{ valueType, arrayItemType }`).
 */
export function resolvePythonTypeAnnotation(rawType) {
  if (!rawType) return { valueType: null, arrayItemType: null };
  let t = rawType.trim();

  // Optional[X] ou X | None
  const optMatch = t.match(/^Optional\[(.+)\]$/i);
  if (optMatch) {
    t = optMatch[1].trim();
  } else if (t.includes('|')) {
    const parts = t
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s !== 'None');
    if (parts.length > 0) t = parts[0];
  }

  // list[X], List[X], set[X], Set[X], Sequence[X]
  const listMatch = t.match(/^(?:list|List|set|Set|Sequence|Iterable)\s*\[\s*([A-Za-z0-9_]+)\s*\]$/);
  if (listMatch) {
    const inner = resolvePythonTypeAnnotation(listMatch[1]);
    return {
      valueType: 'Array',
      arrayItemType: inner.valueType || listMatch[1]
    };
  }

  if (t === 'list' || t === 'List' || t === 'set' || t === 'Set') {
    return { valueType: 'Array', arrayItemType: 'any' };
  }
  if (t === 'str') return { valueType: 'string', arrayItemType: null };
  if (t === 'int' || t === 'float' || t === 'complex') {
    return { valueType: 'number', arrayItemType: null };
  }
  if (t === 'bool') return { valueType: 'boolean', arrayItemType: null };
  if (t === 'dict' || t === 'Dict' || t === 'object') {
    return { valueType: 'Object', arrayItemType: null };
  }
  if (t === 'Any' || t === 'any') {
    return { valueType: 'any', arrayItemType: null };
  }
  if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) {
    return { valueType: t, arrayItemType: null };
  }

  return { valueType: null, arrayItemType: null };
}

export function inferPythonLiteralType(rawExpr) {
  if (!rawExpr) return { valueType: null, arrayItemType: null };
  const s = rawExpr.trim();
  if (s === 'True' || s === 'False') return { valueType: 'boolean', arrayItemType: null };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { valueType: 'number', arrayItemType: null };
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    s.startsWith('f"') ||
    s.startsWith("f'")
  ) {
    return { valueType: 'string', arrayItemType: null };
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return { valueType: 'Array', arrayItemType: null };
    const firstItem = inner.split(',')[0].trim();
    const itemInf = inferPythonLiteralType(firstItem);
    return { valueType: 'Array', arrayItemType: itemInf.valueType || null };
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    return { valueType: 'Object', arrayItemType: null };
  }
  const ctorMatch = s.match(/^([A-Z][A-Za-z0-9_]*)\s*\(/);
  if (ctorMatch) {
    if (ctorMatch[1] === 'list' || ctorMatch[1] === 'set') {
      return { valueType: 'Array', arrayItemType: null };
    }
    if (ctorMatch[1] === 'dict') {
      return { valueType: 'Object', arrayItemType: null };
    }
    return { valueType: ctorMatch[1], arrayItemType: null };
  }
  return { valueType: null, arrayItemType: null };
}

function getIndent(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

/**
 * Extrait un éventuel docstring Python (`"""..."""` ou `'''...'''`) au début d'un bloc de lignes
 */
function extractPythonDocstring(lines, startIdx, minIndent) {
  let i = startIdx;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { jsdoc: null, nextIdx: startIdx };

  const line = lines[i];
  if (getIndent(line) <= minIndent) return { jsdoc: null, nextIdx: startIdx };

  const trimmed = line.trim();
  const quote = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null;
  if (!quote) return { jsdoc: null, nextIdx: startIdx };

  // Docstring sur une seule ligne : """Résumé..."""
  if (trimmed.length >= 6 && trimmed.endsWith(quote)) {
    const raw = trimmed.slice(3, -3).trim();
    return {
      jsdoc: parseDocstringContent(raw),
      nextIdx: i + 1
    };
  }

  // Docstring multi-lignes
  const docLines = [trimmed.slice(3)];
  i++;
  while (i < lines.length) {
    const cur = lines[i];
    const endPos = cur.indexOf(quote);
    if (endPos !== -1) {
      docLines.push(cur.slice(0, endPos));
      i++;
      break;
    }
    docLines.push(cur.trim());
    i++;
  }

  return {
    jsdoc: parseDocstringContent(docLines.join('\n').trim()),
    nextIdx: i
  };
}

function parseDocstringContent(raw) {
  if (!raw) return null;
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const summaryLines = [];
  const tags = [];

  for (const l of lines) {
    if (l.startsWith('@')) {
      const m = l.match(/^@(\w+)\s+(.*)$/);
      if (m) tags.push({ tag: m[1], content: m[2] });
    } else if (l.startsWith(':param ') || l.startsWith(':type ') || l.startsWith(':return')) {
      const m = l.match(/^:(\w+)\s*(.*)$/);
      if (m) tags.push({ tag: m[1], content: m[2] });
    } else if (tags.length === 0) {
      summaryLines.push(l);
    }
  }

  return {
    raw,
    summary: summaryLines.join(' ') || lines[0],
    tags
  };
}

function parsePythonParams(rawParamsStr) {
  if (!rawParamsStr || !rawParamsStr.trim()) return [];

  // Découpage au niveau 0 des crochets/parenthèses
  const parts = [];
  let current = '';
  let depth = 0;
  for (const ch of rawParamsStr) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const params = [];
  for (const part of parts) {
    if (!part || part === 'self' || part === 'cls' || part === '*') continue;
    // Ex: `montant: float = 0.0`
    let namePart = part;
    let defaultVal = null;
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      namePart = part.slice(0, eqIdx).trim();
      defaultVal = part.slice(eqIdx + 1).trim();
    }

    let paramName = namePart;
    let typeAnnotation = null;
    const colonIdx = namePart.indexOf(':');
    if (colonIdx !== -1) {
      paramName = namePart.slice(0, colonIdx).trim();
      typeAnnotation = namePart.slice(colonIdx + 1).trim();
    }

    const pyType = resolvePythonTypeAnnotation(typeAnnotation);
    const litType = inferPythonLiteralType(defaultVal);

    params.push({
      name: paramName,
      defaultValue: defaultVal,
      valueType: pyType.valueType || litType.valueType || null,
      arrayItemType: pyType.arrayItemType || litType.arrayItemType || null
    });
  }
  return params;
}

/**
 * Analyse un fichier Python (.py) et extrait toutes les classes, attributs, méthodes et types
 */
export async function parsePythonFileAST(filePath, rootDir) {
  const sourceCode = await fs.readFile(filePath, 'utf-8');
  const relativePath = path.relative(rootDir, filePath);
  const lines = sourceCode.replace(/\r\n/g, '\n').split('\n');

  const classes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*([^)]*)\s*\))?\s*:/);

    if (!classMatch) {
      i++;
      continue;
    }

    const classIndent = getIndent(line);
    const className = classMatch[1];
    const rawBases = classMatch[2] ? classMatch[2].split(',').map((b) => b.trim()).filter(Boolean) : [];
    const superClass =
      rawBases.length > 0 && rawBases[0] !== 'object' && rawBases[0] !== 'ABC'
        ? rawBases[0]
        : null;

    // Commentaires `#` juste au-dessus de la classe
    let leadingCommentSummary = null;
    if (i > 0 && lines[i - 1].trim().startsWith('#')) {
      leadingCommentSummary = lines[i - 1].trim().replace(/^#+\s*/, '');
    }

    // Trouver la fin du bloc de la classe
    let classEndIdx = i + 1;
    while (classEndIdx < lines.length) {
      const l = lines[classEndIdx];
      const t = l.trim();
      if (t !== '' && !t.startsWith('#') && getIndent(l) <= classIndent) {
        break;
      }
      classEndIdx++;
    }

    const { jsdoc: classDocstring, nextIdx: bodyStartIdx } = extractPythonDocstring(
      lines,
      i + 1,
      classIndent
    );
    const classJsDoc =
      classDocstring ||
      (leadingCommentSummary
        ? { raw: leadingCommentSummary, summary: leadingCommentSummary, tags: [] }
        : null);

    const propertiesMap = new Map();
    const methods = [];

    let cur = bodyStartIdx;
    while (cur < classEndIdx) {
      const curLine = lines[cur];
      const curTrimmed = curLine.trim();
      const curIndent = getIndent(curLine);

      if (!curTrimmed || curTrimmed.startsWith('#') || curTrimmed.startsWith('@')) {
        cur++;
        continue;
      }

      // 1. Déclaration de méthode : `def nom_methode(self, ...):`
      const defMatch = curTrimmed.match(
        /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^:]+))?\s*:/
      );

      if (defMatch && curIndent > classIndent) {
        const rawMethodName = defMatch[1];
        const rawParamsStr = defMatch[2];
        const methodIndent = curIndent;

        let methodEndIdx = cur + 1;
        while (methodEndIdx < classEndIdx) {
          const ml = lines[methodEndIdx];
          const mt = ml.trim();
          if (mt !== '' && !mt.startsWith('#') && getIndent(ml) <= methodIndent) {
            break;
          }
          methodEndIdx++;
        }

        const { jsdoc: methodDocstring, nextIdx: methodCodeStartIdx } = extractPythonDocstring(
          lines,
          cur + 1,
          methodIndent
        );

        const params = parsePythonParams(rawParamsStr);
        const isConstructor = rawMethodName === '__init__';
        const isDunder = rawMethodName.startsWith('__') && rawMethodName.endsWith('__');
        const isPrivate = !isDunder && rawMethodName.startsWith('_');

        const bodyLines = lines.slice(methodCodeStartIdx, methodEndIdx);

        // Analyser les assignations `self.xxx = ...` et `self.xxx.append(...)` dans la méthode
        for (const bLine of bodyLines) {
          const bt = bLine.trim();
          // `self.prop: Type = expr` ou `self.prop = expr`
          const selfAssignMatch = bt.match(
            /^self\.([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^=]+))?\s*=\s*(.+)$/
          );
          if (selfAssignMatch) {
            const attrName = selfAssignMatch[1];
            const attrTypeAnnot = selfAssignMatch[2]?.trim() || null;
            const rhsExpr = selfAssignMatch[3].trim();
            const isPrivAttr = attrName.startsWith('_');

            const annotType = resolvePythonTypeAnnotation(attrTypeAnnot);
            const litType = inferPythonLiteralType(rhsExpr);
            const matchingParam = params.find((p) => p.name === rhsExpr);

            const valueType =
              annotType.valueType ||
              matchingParam?.valueType ||
              litType.valueType ||
              null;
            const arrayItemType =
              annotType.arrayItemType ||
              matchingParam?.arrayItemType ||
              litType.arrayItemType ||
              null;

            if (!propertiesMap.has(attrName)) {
              if (isConstructor) {
                propertiesMap.set(attrName, {
                  name: attrName,
                  isPrivate: isPrivAttr,
                  isStatic: false,
                  defaultValue: rhsExpr,
                  valueType,
                  arrayItemType,
                  jsdoc: null,
                  declaredIn: 'constructor'
                });
              }
            } else {
              const existing = propertiesMap.get(attrName);
              if (!existing.valueType && valueType) {
                existing.valueType = valueType;
                existing.arrayItemType = arrayItemType;
              }
            }
          }

          // `self.prop.append(arg)`
          const appendMatch = bt.match(/^self\.([A-Za-z_][A-Za-z0-9_]*)\.append\(\s*([^)]+)\s*\)/);
          if (appendMatch) {
            const attrName = appendMatch[1];
            const argExpr = appendMatch[2].trim();
            const matchingParam = params.find((p) => p.name === argExpr);
            const litType = inferPythonLiteralType(argExpr);
            const itemType = matchingParam?.valueType || litType.valueType || null;
            if (itemType && propertiesMap.has(attrName)) {
              const existing = propertiesMap.get(attrName);
              existing.valueType = 'Array';
              if (!existing.arrayItemType || existing.arrayItemType === 'any') {
                existing.arrayItemType = itemType;
              }
            }
          }
        }

        const cleanBody = bodyLines
          .map((l) => (l.length >= methodIndent + 4 ? l.slice(methodIndent + 4) : l.trim()))
          .join('\n')
          .trim();

        methods.push({
          name: isConstructor ? 'constructor' : rawMethodName,
          displayName: rawMethodName,
          kind: isConstructor ? 'constructor' : 'method',
          isPrivate,
          isStatic: false,
          isAsync: curTrimmed.startsWith('async '),
          params,
          jsdoc: methodDocstring,
          bodyCode: cleanBody || 'pass',
          rawBodyLines: bodyLines,
          methodIndent,
          loc: { line: cur + 1, column: curIndent }
        });

        cur = methodEndIdx;
        continue;
      }

      // 2. Attribut de classe : `titulaire: str = ""` ou `plafond = 1000`
      const propMatch = curTrimmed.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^=]+))?(?:\s*=\s*(.+))?$/
      );
      if (propMatch && curIndent > classIndent && (propMatch[2] || propMatch[3])) {
        const attrName = propMatch[1];
        if (attrName !== 'pass') {
          const typeAnnot = propMatch[2]?.trim() || null;
          const defaultVal = propMatch[3]?.trim() ?? null;
          const isPrivate = attrName.startsWith('_');
          const annotType = resolvePythonTypeAnnotation(typeAnnot);
          const litType = inferPythonLiteralType(defaultVal);

          propertiesMap.set(attrName, {
            name: attrName,
            isPrivate,
            isStatic: false,
            defaultValue: defaultVal,
            valueType: annotType.valueType || litType.valueType || null,
            arrayItemType: annotType.arrayItemType || litType.arrayItemType || null,
            jsdoc: null,
            declaredIn: 'field'
          });
        }
      }

      cur++;
    }

    classes.push({
      name: className,
      language: 'python',
      superClass,
      file: relativePath,
      loc: { line: i + 1, column: classIndent },
      jsdoc: classJsDoc,
      properties: Array.from(propertiesMap.values()),
      methods
    });

    i = classEndIdx;
  }

  return { classes, error: null };
}
