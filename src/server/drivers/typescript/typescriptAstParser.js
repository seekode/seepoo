import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  extractJSDoc,
  extractParamTypesFromJsDoc,
  extractPropertyTypeFromJsDoc
} from '../../features/ast-analysis/domain/jsdocExtractor.js';
import {
  DOM_MEMBER_NAMES,
  inferTypeFromCodeLiteral,
  extractRootThisProperty
} from '../../features/ast-analysis/domain/typeInference.js';

const traverse = traverseModule.default || traverseModule;

const DOM_TS_TYPES = new Set([
  'HTMLElement',
  'Element',
  'Node',
  'HTMLDivElement',
  'HTMLSpanElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLCanvasElement',
  'HTMLFormElement',
  'SVGElement',
  'EventTarget'
]);

/**
 * Convertit un nœud TSType de Babel en `{ valueType, arrayItemType }` pour le modèle UML SeePOO
 */
export function resolveTsTypeNode(tsTypeNode) {
  if (!tsTypeNode) return { valueType: null, arrayItemType: null };

  const node =
    tsTypeNode.type === 'TSTypeAnnotation' ? tsTypeNode.typeAnnotation : tsTypeNode;
  if (!node) return { valueType: null, arrayItemType: null };

  switch (node.type) {
    case 'TSStringKeyword':
      return { valueType: 'string', arrayItemType: null };
    case 'TSNumberKeyword':
    case 'TSBigIntKeyword':
      return { valueType: 'number', arrayItemType: null };
    case 'TSBooleanKeyword':
      return { valueType: 'boolean', arrayItemType: null };
    case 'TSAnyKeyword':
    case 'TSUnknownKeyword':
      return { valueType: 'any', arrayItemType: null };
    case 'TSObjectKeyword':
      return { valueType: 'Object', arrayItemType: null };
    case 'TSArrayType': {
      const elem = resolveTsTypeNode(node.elementType);
      return {
        valueType: 'Array',
        arrayItemType: elem.valueType || 'any'
      };
    }
    case 'TSUnionType': {
      // Ex: `CompteBancaire | null` -> prend le premier type non-null/undefined
      for (const sub of node.types || []) {
        if (sub.type !== 'TSNullKeyword' && sub.type !== 'TSUndefinedKeyword' && sub.type !== 'TSVoidKeyword') {
          return resolveTsTypeNode(sub);
        }
      }
      return { valueType: 'any', arrayItemType: null };
    }
    case 'TSTypeReference': {
      const typeName =
        node.typeName?.type === 'Identifier'
          ? node.typeName.name
          : node.typeName?.right?.name || null;
      if (!typeName) return { valueType: null, arrayItemType: null };

      if (typeName === 'Array' || typeName === 'ReadonlyArray' || typeName === 'Set' || typeName === 'List') {
        const firstParam = node.typeParameters?.params?.[0];
        const elem = resolveTsTypeNode(firstParam);
        return {
          valueType: 'Array',
          arrayItemType: elem.valueType || 'any'
        };
      }
      if (DOM_TS_TYPES.has(typeName)) {
        return { valueType: 'HTML', arrayItemType: null };
      }
      if (typeName === 'Record' || typeName === 'Map') {
        return { valueType: 'Object', arrayItemType: null };
      }
      return { valueType: typeName, arrayItemType: null };
    }
    default:
      return { valueType: null, arrayItemType: null };
  }
}

function extractTsParamInfo(paramNode, sourceCode) {
  if (!paramNode) return { name: 'arg', defaultValue: null, tsType: { valueType: null, arrayItemType: null }, paramProp: null };

  // Support `constructor(public titulaire: string, private solde: number = 0)`
  if (paramNode.type === 'TSParameterProperty') {
    const inner = extractTsParamInfo(paramNode.parameter, sourceCode);
    return {
      ...inner,
      paramProp: {
        accessibility: paramNode.accessibility || 'public',
        readonly: Boolean(paramNode.readonly)
      }
    };
  }

  if (paramNode.type === 'Identifier') {
    return {
      name: paramNode.name,
      defaultValue: null,
      tsType: resolveTsTypeNode(paramNode.typeAnnotation),
      paramProp: null
    };
  }

  if (paramNode.type === 'AssignmentPattern') {
    const leftName = paramNode.left?.type === 'Identifier' ? paramNode.left.name : 'arg';
    const defaultValue = paramNode.right
      ? sourceCode.slice(paramNode.right.start, paramNode.right.end)
      : null;
    return {
      name: leftName,
      defaultValue,
      tsType: resolveTsTypeNode(paramNode.left?.typeAnnotation),
      paramProp: null
    };
  }

  if (paramNode.type === 'RestElement' && paramNode.argument?.type === 'Identifier') {
    return {
      name: `...${paramNode.argument.name}`,
      defaultValue: null,
      tsType: resolveTsTypeNode(paramNode.typeAnnotation),
      paramProp: null
    };
  }

  return { name: 'arg', defaultValue: null, tsType: { valueType: null, arrayItemType: null }, paramProp: null };
}

/**
 * Analyse un fichier TypeScript (.ts) et extrait toutes les déclarations de classes via l'AST Babel
 */
