import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';

const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

/**
 * Nettoie un AST TypeScript (supprime les annotations de types, `implements`, `accessibility`,
 * convertit les `TSParameterProperty` en assignations `this.prop = prop`) et injecte
 * `__seepooGetPrivateState__()` pour l'exécution directe dans `node:vm`.
 */
export function extractTypeScriptExecutableUnits(sourceCode, astMetaClasses, filePath) {
  let ast;
  try {
    ast = parse(sourceCode, {
      sourceType: 'unambiguous',
      plugins: [
        'typescript',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'decorators-legacy'
      ]
    });
  } catch {
    return { classUnits: [], helperUnits: [] };
  }

  // Supprimer les nœuds et annotations purement TypeScript
  traverse(ast, {
    enter(p) {
      const n = p.node;
      if (n.typeAnnotation) delete n.typeAnnotation;
      if (n.returnType) delete n.returnType;
      if (n.typeParameters) delete n.typeParameters;
      if (n.superTypeParameters) delete n.superTypeParameters;
      if (n.implements) delete n.implements;
      if (n.accessibility) delete n.accessibility;
      if (n.readonly) delete n.readonly;
      if (n.override) delete n.override;
      if (n.definite) delete n.definite;
    },
    TSInterfaceDeclaration(p) {
      p.remove();
    },
    TSTypeAliasDeclaration(p) {
      p.remove();
    },
    TSDeclareFunction(p) {
      p.remove();
    },
    TSDeclareMethod(p) {
      p.remove();
    },
    TSAsExpression(p) {
      p.replaceWith(p.node.expression);
    },
    TSTypeAssertion(p) {
      p.replaceWith(p.node.expression);
    },
    TSNonNullExpression(p) {
      p.replaceWith(p.node.expression);
    },
    ClassMethod(p) {
      if (p.node.kind === 'constructor') {
        const assignStmts = [];
        p.node.params = p.node.params.map((param) => {
          if (param.type === 'TSParameterProperty') {
            const inner = param.parameter;
            const paramName =
              inner.type === 'Identifier'
                ? inner.name
                : inner.type === 'AssignmentPattern' && inner.left?.type === 'Identifier'
                ? inner.left.name
                : null;
            if (paramName) {
              const assignAst = parse(`this.${paramName} = ${paramName};`).program.body[0];
              assignStmts.push(assignAst);
            }
            return inner;
          }
          return param;
        });
        if (assignStmts.length > 0 && p.node.body?.body) {
          // Insérer après un éventuel `super(...)`
          const firstStmt = p.node.body.body[0];
          const isSuperFirst =
            firstStmt?.type === 'ExpressionStatement' &&
            firstStmt.expression?.type === 'CallExpression' &&
            firstStmt.expression.callee?.type === 'Super';
          if (isSuperFirst) {
            p.node.body.body.splice(1, 0, ...assignStmts);
          } else {
            p.node.body.body.unshift(...assignStmts);
          }
        }
      }
    }
  });

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

    if (node.type === 'ClassDeclaration' && node.id?.name && !node.declare) {
      const className = node.id.name;
      const meta = astMetaClasses.find((c) => c.name === className);
      if (meta) {
        const hashPrivateProps = meta.properties.filter(
          (p) => p.isPrivate && p.name.startsWith('#')
        );
        const privateDecls = hashPrivateProps.map((p) => `${p.name};`).join(' ');
        const entriesCode = meta.properties
          .filter((p) => p.isPrivate)
          .map((p) => `${JSON.stringify(p.name)}: this.${p.name}`)
          .join(', ');

        const helperAst = parse(
          `class Dummy { ${privateDecls} __seepooGetPrivateState__() { return { ${entriesCode} }; } }`,
          { plugins: ['classProperties', 'classPrivateProperties'] }
        );
        const dummyBody = helperAst.program.body[0].body.body;
        node.body.body.push(dummyBody[dummyBody.length - 1]);
      }

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
    } else if (node.type === 'VariableDeclaration' && !node.declare) {
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
