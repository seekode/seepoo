export { parseFileAST } from './features/ast-analysis/infrastructure/babelAstParser.js';
export { analyzeProject } from './features/ast-analysis/application/analyzeProjectUseCase.js';
export { loadDraftFile, saveDraftPatch } from './features/draft-sync/infrastructure/draftRepository.js';
export { reconcileAstWithDraft } from './features/draft-sync/domain/draftReconciler.js';
