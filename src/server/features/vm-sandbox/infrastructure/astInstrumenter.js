import { parse } from '@babel/parser';
import generateModule from '@babel/generator';

const generate = generateModule.default || generateModule;

/**
 * Instrumente un nœud AST ClassDeclaration pour y injecter `__seepooGetPrivateState__()`
 * Cela permet à l'outil pédagogique de lire la valeur actuelle des propriétés privées (`#prop`)
 * pour les afficher avec un cadenas dans l'UI, alors que `Object.keys()` ne peut pas les voir.
 */
export function injectPrivateInspectorIntoClassNode(classNode, astMetaClasses) {
  const className = classNode.id?.name;
  const meta = astMetaClasses.find((c) => c.name === className);
  if (!meta) return;

  const privateProps = meta.properties.filter((p) => p.isPrivate);
  const privateDecls = privateProps.map((p) => `${p.name};`).join(' ');
  const entriesCode = privateProps
    .map((p) => `${JSON.stringify(p.name)}: this.${p.name}`)
    .join(', ');

  const helperAst = parse(
    `class Dummy { ${privateDecls} __seepooGetPrivateState__() { return { ${entriesCode} }; } }`,
    { plugins: ['classProperties', 'classPrivateProperties'] }
  );
  const dummyBody = helperAst.program.body[0].body.body;
  const methodNode = dummyBody[dummyBody.length - 1];
  classNode.body.body.push(methodNode);
}

/**
 * Extrait les classes instrumentées et les déclarations utilitaires d'un fichier source
 * tout en ignorant le code d'amorçage global (ex: `const game = new Game()` dans `script.js`).
 */
export function extractExecutableUnits(sourceCode, astMetaClasses, filePath) {
  let ast;
  try {
    ast = parse(sourceCode, {
      sourceType: 'unambiguous',
      plugins: [
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'decorators-legacy'
      ]
    });
  } catch {
    return { classUnits: [], helperUnits: [] };
  }

  const knownClassNames = new Set(astMetaClasses.map((c) => c.name));
  const classUnits = [];
  const helperUnits = [];

  for (const stmt of ast.program.body) {
    let node = stmt;
    if (stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration') {
      if (!stmt.declaration) continue;
      node = stmt.declaration;
    } else if (stmt.type === 'ImportDeclaration' || stmt.type === 'ExportAllDeclaration') {
      continue;
    }

    if (node.type === 'ClassDeclaration' && node.id?.name) {
      injectPrivateInspectorIntoClassNode(node, astMetaClasses);
      const className = node.id.name;
      const superClass = node.superClass?.name || null;
      const classCode = generate(node).code;
      classUnits.push({
        className,
        superClass,
        file: filePath,
        code: `${classCode}\nglobalThis.${className} = ${className};\nglobalThis.__classes__[${JSON.stringify(className)}] = ${className};`
      });
    } else if (node.type === 'FunctionDeclaration' && node.id?.name) {
      helperUnits.push({
        file: filePath,
        code: generate(node).code
      });
    } else if (node.type === 'VariableDeclaration') {
      const generated = generate(node).code;
      const instantiatesProjectClass = Array.from(knownClassNames).some((clsName) =>
        new RegExp(`\\bnew\\s+${clsName}\\b`).test(generated)
      );
      if (!instantiatesProjectClass) {
        const varNode = { ...node, kind: 'var' };
        helperUnits.push({
          file: filePath,
          code: generate(varNode).code
        });
      }
    }
  }

  return { classUnits, helperUnits };
}
