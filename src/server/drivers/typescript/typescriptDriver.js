import { glob } from 'glob';
import { LanguageDriverPort } from '../domain/LanguageDriverPort.js';
import { DEFAULT_IGNORE_PATTERNS } from '../javascript/javascriptDriver.js';
import { parseTypeScriptFileAST } from './typescriptAstParser.js';
import { SandboxRuntime } from '../../features/vm-sandbox/application/sandboxRuntime.js';

/**
 * Driver Hexagonal pour TypeScript :
 * - Analyse AST statique avec annotations de types TS (`: string`, `: Compte[]`, `private`, `public`)
 * - Exécution dynamique dans `node:vm` après effacement des types TS et instrumentation des champs privés
 */
export class TypeScriptLanguageDriver extends LanguageDriverPort {
  constructor() {
    super({
      id: 'typescript',
      label: 'TypeScript',
      extensions: ['.ts'],
      globPatterns: ['**/*.ts']
    });
  }

  async parseProject(rootDir, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
    const tsFiles = await glob(this.globPatterns, {
      cwd: rootDir,
      ignore: [...ignorePatterns, '**/*.d.ts'],
      absolute: true
    });

    const allAstClasses = [];
    const syntaxErrors = [];

    for (const file of tsFiles) {
      const { classes, error } = await parseTypeScriptFileAST(file, rootDir);
      if (error) {
        syntaxErrors.push(error);
      } else {
        allAstClasses.push(...classes);
      }
    }

    return {
      classes: allAstClasses,
      errors: syntaxErrors
    };
  }

  createSandboxRunner(rootDir) {
    return new SandboxRuntime(rootDir);
  }
}
