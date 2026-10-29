import {
  getLanguageDriver,
  getAllLanguageDrivers,
  listLanguageDrivers
} from '../../../drivers/application/driverRegistry.js';
import { loadDraftFile } from '../../draft-sync/infrastructure/draftRepository.js';
import { reconcileAstWithDraft } from '../../draft-sync/domain/draftReconciler.js';

/**
 * Use Case (Architecture Hexagonale) :
 * Scanne l'ensemble du projet de l'apprenant via le(s) `LanguageDriver`(s) actif(s)
 * (`'auto'`, `'javascript'`, `'typescript'`, `'python'`, `'java'`)
 * et retourne l'état unifié (AST + Draft `.poo-draft.json`).
 */
export async function analyzeProject(rootDir, languageId = 'auto') {
  const driversToRun =
    !languageId || languageId === 'auto'
      ? getAllLanguageDrivers()
      : [getLanguageDriver(languageId)];

  const allAstClasses = [];
  const syntaxErrors = [];

  for (const driver of driversToRun) {
    const { classes, errors } = await driver.parseProject(rootDir);
    allAstClasses.push(...classes);
    syntaxErrors.push(...errors);
  }

  const draftData = await loadDraftFile(rootDir);
  const unifiedClasses = reconcileAstWithDraft(allAstClasses, draftData, languageId);

  return {
    timestamp: new Date().toISOString(),
    language: languageId || 'auto',
    availableLanguages: listLanguageDrivers(),
    classes: unifiedClasses,
    draft: draftData,
    errors: syntaxErrors
  };
}
