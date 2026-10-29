/**
 * Contrat partagé Client <-> Serveur : Événements WebSocket & Langages supportés
 */

export const WS_EVENTS = Object.freeze({
  ARCHITECTURE_UPDATED: 'architecture:updated',
  VM_STATE: 'vm:state',
  DRAFT_SAVE: 'draft:save',
  LANGUAGE_SELECT: 'language:select',
  VM_INSTANTIATE: 'vm:instantiate',
  VM_EXECUTE: 'vm:execute',
  VM_TIMETRAVEL: 'vm:timetravel',
  VM_RESET: 'vm:reset'
});

export const SUPPORTED_LANGUAGES = Object.freeze({
  auto: {
    id: 'auto',
    label: 'Auto (Tous)',
    shortLabel: 'AUTO',
    extensions: ['.js', '.mjs', '.ts', '.py', '.java'],
    primitiveTypes: ['string', 'number', 'boolean', 'Array', 'Object', 'HTML', 'any'],
    status: 'active'
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    shortLabel: 'JS',
    extensions: ['.js', '.mjs'],
    primitiveTypes: ['string', 'number', 'boolean', 'Array', 'Object', 'HTML', 'any'],
    status: 'active'
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    shortLabel: 'TS',
    extensions: ['.ts'],
    primitiveTypes: ['string', 'number', 'boolean', 'Array', 'Object', 'HTML', 'any'],
    status: 'active'
  },
  python: {
    id: 'python',
    label: 'Python',
    shortLabel: 'PY',
    extensions: ['.py'],
    primitiveTypes: ['string', 'number', 'boolean', 'Array', 'Object', 'any'],
    status: 'active'
  },
  java: {
    id: 'java',
    label: 'Java',
    shortLabel: 'JAVA',
    extensions: ['.java'],
    primitiveTypes: ['string', 'number', 'boolean', 'Array', 'Object', 'any'],
    status: 'active'
  }
});