export async function parseTypeScriptFileAST(filePath, rootDir) {
  const sourceCode = await fs.readFile(filePath, 'utf-8');
  const relativePath = path.relative(rootDir, filePath);

  let ast;
  try {
    ast = parse(sourceCode, {
      sourceType: 'unambiguous',
      attachComment: true,
      plugins: [
        'typescript',
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
      if (!node.id || node.declare) return;

      const className = node.id.name;
      const superClass =
        node.superClass?.type === 'Identifier'
          ? node.superClass.name
          : node.superClass?.type === 'MemberExpression'
          ? node.superClass.property?.name
          : null;
      const classJsDoc = extractJSDoc(node.leadingComments);

      const propertiesMap = new Map();
      const methods = [];

      for (const member of node.body.body) {
        if (member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') {
          const isHashPrivate = member.type === 'ClassPrivateProperty';
          const isTsPrivate =
            member.accessibility === 'private' || member.accessibility === 'protected';
          const isPrivate = isHashPrivate || isTsPrivate;

          const rawName = isHashPrivate
            ? member.key.id.name
            : member.key.name || member.key.value;
          const propName = isHashPrivate ? `#${rawName}` : rawName;
          const propJsDoc = extractJSDoc(member.leadingComments);
          const defaultVal = member.value
            ? sourceCode.slice(member.value.start, member.value.end)
            : undefined;

          const tsType = resolveTsTypeNode(member.typeAnnotation);
          const jsdocType = extractPropertyTypeFromJsDoc(propJsDoc);
          const literalType = inferTypeFromCodeLiteral(defaultVal);

          propertiesMap.set(propName, {
            name: propName,
            isPrivate,
            isStatic: Boolean(member.static),
            defaultValue: defaultVal,
            valueType: tsType.valueType || jsdocType.valueType || literalType.valueType || null,
            arrayItemType:
              tsType.arrayItemType || jsdocType.arrayItemType || literalType.arrayItemType || null,
            jsdoc: propJsDoc,
            declaredIn: 'field'
          });
        }

        if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
          const isHashPrivate = member.type === 'ClassPrivateMethod';
          const isTsPrivate =
            member.accessibility === 'private' || member.accessibility === 'protected';
          const isPrivate = isHashPrivate || isTsPrivate;
          const rawName = isHashPrivate
            ? member.key.id.name
            : member.key.name || member.key.value;
          const methodName = isHashPrivate ? `#${rawName}` : rawName;
          const methodJsDoc = extractJSDoc(member.leadingComments);
          const paramTypes = extractParamTypesFromJsDoc(methodJsDoc);

          const params = member.params.map((p) => {
            const info = extractTsParamInfo(p, sourceCode);
            const jsdocPType = paramTypes[info.name];
            const literalPType = inferTypeFromCodeLiteral(info.defaultValue);
            const valueType =
              info.tsType?.valueType || jsdocPType?.valueType || literalPType?.valueType || null;
            const arrayItemType =
              info.tsType?.arrayItemType ||
              jsdocPType?.arrayItemType ||
              literalPType?.arrayItemType ||
              null;

            // Si c'est un paramètre de constructeur avec `public` / `private` / `protected`
            if (member.kind === 'constructor' && info.paramProp) {
              const propIsPriv =
                info.paramProp.accessibility === 'private' ||
                info.paramProp.accessibility === 'protected';
              if (!propertiesMap.has(info.name)) {
                propertiesMap.set(info.name, {
                  name: info.name,
                  isPrivate: propIsPriv,
                  isStatic: false,
                  defaultValue: info.defaultValue ?? null,
                  valueType: valueType || 'any',
                  arrayItemType: arrayItemType || null,
                  jsdoc: null,
                  declaredIn: 'constructor-param'
                });
              }
            }

            return {
              name: info.name,
              defaultValue: info.defaultValue,
              valueType,
              arrayItemType
            };
          });

          const localVars = new Map();

          const resolveExpressionType = (exprNode) => {
            if (!exprNode) return { valueType: null, arrayItemType: null };
            const exprCode = sourceCode.slice(exprNode.start, exprNode.end);
            const inferred = inferTypeFromCodeLiteral(exprCode);

            if (exprNode.type === 'Identifier') {
              if (localVars.has(exprNode.name)) return localVars.get(exprNode.name);
              if (paramTypes[exprNode.name]?.valueType) return paramTypes[exprNode.name];
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
              if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations || []) {
                  if (decl.id?.type === 'Identifier') {
                    const tsVarType = resolveTsTypeNode(decl.id.typeAnnotation);
                    const initType = decl.init ? resolveExpressionType(decl.init) : null;
                    const resolved = tsVarType.valueType ? tsVarType : initType;
                    if (resolved?.valueType) {
                      localVars.set(decl.id.name, resolved);
                    }
                  }
                }
              }

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
                      }
                    }
                  }
                  for (const key of ['callee', 'object', 'left', 'right', 'expression']) {
                    if (astNode[key]) checkDomMemberAccess(astNode[key]);
                  }
                };
                checkDomMemberAccess(expr);
              }

              if (stmt.type === 'BlockStatement') walkStatements(stmt.body);
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
            }
          };

          if (member.body?.body) {
            walkStatements(member.body.body);
          }

          methods.push({
            name: methodName,
            kind: member.kind,
            isPrivate,
            isStatic: Boolean(member.static),
            isAsync: Boolean(member.async),
            params,
            jsdoc: methodJsDoc,
            bodyCode: member.body ? sourceCode.slice(member.body.start, member.body.end) : '{}',
            loc: member.loc?.start
          });
        }
      }

      classes.push({
        name: className,
        language: 'typescript',
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
