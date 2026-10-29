/**
 * Port Hexagonal (Interface) pour tout Driver de Langage Orienté Objet (JS, TS, Python, PHP, Java...).
 *
 * Chaque langage implémente ce contrat dans `src/server/drivers/<lang>/` et s'enregistre
 * auprès du `driverRegistry.js`. Le reste du serveur et le client SvelteKit restent
 * 100 % agnostiques du langage analysé.
 */
export class LanguageDriverPort {
  /**
   * @param {object} config
   * @param {string} config.id - Identifiant unique (ex: 'javascript', 'python', 'php', 'java')
   * @param {string} config.label - Nom affiché (ex: 'JavaScript (ES2024)')
   * @param {string[]} config.extensions - Extensions de fichiers (ex: ['.js', '.mjs'])
   * @param {string[]} config.globPatterns - Motifs glob à observer (ex: ['**\/*.js'])
   */
  constructor({ id, label, extensions, globPatterns }) {
    if (new.target === LanguageDriverPort) {
      throw new TypeError('LanguageDriverPort est une classe abstraite (Port Hexagonal).');
    }
    this.id = id;
    this.label = label;
    this.extensions = extensions;
    this.globPatterns = globPatterns;
  }

  /**
   * Analyse statique AST de tous les fichiers du langage présents dans `rootDir`.
   * @param {string} _rootDir
   * @param {string[]} [_ignorePatterns]
   * @returns {Promise<{ classes: Array<object>, errors: Array<{ file: string, message: string, line?: number, column?: number }> }>}
   */
  async parseProject(_rootDir, _ignorePatterns = []) {
    throw new Error(`parseProject() doit être implémenté par le driver "${this.id}".`);
  }

  /**
   * Crée une instance du moteur d'exécution dynamique (Sandbox VM / Subprocess IPC)
   * permettant d'instancier des objets et d'appeler leurs méthodes en temps réel.
   * @param {string} _rootDir
   */
  createSandboxRunner(_rootDir) {
    throw new Error(`createSandboxRunner() doit être implémenté par le driver "${this.id}".`);
  }
}
