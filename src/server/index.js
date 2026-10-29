import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import chokidar from 'chokidar';
import chalk from 'chalk';
import { WS_EVENTS } from '../shared/protocol/events.js';
import { getAllWatchedGlobPatterns } from './drivers/application/driverRegistry.js';
import { DEFAULT_IGNORE_PATTERNS } from './drivers/javascript/javascriptDriver.js';
import { analyzeProject } from './features/ast-analysis/application/analyzeProjectUseCase.js';
import { saveDraftPatch } from './features/draft-sync/infrastructure/draftRepository.js';
import { SandboxRuntime } from './features/vm-sandbox/application/sandboxRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer({ targetDir, port = 4242, language = 'auto' }) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' }
  });

  let activeLanguage = language || 'auto';
  const sandbox = new SandboxRuntime(targetDir);
  let currentArchitecture = await analyzeProject(targetDir, activeLanguage);
  await sandbox.reloadClasses(currentArchitecture.classes);

  // Ignorer l'écho Chokidar immédiat quand c'est le serveur lui-même qui sauvegarde .poo-draft.json
  let ignoreNextDraftWatchUntil = 0;

  // Servir le build statique SvelteKit (dist/client)
  const clientDistPath = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDistPath));

  // Fallback SPA SvelteKit
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    const indexHtml = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
    } else {
      res.status(404).send('Client build non trouvé. Exécutez `bun run build:client` ou `npm run build:client`.');
    }
  });

  // Surveillance temps réel des fichiers (JS, TS, Python, Java) et du .poo-draft.json avec Chokidar
  const watchedPatterns = [...getAllWatchedGlobPatterns(), '.poo-draft.json'];
  const watcher = chokidar.watch(watchedPatterns, {
    cwd: targetDir,
    ignored: DEFAULT_IGNORE_PATTERNS,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  });

  watcher.on('all', async (event, filePath) => {
    if (
      filePath.endsWith('.poo-draft.json') &&
      Date.now() < ignoreNextDraftWatchUntil
    ) {
      return;
    }
    console.log(chalk.blue(`🔄 [${event}] Détecté sur ${filePath} -> Recalcul AST & VM...`));
    currentArchitecture = await analyzeProject(targetDir, activeLanguage);
    await sandbox.reloadClasses(currentArchitecture.classes);
    io.emit(WS_EVENTS.ARCHITECTURE_UPDATED, currentArchitecture);
  });

  // Gestion des événements WebSocket temps réel
  io.on('connection', (socket) => {
    // 1. Envoi de l'état initial dès la connexion du client SvelteKit
    socket.emit(WS_EVENTS.ARCHITECTURE_UPDATED, currentArchitecture);
    if (sandbox.historyIndex >= 0) {
      socket.emit(WS_EVENTS.VM_STATE, {
        currentStep: sandbox.historyIndex,
        totalSteps: sandbox.history.length,
        snapshot: sandbox.history[sandbox.historyIndex]
      });
    }

    // 2. Changement de filtre de langage (auto, javascript, typescript, python, java)
    socket.on(WS_EVENTS.LANGUAGE_SELECT, async ({ language: nextLang }, ack) => {
      try {
        activeLanguage = nextLang || 'auto';
        currentArchitecture = await analyzeProject(targetDir, activeLanguage);
        await sandbox.reloadClasses(currentArchitecture.classes);
        io.emit(WS_EVENTS.ARCHITECTURE_UPDATED, currentArchitecture);
        ack?.({ ok: true, data: currentArchitecture });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // 3. Sauvegarde d'un ajout/suppression virtuel ou de la position des cartes (Mode Draft -> .poo-draft.json)
    socket.on(WS_EVENTS.DRAFT_SAVE, async (draftPatch, ack) => {
      try {
        ignoreNextDraftWatchUntil = Date.now() + 500;
        await saveDraftPatch(targetDir, draftPatch);
        currentArchitecture = await analyzeProject(targetDir, activeLanguage);
        io.emit(WS_EVENTS.ARCHITECTURE_UPDATED, currentArchitecture);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // 4. Instanciation dynamique d'un objet (Drag & Drop dans l'onglet Objets)
    socket.on(WS_EVENTS.VM_INSTANTIATE, ({ className, label, args, position }, ack) => {
      try {
        const result = sandbox.instantiate(className, label, args, position);
        io.emit(WS_EVENTS.VM_STATE, result);
        ack?.({ ok: true, data: result });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // 5. Exécution réelle d'une méthode sur l'instance en mémoire
    socket.on(WS_EVENTS.VM_EXECUTE, ({ instanceId, methodName, args }, ack) => {
      try {
        const statePayload = sandbox.executeMethod(instanceId, methodName, args);
        io.emit(WS_EVENTS.VM_STATE, statePayload);
        ack?.({ ok: true, data: statePayload });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // 6. Navigation dans l'historique Time-Travel (Précédent / Suivant)
    socket.on(WS_EVENTS.VM_TIMETRAVEL, ({ targetStep }, ack) => {
      if (targetStep >= 0 && targetStep < sandbox.history.length) {
        sandbox.historyIndex = targetStep;
        const payload = {
          currentStep: sandbox.historyIndex,
          totalSteps: sandbox.history.length,
          snapshot: sandbox.history[sandbox.historyIndex],
          previousSnapshot:
            sandbox.historyIndex > 0 ? sandbox.history[sandbox.historyIndex - 1] : null
        };
        io.emit(WS_EVENTS.VM_STATE, payload);
        ack?.({ ok: true, data: payload });
      } else {
        ack?.({ ok: false, error: 'Étape Time-Travel hors limites.' });
      }
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => resolve({ httpServer, io }));
  });
}
