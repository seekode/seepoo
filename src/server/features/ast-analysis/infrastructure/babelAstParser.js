import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  extractJSDoc,
  extractParamTypesFromJsDoc,
  extractPropertyTypeFromJsDoc
} from '../domain/jsdocExtractor.js';
import {
  DOM_MEMBER_NAMES,
  inferTypeFromCodeLiteral,
  extractParamInfo,
  extractRootThisProperty
} from '../domain/typeInference.js';

const traverse = traverseModule.default || traverseModule;

/**
 * Analyse un fichier JavaScript et extrait toutes les déclarations de classes via l'AST Babel
 */
export async function parseFileAST(filePath, rootDir) {
  const sourceCode = await fs.readFile(filePath, 'utf-8');
  const relativePath = path.relative(rootDir, filePath);

  let ast;
  try {
    ast = parse(sourceCode, {
      sourceType: 'unambiguous',
      attachComment: true,
      plugins: [
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'decorators-legacy'
      ]
    });
  } catch (syntaxError) {
    return {
      classes: [],
      error: {
        file: relativePath,
        message: syntaxError.message,
        loc: syntaxError.loc
      }
    };
  }

  const classes = [];

  traverse(ast, {
    ClassDeclaration(classPath) {
      const node = classPath.node;
      if (!node.id) return;

      const className = node.id.name;
      const superClass = node.superClass ? node.superClass.name : null;
      const classJsDoc = extractJSDoc(node.leadingComments);

      const propertiesMap = new Map();
      const methods = [];

      // 1. Parcourir les membres de la classe
      for (const member of node.body.body) {
        if (member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') {
          const isPrivate = member.type === 'ClassPrivateProperty';
          const rawName = isPrivate ? member.key.id.name : (member.key.name || member.key.value);
          const propName = isPrivate ? `#${rawName}` : rawName;
          const propJsDoc = extractJSDoc(member.leadingComments);
          const defaultVal = member.value
            ? sourceCode.slice(member.value.start, member.value.end)
            : undefined;

          const jsdocType = extractPropertyTypeFromJsDoc(propJsDoc);
          const literalType = inferTypeFromCodeLiteral(defaultVal);

          propertiesMap.set(propName, {
            name: propName,
            isPrivate,
            isStatic: Boolean(member.static),
            defaultValue: defaultVal,
            valueType: jsdocType.valueType || literalType.valueType || null,
            arrayItemType: jsdocType.arrayItemType || literalType.arrayItemType || null,
            jsdoc: propJsDoc,
            declaredIn: 'field'
          });
        }

        if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
          const isPrivate = member.type === 'ClassPrivateMethod';
          const rawName = isPrivate ? member.key.id.name : (member.key.name || member.key.value);
          const methodName = isPrivate ? `#${rawName}` : rawName;
          const methodJsDoc = extractJSDoc(member.leadingComments);
          const paramTypes = extractParamTypesFromJsDoc(methodJsDoc);

          const params = member.params.map((p) => {
            const info = extractParamInfo(p, sourceCode);
            const pType = paramTypes[info.name] || inferTypeFromCodeLiteral(info.defaultValue);
            return {
              ...info,
              valueType: pType?.valueType || null,
              arrayItemType: pType?.arrayItemType || null
            };
          });

          const localVars = new Map();

          const resolveExpressionType = (exprNode) => {
            if (!exprNode) return { valueType: null, arrayItemType: null };
            const exprCode = sourceCode.slice(exprNode.start, exprNode.end);
            const inferred = inferTypeFromCodeLiteral(exprCode);

            if (exprNode.type === 'Identifier') {
              if (localVars.has(exprNode.name)) {
                return localVars.get(exprNode.name);
              }
              if (paramTypes[exprNode.name]?.valueType) {
                return paramTypes[exprNode.name];
              }
              const matchingParam = params.find((p) => p.name === exprNode.name);
              if (matchingParam?.valueType) {
                return {
                  valueType: matchingParam.valueType,
                  arrayItemType: matchingParam.arrayItemType
                };
              }
            }
            return inferred;
          };

          const applyArrayItemType = (propName, isPrivProp, itemType) => {
            if (!itemType || itemType === 'Array' || itemType === 'any') return;
            if (!propertiesMap.has(propName)) {
              if (member.kind === 'constructor') {
                propertiesMap.set(propName, {
                  name: propName,
                  isPrivate: isPrivProp,
                  isStatic: false,
                  defaultValue: '[]',
                  valueType: 'Array',
                  arrayItemType: itemType,
                  jsdoc: null,
                  declaredIn: 'constructor'
                });
              }
            } else {
              const existing = propertiesMap.get(propName);
              existing.valueType = 'Array';
              if (!existing.arrayItemType || existing.arrayItemType === 'any') {
                existing.arrayItemType = itemType;
              }
            }
          };

          const walkStatements = (stmts) => {
            for (const stmt of stmts || []) {
              if (!stmt) continue;

              // 1. Déclarations de variables locales : `const cell = new Cell(x, y)`
              if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations || []) {
                  if (decl.id?.type === 'Identifier' && decl.init) {
                    const varType = resolveExpressionType(decl.init);
                    if (varType?.valueType) {
                      localVars.set(decl.id.name, varType);
                    }
                  }
                }
              }

              // 2. Assignations et appels `.push(...)` / `.unshift(...)`
              if (stmt.type === 'ExpressionStatement' && stmt.expression) {
                const expr = stmt.expression;

                if (expr.type === 'AssignmentExpression') {
                  const rootProp = extractRootThisProperty(expr.left);
                  if (rootProp) {
                    const { propName: pName, isPrivate: isPrivProp, indexedDepth } = rootProp;
                    const rightCode = sourceCode.slice(expr.right.start, expr.right.end);
                    const inferred = resolveExpressionType(expr.right);

                    if (indexedDepth > 0) {
                      const itemType =
                        inferred.valueType === 'Array' ? inferred.arrayItemType : inferred.valueType;
                      applyArrayItemType(pName, isPrivProp, itemType);
                    } else if (!propertiesMap.has(pName)) {
                      if (member.kind === 'constructor') {
                        propertiesMap.set(pName, {
                          name: pName,
                          isPrivate: isPrivProp,
                          isStatic: false,
                          defaultValue: rightCode,
                          valueType: inferred.valueType || null,
                          arrayItemType: inferred.arrayItemType || null,
                          jsdoc: null,
                          declaredIn: 'constructor'
                        });
                      }
                    } else {
                      const existing = propertiesMap.get(pName);
                      if (!existing.valueType && inferred.valueType) {
                        existing.valueType = inferred.valueType;
                        existing.arrayItemType = inferred.arrayItemType;
                      } else if (
                        existing.valueType === 'Array' &&
                        (!existing.arrayItemType || existing.arrayItemType === 'any') &&
                        inferred.arrayItemType
                      ) {
                        existing.arrayItemType = inferred.arrayItemType;
                      }
                    }
                  }
                }

                if (
                  expr.type === 'CallExpression' &&
                  expr.callee.type === 'MemberExpression' &&
                  !expr.callee.computed &&
                  (expr.callee.property.name === 'push' || expr.callee.property.name === 'unshift') &&
                  expr.arguments.length > 0
                ) {
                  const rootProp = extractRootThisProperty(expr.callee.object);
                  if (rootProp) {
                    const argInferred = resolveExpressionType(expr.arguments[0]);
                    const itemType =
                      argInferred.valueType === 'Array'
                        ? argInferred.arrayItemType
                        : argInferred.valueType;
                    applyArrayItemType(rootProp.propName, rootProp.isPrivate, itemType);
                  }
                }

                const checkDomMemberAccess = (astNode) => {
                  if (!astNode || typeof astNode !== 'object') return;
                  if (
                    astNode.type === 'MemberExpression' &&
                    !astNode.computed &&
                    DOM_MEMBER_NAMES.has(astNode.property?.name)
                  ) {
                    const rootProp = extractRootThisProperty(astNode.object);
                    if (rootProp && propertiesMap.has(rootProp.propName)) {
                      const existing = propertiesMap.get(rootProp.propName);
                      if (!existing.valueType || existing.valueType === 'any') {
                        existing.valueType = 'HTML';
                      } else if (
                        existing.valueType === 'Array' &&
                        (!existing.arrayItemType || existing.arrayItemType === 'any')
                      ) {
                        existing.arrayItemType = 'HTML';
                      }
                    }
                  }
                  for (const key of ['callee', 'object', 'left', 'right', 'expression']) {
                    if (astNode[key]) checkDomMemberAccess(astNode[key]);
                  }
                  if (Array.isArray(astNode.arguments)) {
                    astNode.arguments.forEach(checkDomMemberAccess);
                  }
                };
                checkDomMemberAccess(expr);
              }

              // 3. Descente récursive dans les structures de contrôle
              if (stmt.type === 'BlockStatement') walkStatements(stmt.body);
              if (
                stmt.type === 'ForStatement' ||
                stmt.type === 'ForInStatement' ||
                stmt.type === 'ForOfStatement' ||
                stmt.type === 'WhileStatement' ||
                stmt.type === 'DoWhileStatement'
              ) {
                walkStatements(stmt.body?.type === 'BlockStatement' ? stmt.body.body : [stmt.body]);
              }
              if (stmt.type === 'IfStatement') {
                walkStatements(
                  stmt.consequent?.type === 'BlockStatement'
                    ? stmt.consequent.body
                    : [stmt.consequent]
                );
                if (stmt.alternate) {
                  walkStatements(
                    stmt.alternate.type === 'BlockStatement'
                      ? stmt.alternate.body
                      : [stmt.alternate]
                  );
                }
              }
              if (stmt.type === 'TryStatement') {
                walkStatements(stmt.block?.body);
                walkStatements(stmt.handler?.body?.body);
                walkStatements(stmt.finalizer?.body);
              }
            }
          };

          walkStatements(member.body.body || []);

          methods.push({
            name: methodName,
            kind: member.kind,
            isPrivate,
            isStatic: Boolean(member.static),
            isAsync: Boolean(member.async),
            params,
            jsdoc: methodJsDoc,
            bodyCode: sourceCode.slice(member.body.start, member.body.end),
            loc: member.loc?.start
          });
        }
      }

      classes.push({
        name: className,
        superClass,
        file: relativePath,
        loc: node.loc?.start,
        jsdoc: classJsDoc,
        properties: Array.from(propertiesMap.values()),
        methods
      });
    }
  });

  return { classes, error: null };
}
