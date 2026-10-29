import vm from 'node:vm';
import fs from 'node:fs/promises';
import { glob } from 'glob';
import { sortClassUnitsTopologically } from '../domain/topologySorter.js';
import { serializeValue, extractEdgesFromProperty } from '../domain/valueSerializer.js';
import { createDomElementStub, createBrowserGlobals } from '../infrastructure/browserDomStub.js';
import { extractExecutableUnits } from '../infrastructure/astInstrumenter.js';
import { extractTypeScriptExecutableUnits } from '../../../drivers/typescript/typescriptInstrumenter.js';
import { buildPythonExecutableClassUnit } from '../../../drivers/python/pythonInstrumenter.js';
import { buildJavaExecutableClassUnit } from '../../../drivers/java/javaInstrumenter.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/.svelte-kit/**',
  '**/old/**',
  '**/*.d.ts'
];

/**
 * Bac à sable d'exécution dynamique Polyglotte (JavaScript, TypeScript, Python, Java).
 * Permet d'instancier des objets, d'exécuter leurs méthodes en mémoire,
 * d'inspecter les champs privés (`#`, `private`, `_`/`__`) sans briser l'encapsulation,
 * de détecter les pointeurs/références inter-objets et de gérer le Time-Travel.
 */
export class SandboxRuntime {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.context = null;
    this.instances = new Map();
    this.instanceToId = new WeakMap();
    this.history = [];
    this.historyIndex = -1;
  }

  /**
   * Recharge les classes (JS, TS, Python, Java) de l'apprenant dans un contexte `node:vm` isolé
   */
  async reloadClasses(astClasses) {
    const browserGlobals = createBrowserGlobals();
    const sandboxGlobal = {
      console: {
        log: (...args) => this.lastLogs?.push(args.map(String).join(' ')),
        warn: (...args) => this.lastLogs?.push(args.map(String).join(' ')),
        error: (...args) => this.lastLogs?.push(args.map(String).join(' ')),
        info: (...args) => this.lastLogs?.push(args.map(String).join(' '))
      },
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      JSON,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      RegExp,
      Error,
      TypeError,
      RangeError,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...browserGlobals,
      __classes__: {}
    };
    sandboxGlobal.window = sandboxGlobal;
    sandboxGlobal.globalThis = sandboxGlobal;

    this.context = vm.createContext(sandboxGlobal);

    // Shims non-énumérables sur le prototype des littéraux tableaux [] dans le contexte VM
    // pour supporter les collections Python (`.append()`) et Java (`List.add()`, `.size()`, `.get()`, `.isEmpty()`)
    vm.runInContext(
      `
      (function() {
        const protos = [Array.prototype, Object.getPrototypeOf([])];
        for (const p of protos) {
          if (!p) continue;
          if (!p.append) {
            Object.defineProperty(p, 'append', {
              value: function(item) { this.push(item); },
              enumerable: false,
              writable: true,
              configurable: true
            });
          }
          if (!p.add) {
            Object.defineProperty(p, 'add', {
              value: function(item) { this.push(item); return true; },
              enumerable: false,
              writable: true,
              configurable: true
            });
          }
          if (!p.size) {
            Object.defineProperty(p, 'size', {
              value: function() { return this.length; },
              enumerable: false,
              writable: true,
              configurable: true
            });
          }
          if (!p.get) {
            Object.defineProperty(p, 'get', {
              value: function(idx) { return this[idx]; },
              enumerable: false,
              writable: true,
              configurable: true
            });
          }
          if (!p.isEmpty) {
            Object.defineProperty(p, 'isEmpty', {
              value: function() { return this.length === 0; },
              enumerable: false,
              writable: true,
              configurable: true
            });
          }
        }
      })();
      `,
      this.context
    );

    this.astClasses = astClasses.filter((c) => c.status !== 'draft-only');

    const allClassUnits = [];
    const allHelperUnits = [];

    // 1. Fichiers JavaScript (.js)
    const jsFiles = await glob('**/*.js', {
      cwd: this.rootDir,
      ignore: IGNORE_PATTERNS,
      absolute: true
    });
    for (const file of jsFiles) {
      try {
        const raw = await fs.readFile(file, 'utf-8');
        const { classUnits, helperUnits } = extractExecutableUnits(raw, this.astClasses, file);
        allClassUnits.push(...classUnits);
        allHelperUnits.push(...helperUnits);
      } catch {
        // Ignore
      }
    }

    // 2. Fichiers TypeScript (.ts)
    const tsFiles = await glob('**/*.ts', {
      cwd: this.rootDir,
      ignore: IGNORE_PATTERNS,
      absolute: true
    });
    for (const file of tsFiles) {
      try {
        const raw = await fs.readFile(file, 'utf-8');
        const { classUnits, helperUnits } = extractTypeScriptExecutableUnits(
          raw,
          this.astClasses,
          file
        );
        allClassUnits.push(...classUnits);
        allHelperUnits.push(...helperUnits);
      } catch {
        // Ignore
      }
    }

    // 3. Classes Python (.py) et Java (.java) déjà analysées dans `this.astClasses`
    for (const cls of this.astClasses) {
      if (cls.language === 'python') {
        allClassUnits.push(buildPythonExecutableClassUnit(cls));
      } else if (cls.language === 'java') {
        allClassUnits.push(buildJavaExecutableClassUnit(cls));
      }
    }

    // Exécuter les helpers globaux
    for (const helper of allHelperUnits) {
      try {
        vm.runInContext(helper.code, this.context, { filename: helper.file, timeout: 1000 });
      } catch {
        // Ignore
      }
    }

    // Exécuter toutes les classes dans l'ordre topologique d'héritage (parent -> enfant)
    const sortedClassUnits = sortClassUnitsTopologically(allClassUnits);
    for (const unit of sortedClassUnits) {
      try {
        vm.runInContext(unit.code, this.context, { filename: unit.file, timeout: 1000 });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Résout un argument passé depuis l'UI :
   * Si l'argument est `"@ref:obj_2"`, on passe la vraie référence mémoire de l'instance `obj_2` !
   */
  resolveArgument(arg) {
    if (arg === '' || arg === undefined) return undefined;
    if (typeof arg === 'string' && arg.startsWith('@ref:')) {
      const targetId = arg.slice(5);
      const target = this.instances.get(targetId);
      if (!target) throw new Error(`Instance référencée introuvable : ${targetId}`);
      return target.ref;
    }
    if (typeof arg === 'string') {
      try {
        return JSON.parse(arg);
      } catch {
        return arg;
      }
    }
    return arg;
  }

  /**
   * Instancie un nouvel objet dans la VM (appelé lors du Drag & Drop dans l'onglet Objets)
   */
  instantiate(className, label, rawArgs = [], position = { x: 100, y: 100 }) {
    const Ctor = this.context?.__classes__?.[className];
    if (!Ctor) {
      throw new Error(`La classe "${className}" n'est pas encore implémentée dans le code.`);
    }

    const resolvedArgs = rawArgs.map((a) => this.resolveArgument(a));
    let instanceRef;
    try {
      instanceRef = new Ctor(...resolvedArgs);
    } catch (err) {
      if (err instanceof TypeError || err?.name === 'TypeError') {
        const clsMeta = this.astClasses?.find((c) => c.name === className);
        const ctorMeta = clsMeta?.methods?.find((m) => m.kind === 'constructor');
        const paramCount = Math.max(resolvedArgs.length, ctorMeta?.params?.length || 1);
        const domFallbackArgs = Array.from({ length: paramCount }, (_, i) =>
          resolvedArgs[i] === undefined ? createDomElementStub('div') : resolvedArgs[i]
        );
        instanceRef = new Ctor(...domFallbackArgs);
      } else {
        throw err;
      }
    }
    const id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    this.instances.set(id, {
      id,
      label: label || `${className.toLowerCase()}#${this.instances.size + 1}`,
      className,
      ref: instanceRef,
      position
    });
    this.instanceToId.set(instanceRef, id);

    const statePayload = this.recordSnapshot(`Instanciation de ${label || className}`);
    return { instanceId: id, ...statePayload };
  }

  /**
   * Réinitialise toutes les instances et l'historique de la VM
   */
  reset() {
    this.instances.clear();
    this.instanceToId = new WeakMap();
    this.history = [];
    this.historyIndex = -1;
    return {
      currentStep: -1,
      totalSteps: 0,
      snapshot: null
    };
  }

  /**
   * Exécute réellement une méthode sur l'instance en mémoire et capture l'état Avant/Après
   */
  executeMethod(instanceId, methodName, rawArgs = []) {
    const entry = this.instances.get(instanceId);
    if (!entry) throw new Error(`Instance ${instanceId} introuvable en mémoire.`);

    const clsMeta = this.astClasses.find((c) => c.name === entry.className);
    const methodMeta = clsMeta?.methods?.find((m) => m.name === methodName);

    if (methodName.startsWith('#') || methodMeta?.isPrivate) {
      throw new Error(
        `Violation d'encapsulation : impossible d'appeler la méthode privée ${methodName} depuis l'extérieur.`
      );
    }

    const fn = entry.ref[methodName];
    if (typeof fn !== 'function') {
      throw new Error(`La méthode "${methodName}" n'existe pas sur l'instance ${entry.label}.`);
    }

    this.lastLogs = [];
    const resolvedArgs = rawArgs.map((a) => this.resolveArgument(a));
    const returnValue = fn.apply(entry.ref, resolvedArgs);

    const snapshot = this.recordSnapshot(
      `${entry.label}.${methodName}(${rawArgs.join(', ')})`,
      {
        instanceId,
        methodName,
        returnValue: serializeValue(returnValue, this.instanceToId, this.instances),
        logs: [...this.lastLogs]
      }
    );

    return snapshot;
  }

  /**
   * Génère la photographie complète du graphe mémoire (Noeuds d'instances + Arêtes de pointeurs)
   */
  captureGraphState() {
    const nodesData = [];
    const edgesData = [];

    for (const [id, entry] of this.instances.entries()) {
      const clsMeta = this.astClasses.find((c) => c.name === entry.className);
      const properties = [];
      const seenNames = new Set();

      // 1. Propriétés énumérables sur l'instance (publiques ou privées TS/Python/Java)
      for (const [key, val] of Object.entries(entry.ref)) {
        const serialized = serializeValue(val, this.instanceToId, this.instances);
        const propMeta = clsMeta?.properties?.find(
          (p) => p.name === key || p.name === `#${key}`
        );
        const isPrivate = Boolean(propMeta?.isPrivate || key.startsWith('_'));

        seenNames.add(key);
        properties.push({
          name: key,
          isPrivate,
          value: serialized
        });
        extractEdgesFromProperty(id, key, serialized, edgesData);
      }

      // 2. Propriétés privées `#` ES2024 récupérées via l'inspecteur injecté dans l'AST
      if (typeof entry.ref.__seepooGetPrivateState__ === 'function') {
        const privState = entry.ref.__seepooGetPrivateState__();
        for (const [privKey, privVal] of Object.entries(privState)) {
          if (seenNames.has(privKey)) continue;
          const serialized = serializeValue(privVal, this.instanceToId, this.instances);
          properties.push({
            name: privKey,
            isPrivate: true,
            value: serialized
          });
          extractEdgesFromProperty(id, privKey, serialized, edgesData);
        }
      }

      nodesData.push({
        id,
        label: entry.label,
        className: entry.className,
        language: clsMeta?.language || 'javascript',
        position: entry.position,
        properties,
        methods: (clsMeta?.methods || []).filter((m) => m.kind !== 'constructor')
      });
    }

    return { nodesData, edgesData };
  }

  /**
   * Enregistre un snapshot horodaté dans l'historique Time-Travel
   */
  recordSnapshot(actionLabel, executionDetails = null) {
    const graph = this.captureGraphState();
    const snapshot = {
      step: this.history.length,
      timestamp: new Date().toLocaleTimeString('fr-FR'),
      actionLabel,
      executionDetails,
      graph: structuredClone(graph)
    };

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;

    return {
      currentStep: this.historyIndex,
      totalSteps: this.history.length,
      snapshot,
      previousSnapshot: this.historyIndex > 0 ? this.history[this.historyIndex - 1] : null
    };
  }
}
