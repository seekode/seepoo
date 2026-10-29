import { glob } from 'glob';
import { LanguageDriverPort } from '../domain/LanguageDriverPort.js';
import { parseFileAST } from '../../features/ast-analysis/infrastructure/babelAstParser.js';
import { SandboxRuntime } from '../../features/vm-sandbox/application/sandboxRuntime.js';

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/.svelte-kit/**',
  '**/old/**'
];

/**
 * Driver Hexagonal pour JavaScript (ES2024) :
 * - Analyse AST statique via `@babel/parser` + inférence de types + JSDoc
 * - Exécution dynamique & introspection des champs privés `#` via `node:vm`
 */
export class JavaScriptLanguageDriver extends LanguageDriverPort {
  constructor() {
    super({
      id: 'javascript',
      label: 'JavaScript (ES2024)',
      extensions: ['.js', '.mjs'],
      globPatterns: ['**/*.js']
    });
  }

  async parseProject(rootDir, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
    const jsFiles = await glob(this.globPatterns, {
      cwd: rootDir,
      ignore: ignorePatterns,
      absolute: true
    });

    const allAstClasses = [];
    const syntaxErrors = [];

    for (const file of jsFiles) {
      const { classes, error } = await parseFileAST(file, rootDir);
      if (error) {
        syntaxErrors.push(error);
      } else {
        allAstClasses.push(
          ...classes.map((cls) => ({
            ...cls,
            language: this.id
          }))
        );
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
