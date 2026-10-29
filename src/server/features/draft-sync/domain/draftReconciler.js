/**
 * Réconcilie les classes extraites de l'AST réel (JS, TS, Python, Java)
 * avec celles planifiées dans .poo-draft.json
 */
export function reconcileAstWithDraft(astClasses, draftData, activeLanguage = 'auto') {
  const draftClasses = Array.isArray(draftData?.classes) ? draftData.classes : [];
  const positions = draftData?.positions || {};
  const reconciledMap = new Map();

  // 1. Indexer les classes réelles issues du code (AST)
  for (const astCls of astClasses) {
    reconciledMap.set(astCls.name, {
      ...astCls,
      language: astCls.language || 'javascript',
      emoji: '📦',
      astSuperClass: astCls.superClass || null,
      superClassIsDraft: false,
      position: positions[astCls.name] || null,
      status: 'implemented',
      properties: astCls.properties.map((p) => ({
        ...p,
        valueType: p.valueType || 'any',
        arrayItemType: p.arrayItemType || null,
        status: 'implemented'
      })),
      methods: astCls.methods.map((m) => ({ ...m, status: 'implemented' }))
    });
  }

  // 2. Fusionner avec les classes du Draft (.poo-draft.json)
  for (const draftCls of draftClasses) {
    if (!reconciledMap.has(draftCls.name)) {
      const draftLang =
        draftCls.language || (activeLanguage !== 'auto' ? activeLanguage : 'javascript');
      if (activeLanguage !== 'auto' && draftCls.language && draftCls.language !== activeLanguage) {
        continue;
      }
      reconciledMap.set(draftCls.name, {
        name: draftCls.name,
        language: draftLang,
        emoji: draftCls.emoji || '📦',
        superClass: draftCls.superClass || null,
        superClassIsDraft: Boolean(draftCls.superClass),
        file: null,
        position: draftCls.position || positions[draftCls.name] || null,
        jsdoc: draftCls.jsdoc ? { summary: draftCls.jsdoc, tags: [] } : null,
        status: 'draft-only',
        properties: (draftCls.properties || []).map((p) => ({
          name: p.name,
          isPrivate: Boolean(p.isPrivate ?? p.name.startsWith('#')),
          isStatic: Boolean(p.isStatic),
          defaultValue: p.defaultValue ?? null,
          valueType: p.valueType || 'any',
          arrayItemType: p.arrayItemType || null,
          jsdoc: p.jsdoc ? { summary: p.jsdoc, tags: [] } : null,
          status: 'draft-only'
        })),
        methods: (draftCls.methods || []).map((m) => ({
          name: m.name,
          kind: m.kind || 'method',
          isPrivate: Boolean(m.isPrivate ?? m.name.startsWith('#')),
          isStatic: Boolean(m.isStatic),
          params: (m.params || []).map((p) =>
            typeof p === 'string' ? { name: p, defaultValue: null } : p
          ),
          jsdoc: m.jsdoc ? { summary: m.jsdoc, tags: [] } : null,
          bodyCode: '// Méthode planifiée (Draft)',
          status: 'draft-only'
        }))
      });
    } else {
      const targetCls = reconciledMap.get(draftCls.name);
      targetCls.status = 'synced';
      if (draftCls.emoji) {
        targetCls.emoji = draftCls.emoji;
      }
      if (draftCls.superClass !== undefined) {
        targetCls.superClass = draftCls.superClass;
        targetCls.superClassIsDraft = draftCls.superClass !== targetCls.astSuperClass;
      }
      if (draftCls.position || positions[draftCls.name]) {
        targetCls.position = draftCls.position || positions[draftCls.name];
      }

      // Réconciliation des propriétés (y compris surcharge éventuelle de valueType / arrayItemType)
      for (const draftProp of draftCls.properties || []) {
        const existingProp = targetCls.properties.find((p) => p.name === draftProp.name);
        if (existingProp) {
          existingProp.status = 'synced';
          if (draftProp.valueType) existingProp.valueType = draftProp.valueType;
          if (draftProp.arrayItemType !== undefined) {
            existingProp.arrayItemType = draftProp.arrayItemType;
          }
        } else {
          targetCls.properties.push({
            name: draftProp.name,
            isPrivate: Boolean(draftProp.isPrivate ?? draftProp.name.startsWith('#')),
            isStatic: Boolean(draftProp.isStatic),
            defaultValue: draftProp.defaultValue ?? null,
            valueType: draftProp.valueType || 'any',
            arrayItemType: draftProp.arrayItemType || null,
            jsdoc: draftProp.jsdoc ? { summary: draftProp.jsdoc, tags: [] } : null,
            status: 'draft-only'
          });
        }
      }

      // Réconciliation des méthodes
      for (const draftMethod of draftCls.methods || []) {
        const existingMethod = targetCls.methods.find((m) => m.name === draftMethod.name);
        if (existingMethod) {
          existingMethod.status = 'synced';
        } else {
          targetCls.methods.push({
            name: draftMethod.name,
            kind: draftMethod.kind || 'method',
            isPrivate: Boolean(draftMethod.isPrivate ?? draftMethod.name.startsWith('#')),
            isStatic: Boolean(draftMethod.isStatic),
            params: (draftMethod.params || []).map((p) =>
              typeof p === 'string' ? { name: p, defaultValue: null } : p
            ),
            jsdoc: draftMethod.jsdoc
              ? { summary: draftMethod.jsdoc, tags: [] }
              : null,
            bodyCode: '// Méthode planifiée (Draft)',
            status: 'draft-only'
          });
        }
      }
    }
  }

  return Array.from(reconciledMap.values());
}
