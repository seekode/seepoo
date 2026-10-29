/**
 * Transpile les classes Java extraites par `javaAstParser.js` en unités de classes JS
 * exécutables dans `node:vm` pour le bac à sable d'objets interactif (Onglet Objets).
 */

function convertJavaDefaultValueToJs(defaultVal, valueType) {
  if (!defaultVal) {
    if (valueType === 'Array') return '[]';
    if (valueType === 'number') return '0';
    if (valueType === 'boolean') return 'false';
    return 'null';
  }
  const s = defaultVal.trim();
  if (/^new\s+(?:ArrayList|LinkedList|HashSet|Vector)\b/.test(s)) {
    return '[]';
  }
  if (/^new\s+[A-Za-z0-9_]+\s*\[\s*0\s*\]/.test(s)) {
    return '[]';
  }
  // Suffixes numériques Java `100.0f` ou `100L` -> `100.0` / `100`
  if (/^-?\d+(\.\d+)?[fFdDlL]$/.test(s)) {
    return s.slice(0, -1);
  }
  return s;
}

export function transpileJavaMethodBodyToJs(
  rawBodyCode,
  classProperties = [],
  methodParams = []
) {
  if (!rawBodyCode) return '{}';
  let body = rawBodyCode.trim();

  // Retirer les accolades englobantes si présentes
  if (body.startsWith('{') && body.endsWith('}')) {
    body = body.slice(1, -1);
  }

  const paramNames = new Set((methodParams || []).map((p) => p.name));

  // Préfixer automatiquement l'accès aux champs de la classe par `this.` lorsqu'ils sont utilisés sans `this.`
  // et qu'ils ne sont pas masqués par un paramètre du même nom
  for (const prop of classProperties) {
    const pName = prop.name;
    if (paramNames.has(pName)) continue;
    const bareFieldRegex = new RegExp(`(?<!\\.|\\bthis\\.|\\bvar\\s|\\blet\\s|\\bconst\\s)\\b${pName}\\b(?!\\s*:)`, 'g');
    body = body.replace(bareFieldRegex, (match, offset, str) => {
      const before = str.slice(Math.max(0, offset - 15), offset);
      if (/\b(?:double|int|float|long|boolean|String|var|let|const)\s+$/.test(before)) {
        return match;
      }
      return `this.${pName}`;
    });
  }

  body = body
    // `System.out.println(...)` / `System.out.print(...)` -> `console.log(...)`
    .replace(/\bSystem\.out\.println\s*\(/g, 'console.log(')
    .replace(/\bSystem\.out\.print\s*\(/g, 'console.log(')
    // Collections Java : `.add(` -> `.push(`, `.size()` -> `.length`
    .replace(/\.add\s*\(/g, '.push(')
    .replace(/\.size\s*\(\s*\)/g, '.length')
    // `new ArrayList<>()` -> `[]`
    .replace(/\bnew\s+(?:ArrayList|LinkedList|HashSet|Vector)\s*(?:<[^>]*>)?\s*\(\s*\)/g, '[]')
    // `throw new IllegalArgumentException(...)` -> `throw new Error(...)`
    .replace(/\bthrow\s+new\s+[A-Za-z0-9_]+Exception\s*\(/g, 'throw new Error(')
    // Boucle for-each Java : `for (CompteBancaire c : this.allCompte)` -> `for (let c of this.allCompte)`
    .replace(
      /\bfor\s*\(\s*(?:final\s+)?[A-Za-z0-9_<>[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^)]+)\)/g,
      'for (let $1 of $2)'
    )
    // Boucle for classique : `for (int i = 0; ...)` -> `for (let i = 0; ...)`
    .replace(/\bfor\s*\(\s*(?:int|long|double|float)\s+/g, 'for (let ')
    // Déclarations locales typées : `double frais = ...` / `String msg = ...` -> `let frais = ...`
    .replace(
      /(^|[;{]\s*)(?:final\s+)?(?:double|int|float|long|boolean|String|char|Integer|Double|Boolean|List<[^>]+>|ArrayList<[^>]+>)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
      '$1let $2 ='
    );

  return `{\n${body}\n  }`;
}

export function buildJavaExecutableClassUnit(javaCls) {
  const className = javaCls.name;
  const superClass = javaCls.superClass || null;
  const extendsClause = superClass ? ` extends ${superClass}` : '';
  const props = javaCls.properties || [];

  const fieldLines = props.map((p) => {
    const jsDefault = convertJavaDefaultValueToJs(p.defaultValue, p.valueType);
    return `  ${p.name} = ${jsDefault};`;
  });

  const methodStrings = (javaCls.methods || []).map((m) => {
    const methodName = m.kind === 'constructor' ? 'constructor' : m.name;
    const paramsCode = (m.params || []).map((p) => p.name).join(', ');
    const jsBody = transpileJavaMethodBodyToJs(m.bodyCode, props, m.params);
    return `  ${methodName}(${paramsCode}) ${jsBody}`;
  });

  const classCode = `class ${className}${extendsClause} {\n${[...fieldLines, ...methodStrings].join('\n\n')}\n}`;

  return {
    className,
    superClass,
    file: javaCls.file,
    code: `${classCode}\nglobalThis.${className} = ${className};\nglobalThis.__classes__[${JSON.stringify(className)}] = ${className};`
  };
}
