/**
 * Modèle de domaine universel (indépendant du langage de programmation cible).
 * Tous les LanguageDrivers (JavaScript, Python, PHP, Java...) produisent cette structure normalisée.
 */

export function createPropertyModel({
  name,
  isPrivate = false,
  isStatic = false,
  defaultValue = null,
  valueType = 'any',
  arrayItemType = null,
  jsdoc = null,
  status = 'implemented'
}) {
  return {
    name,
    isPrivate: Boolean(isPrivate),
    isStatic: Boolean(isStatic),
    defaultValue,
    valueType: valueType || 'any',
    arrayItemType: arrayItemType || null,
    jsdoc,
    status
  };
}

export function createMethodModel({
  name,
  kind = 'method',
  isPrivate = false,
  isStatic = false,
  params = [],
  jsdoc = null,
  bodyCode = '',
  status = 'implemented'
}) {
  return {
    name,
    kind,
    isPrivate: Boolean(isPrivate),
    isStatic: Boolean(isStatic),
    params: params.map((p) => (typeof p === 'string' ? { name: p, defaultValue: null } : p)),
    jsdoc,
    bodyCode,
    status
  };
}

export function createClassModel({
  name,
  language = 'javascript',
  emoji = '📦',
  superClass = null,
  astSuperClass = null,
  superClassIsDraft = false,
  file = null,
  position = null,
  jsdoc = null,
  status = 'implemented',
  properties = [],
  methods = []
}) {
  return {
    name,
    language,
    emoji,
    superClass,
    astSuperClass: astSuperClass ?? superClass,
    superClassIsDraft: Boolean(superClassIsDraft),
    file,
    position,
    jsdoc,
    status,
    properties: properties.map(createPropertyModel),
    methods: methods.map(createMethodModel)
  };
}
