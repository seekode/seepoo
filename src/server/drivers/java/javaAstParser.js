import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Normalise un type Java (`String`, `int`, `double`, `boolean`, `List<Compte>`, `Compte[]`)
 * vers le schéma de types universel SeePOO (`{ valueType, arrayItemType }`).
 */
export function resolveJavaType(rawJavaType) {
  if (!rawJavaType) return { valueType: null, arrayItemType: null };
  const t = rawJavaType.trim();

  // Tableaux natifs Java : `CompteBancaire[]`
  if (t.endsWith('[]')) {
    const elemType = t.slice(0, -2).trim();
    const resolvedElem = resolveJavaType(elemType);
    return {
      valueType: 'Array',
      arrayItemType: resolvedElem.valueType || elemType
    };
  }

  // Collections génériques Java : `List<CompteBancaire>`, `ArrayList<CompteBancaire>`, `Set<CompteBancaire>`
  const genericMatch = t.match(
    /^(?:List|ArrayList|LinkedList|Set|HashSet|Collection|Iterable|Vector)\s*<\s*([A-Za-z0-9_]+)\s*>$/
  );
  if (genericMatch) {
    const inner = resolveJavaType(genericMatch[1]);
    return {
      valueType: 'Array',
      arrayItemType: inner.valueType || genericMatch[1]
    };
  }

  if (/^(?:List|ArrayList|LinkedList|Set|HashSet|Collection)$/.test(t)) {
    return { valueType: 'Array', arrayItemType: 'any' };
  }

  if (t === 'String' || t === 'char' || t === 'Character' || t === 'CharSequence') {
    return { valueType: 'string', arrayItemType: null };
  }
  if (
    t === 'int' ||
    t === 'Integer' ||
    t === 'double' ||
    t === 'Double' ||
    t === 'float' ||
    t === 'Float' ||
    t === 'long' ||
    t === 'Long' ||
    t === 'short' ||
    t === 'Short' ||
    t === 'byte' ||
    t === 'Byte' ||
    t === 'BigDecimal' ||
    t === 'BigInteger'
  ) {
    return { valueType: 'number', arrayItemType: null };
  }
  if (t === 'boolean' || t === 'Boolean') {
    return { valueType: 'boolean', arrayItemType: null };
  }
  if (t === 'Object' || /^Map\b|^HashMap\b/.test(t)) {
    return { valueType: 'Object', arrayItemType: null };
  }
  if (t === 'void') {
    return { valueType: null, arrayItemType: null };
  }

  // Classe métier personnalisée (ex: `CompteBancaire`)
  const cleanGeneric = t.replace(/<.*>$/, '').trim();
  if (/^[A-Z][A-Za-z0-9_]*$/.test(cleanGeneric)) {
    return { valueType: cleanGeneric, arrayItemType: null };
  }

  return { valueType: null, arrayItemType: null };
}

