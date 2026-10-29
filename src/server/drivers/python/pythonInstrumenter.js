/**
 * Transpile les classes Python extraites par `pythonAstParser.js` en unités de classes JS
 * exécutables dans `node:vm` pour le bac à sable d'objets interactif (Onglet Objets).
 */

function convertPythonExprToJs(expr) {
  if (!expr) return expr;
  let out = expr.trim();

  // Convertir les f-strings Python : f"Bonjour {self.nom} !" -> `Bonjour ${this.nom} !`
  out = out.replace(/\bf"([^"]*)"/g, (_, inner) => {
    const convertedInner = inner.replace(/\{([^}]+)\}/g, (__, e) => `\${${convertPythonExprToJs(e)}}`);
    return `\`${convertedInner}\``;
  });
  out = out.replace(/\bf'([^']*)'/g, (_, inner) => {
    const convertedInner = inner.replace(/\{([^}]+)\}/g, (__, e) => `\${${convertPythonExprToJs(e)}}`);
    return `\`${convertedInner}\``;
  });

  // Remplacements idiomatiques Python -> JS
  out = out
    .replace(/\bself\./g, 'this.')
    .replace(/\.append\s*\(/g, '.push(')
    .replace(/\bsuper\(\)\.__init__\s*\(/g, 'super(')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\s+/g, '!')
    .replace(/\bprint\s*\(/g, 'console.log(')
    .replace(/\blen\s*\(\s*([^)]+)\s*\)/g, '($1).length')
    .replace(/\bstr\s*\(\s*([^)]+)\s*\)/g, 'String($1)')
    .replace(/\bint\s*\(\s*([^)]+)\s*\)/g, ' Math.trunc(Number($1))')
    .replace(/\bfloat\s*\(\s*([^)]+)\s*\)/g, 'Number($1)');

  return out;
}

function getLineIndent(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

/**
 * Convertit un corps de méthode Python indenté en bloc JS `{ ... }`
 */
export function transpilePythonBodyToJs(rawBodyLines, baseIndent) {
  if (!rawBodyLines || rawBodyLines.length === 0) return '';

  const jsLines = [];
  const indentStack = [];

  for (const rawLine of rawBodyLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) continue;

    const indent = getLineIndent(rawLine);

    while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1]) {
      indentStack.pop();
      jsLines.push('}');
    }

    if (trimmed === 'pass') {
      continue;
    }

    // `elif cond:`
    const elifMatch = trimmed.match(/^elif\s+(.+):$/);
    if (elifMatch) {
      if (jsLines.length > 0 && jsLines[jsLines.length - 1] === '}') {
        jsLines.pop();
      }
      jsLines.push(`} else if (${convertPythonExprToJs(elifMatch[1])}) {`);
      indentStack.push(indent);
      continue;
    }

    // `else:`
    if (trimmed === 'else:') {
      if (jsLines.length > 0 && jsLines[jsLines.length - 1] === '}') {
        jsLines.pop();
      }
      jsLines.push('} else {');
      indentStack.push(indent);
      continue;
    }

    // `if cond:`
    const ifMatch = trimmed.match(/^if\s+(.+):$/);
    if (ifMatch) {
      jsLines.push(`if (${convertPythonExprToJs(ifMatch[1])}) {`);
      indentStack.push(indent);
      continue;
    }

    // `for item in iterable:`
    const forMatch = trimmed.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+):$/);
    if (forMatch) {
      jsLines.push(`for (const ${forMatch[1]} of ${convertPythonExprToJs(forMatch[2])}) {`);
      indentStack.push(indent);
      continue;
    }

    // `while cond:`
    const whileMatch = trimmed.match(/^while\s+(.+):$/);
    if (whileMatch) {
      jsLines.push(`while (${convertPythonExprToJs(whileMatch[1])}) {`);
      indentStack.push(indent);
      continue;
    }

    // `raise ValueError("...")`
    const raiseMatch = trimmed.match(/^raise\s+[A-Za-z0-9_]+\s*\((.*)\)$/);
    if (raiseMatch) {
      jsLines.push(`throw new Error(${convertPythonExprToJs(raiseMatch[1])});`);
      continue;
    }

    // `return ...`
    const returnMatch = trimmed.match(/^return(?:\s+(.*))?$/);
    if (returnMatch) {
      const retExpr = returnMatch[1] ? convertPythonExprToJs(returnMatch[1]) : '';
      jsLines.push(retExpr ? `return ${retExpr};` : 'return;');
      continue;
    }

    // Assignation typée `self.x: float = val` ou `x: int = val`
    const typedAssign = trimmed.match(/^(self\.[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+=\s*(.+)$/);
    if (typedAssign) {
      const lhs = convertPythonExprToJs(typedAssign[1]);
      const rhs = convertPythonExprToJs(typedAssign[2]);
      if (lhs.startsWith('this.')) {
        jsLines.push(`${lhs} = ${rhs};`);
      } else {
        jsLines.push(`var ${lhs} = ${rhs};`);
      }
      continue;
    }

    // Assignation locale `x = val`
    const simpleLocalAssign = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (simpleLocalAssign && !trimmed.includes('==')) {
      jsLines.push(
        `var ${simpleLocalAssign[1]} = ${convertPythonExprToJs(simpleLocalAssign[2])};`
      );
      continue;
    }

    jsLines.push(`${convertPythonExprToJs(trimmed)};`);
  }

  while (indentStack.length > 0) {
    indentStack.pop();
    jsLines.push('}');
  }

  return jsLines.join('\n');
}

export function buildPythonExecutableClassUnit(pyCls) {
  const className = pyCls.name;
  const superClass = pyCls.superClass || null;
  const extendsClause = superClass ? ` extends ${superClass}` : '';

  const fieldLines = (pyCls.properties || [])
    .filter((p) => p.declaredIn === 'field')
    .map((p) => {
      const defVal = p.defaultValue ? convertPythonExprToJs(p.defaultValue) : 'null';
      return `  ${p.name} = ${defVal};`;
    });

  const methodStrings = (pyCls.methods || []).map((m) => {
    const methodName = m.kind === 'constructor' ? 'constructor' : m.name;
    const paramsCode = (m.params || [])
      .map((p) =>
        p.defaultValue ? `${p.name} = ${convertPythonExprToJs(p.defaultValue)}` : p.name
      )
      .join(', ');
    const jsBody = transpilePythonBodyToJs(m.rawBodyLines || [], m.methodIndent || 4);
    return `  ${methodName}(${paramsCode}) {\n${jsBody}\n  }`;
  });

  const classCode = `class ${className}${extendsClause} {\n${[...fieldLines, ...methodStrings].join('\n\n')}\n}`;

  return {
    className,
    superClass,
    file: pyCls.file,
    code: `${classCode}\nglobalThis.${className} = ${className};\nglobalThis.__classes__[${JSON.stringify(className)}] = ${className};`
  };
}
