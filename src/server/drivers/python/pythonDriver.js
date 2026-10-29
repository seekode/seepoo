import { glob } from 'glob';
import { LanguageDriverPort } from '../domain/LanguageDriverPort.js';
import { DEFAULT_IGNORE_PATTERNS } from '../javascript/javascriptDriver.js';
import { parsePythonFileAST } from './pythonAstParser.js';
import { SandboxRuntime } from '../../features/vm-sandbox/application/sandboxRuntime.js';

/**
 * Driver Hexagonal pour Python 3 :
 * - Analyse AST statique des classes Python (`.py`), héritage, docstrings, annotations de types (`list[Compte]`, `float`, `str`) et attributs `self.`
 * - Exécution dynamique dans le bac à sable d'objets
 */
export class PythonLanguageDriver extends LanguageDriverPort {
  constructor() {
    super({
      id: 'python',
      label: 'Python 3',
      extensions: ['.py'],
      globPatterns: ['**/*.py']
    });
  }

  async parseProject(rootDir, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
    const pyFiles = await glob(this.globPatterns, {
      cwd: rootDir,
      ignore: [...ignorePatterns, '**/__pycache__/**', '**/.venv/**', '**/venv/**'],
      absolute: true
    });

    const allAstClasses = [];
    const syntaxErrors = [];

    for (const file of pyFiles) {
      try {
        const { classes, error } = await parsePythonFileAST(file, rootDir);
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