function parseJavadocBlock(rawComment) {
  if (!rawComment) return null;
  const lines = rawComment
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const summaryLines = [];
  const tags = [];

  for (const line of lines) {
    if (line.startsWith('@')) {
      const m = line.match(/^@(\w+)\s*(.*)$/);
      if (m) tags.push({ tag: m[1], content: m[2] });
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
 * Trouve l'accolade fermante correspondante `}` à partir de l'index de `{`
 */
function findMatchingBrace(text, openBraceIdx) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (ch === "'" && !inDouble && text[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && text[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractLeadingJavadocBeforeIndex(source, targetIdx) {
  const before = source.slice(0, targetIdx).trimEnd();
  if (!before.endsWith('*/')) return null;
  const startIdx = before.lastIndexOf('/**');
  if (startIdx === -1) return null;
  const commentBlock = before.slice(startIdx);
  if (commentBlock.indexOf('*/') !== commentBlock.length - 2) return null;
  return parseJavadocBlock(commentBlock);
}

/**
 * Analyse un fichier Java (.java) et extrait toutes les classes, attributs, constructeurs et méthodes
 */
export async function parseJavaFileAST(filePath, rootDir) {
  const sourceCode = await fs.readFile(filePath, 'utf-8');
  const relativePath = path.relative(rootDir, filePath);

  const classes = [];
  const classRegex =
    /(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^>]+>)?(?:\s+extends\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?)?(?:\s+implements\s+[^{]+)?\s*\{/g;

  let match;
  while ((match = classRegex.exec(sourceCode)) !== null) {
    const className = match[1];
    const superClass = match[2] || null;
    const classStartIdx = match.index;
    const openBraceIdx = classStartIdx + match[0].length - 1;
    const closeBraceIdx = findMatchingBrace(sourceCode, openBraceIdx);
    if (closeBraceIdx === -1) continue;

    const classJsDoc = extractLeadingJavadocBeforeIndex(sourceCode, classStartIdx);
    const classBody = sourceCode.slice(openBraceIdx + 1, closeBraceIdx);

    const propertiesMap = new Map();
    const methods = [];

    // Parcourir les membres de premier niveau de la classe Java
    let cursor = 0;
    while (cursor < classBody.length) {
      // Ignorer espaces et commentaires
      const wsMatch = classBody.slice(cursor).match(/^\s+/);
      if (wsMatch) cursor += wsMatch[0].length;
      if (cursor >= classBody.length) break;

      if (classBody.startsWith('//', cursor)) {
        const nl = classBody.indexOf('\n', cursor);
        cursor = nl === -1 ? classBody.length : nl + 1;
        continue;
      }
      if (classBody.startsWith('/*', cursor)) {
        const endC = classBody.indexOf('*/', cursor + 2);
        cursor = endC === -1 ? classBody.length : endC + 2;
        continue;
      }
      if (classBody.startsWith('@', cursor)) {
        const nl = classBody.indexOf('\n', cursor);
        cursor = nl === -1 ? classBody.length : nl + 1;
        continue;
      }

      // Chercher le prochain `;` (attribut) ou `{` (méthode/constructeur) au niveau 0 des parenthèses
      let scan = cursor;
      let parenDepth = 0;
      let foundTerminator = null;
      let terminatorIdx = -1;

      while (scan < classBody.length) {
        const ch = classBody[scan];
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (parenDepth === 0 && (ch === ';' || ch === '{')) {
          foundTerminator = ch;
          terminatorIdx = scan;
          break;
        }
        scan++;
      }

      if (!foundTerminator) break;

      const headerText = classBody.slice(cursor, terminatorIdx).trim();
      const memberJavadoc = extractLeadingJavadocBeforeIndex(classBody, cursor);

      if (foundTerminator === ';') {
        // C'est un attribut (field) Java : ex `private double solde = 0.0;` ou `private List<CompteBancaire> allCompte = new ArrayList<>();`
        const eqIdx = headerText.indexOf('=');
        const declPart = eqIdx !== -1 ? headerText.slice(0, eqIdx).trim() : headerText;
        const defaultVal = eqIdx !== -1 ? headerText.slice(eqIdx + 1).trim() : null;

        const fieldMatch = declPart.match(
          /^(?:(public|private|protected)\s+)?(?:(static|final|transient|volatile)\s+)*([A-Za-z0-9_<>[\],\s]+?)\s+([A-Za-z_][A-Za-z0-9_]*)$/
        );
        if (fieldMatch) {
          const visibility = fieldMatch[1] || 'package';
          const modifier = fieldMatch[2] || '';
          const rawType = fieldMatch[3].trim();
          const fieldName = fieldMatch[4].trim();
          const isPrivate = visibility === 'private' || visibility === 'protected';
          const isStatic = modifier.includes('static');
          const resolvedType = resolveJavaType(rawType);

          propertiesMap.set(fieldName, {
            name: fieldName,
            isPrivate,
            isStatic,
            defaultValue: defaultVal,
            valueType: resolvedType.valueType || 'any',
            arrayItemType: resolvedType.arrayItemType || null,
            jsdoc: memberJavadoc,
            declaredIn: 'field'
          });
        }
        cursor = terminatorIdx + 1;
      } else if (foundTerminator === '{') {
        const bodyEndIdx = findMatchingBrace(classBody, terminatorIdx);
        if (bodyEndIdx === -1) break;

        const bodyCode = classBody.slice(terminatorIdx, bodyEndIdx + 1);
        const methodMatch = headerText.match(
          /^(?:(public|private|protected)\s+)?(?:(static|final|synchronized|abstract)\s+)*(?:([A-Za-z0-9_<>[\]]+)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)(?:\s*throws\s+[A-Za-z0-9_,\s]+)?$/
        );

        if (methodMatch) {
          const visibility = methodMatch[1] || 'public';
          const modifier = methodMatch[2] || '';
          const returnTypeRaw = methodMatch[3] ? methodMatch[3].trim() : null;
          const rawName = methodMatch[4].trim();
          const rawParams = methodMatch[5].trim();

          const isConstructor = rawName === className && !returnTypeRaw;
          const isPrivate = visibility === 'private' || visibility === 'protected';
          const isStatic = modifier.includes('static');

          const params = [];
          if (rawParams) {
            const paramParts = rawParams.split(',').map((s) => s.trim()).filter(Boolean);
            for (const pStr of paramParts) {
              const pClean = pStr.replace(/^final\s+/, '').trim();
              const lastSpace = pClean.lastIndexOf(' ');
              if (lastSpace !== -1) {
                const pTypeRaw = pClean.slice(0, lastSpace).trim();
                const pName = pClean.slice(lastSpace + 1).trim();
                const pResolved = resolveJavaType(pTypeRaw);
                params.push({
                  name: pName,
                  defaultValue: null,
                  valueType: pResolved.valueType,
                  arrayItemType: pResolved.arrayItemType
                });
              }
            }
          }

          methods.push({
            name: isConstructor ? 'constructor' : rawName,
            kind: isConstructor ? 'constructor' : 'method',
            returnType: returnTypeRaw,
            isPrivate,
            isStatic,
            isAsync: false,
            params,
            jsdoc: memberJavadoc,
            bodyCode
          });
        }

        cursor = bodyEndIdx + 1;
      }
    }

    classes.push({
      name: className,
      language: 'java',
      superClass,
      file: relativePath,
      jsdoc: classJsDoc,
      properties: Array.from(propertiesMap.values()),
      methods
    });

    classRegex.lastIndex = closeBraceIdx + 1;
  }

  return { classes, error: null };
}
