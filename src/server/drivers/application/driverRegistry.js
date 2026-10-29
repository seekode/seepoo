import { JavaScriptLanguageDriver } from '../javascript/javascriptDriver.js';
import { TypeScriptLanguageDriver } from '../typescript/typescriptDriver.js';
import { PythonLanguageDriver } from '../python/pythonDriver.js';
import { JavaLanguageDriver } from '../java/javaDriver.js';

/**
 * Registre central des Drivers de Langages (Architecture Hexagonale).
 * Langages actifs : JavaScript, TypeScript, Python, Java (+ mode 'auto' polyglotte).
 */
const driversMap = new Map();

export function registerLanguageDriver(driver) {
  driversMap.set(driver.id, driver);
}

export function getLanguageDriver(languageId = 'javascript') {
  const driver = driversMap.get(languageId);
  if (!driver) {
    throw new Error(
      `Driver de langage "${languageId}" non enregistré. Drivers disponibles : ${Array.from(driversMap.keys()).join(', ')}`
    );
  }
  return driver;
}

export function getAllLanguageDrivers() {
  return Array.from(driversMap.values());
}

export function getAllWatchedGlobPatterns() {
  const patterns = new Set();
  for (const driver of driversMap.values()) {
    for (const p of driver.globPatterns) {
      patterns.add(p);
    }
  }
  return Array.from(patterns);
}

export function listLanguageDrivers() {
  return Array.from(driversMap.values()).map((d) => ({
    id: d.id,
    label: d.label,
    extensions: d.extensions,
    globPatterns: d.globPatterns
  }));
}

// Enregistrement des 4 drivers officiels
registerLanguageDriver(new JavaScriptLanguageDriver());
registerLanguageDriver(new TypeScriptLanguageDriver());
registerLanguageDriver(new PythonLanguageDriver());
registerLanguageDriver(new JavaLanguageDriver());
