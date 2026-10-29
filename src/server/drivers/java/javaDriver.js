import { glob } from 'glob';
import { LanguageDriverPort } from '../domain/LanguageDriverPort.js';
import { DEFAULT_IGNORE_PATTERNS } from '../javascript/javascriptDriver.js';
import { parseJavaFileAST } from './javaAstParser.js';
import { SandboxRuntime } from '../../features/vm-sandbox/application/sandboxRuntime.js';

/**
 * Driver Hexagonal pour Java :
 * - Analyse AST statique des classes Java (`.java`), héritage `extends`, Javadoc, visibilité `private`/`public` et types génériques (`List<Compte>`)
 * - Exécution dynamique dans le bac à sable d'objets
 */
export class JavaLanguageDriver extends LanguageDriverPort {
  constructor() {
    super({
      id: 'java',
      label: 'Java',
      extensions: ['.java'],
      globPatterns: ['**/*.java']
    });
  }

  async parseProject(rootDir, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
    const javaFiles = await glob(this.globPatterns, {
      cwd: rootDir,
      ignore: [...ignorePatterns, '**/target/**', '**/build/**'],
      absolute: true
    });

    const allAstClasses = [];
    const syntaxErrors = [];

    for (const file of javaFiles) {
      try {
        const { classes, error } = await parseJavaFileAST(file, rootDir);
        if (error) {
          syntaxErrors.push(error);
        } else {
          allAstClasses.push(...classes);
        }
      } catch (err) {
        syntaxErrors.push({
          file,
          message: err.message
        });
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
