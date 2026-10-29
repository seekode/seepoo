#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import open from 'open';
import { startServer } from '../src/server/index.js';

const program = new Command();

program
  .name('seepoo')
  .description('Visualiseur et bac à sable Orienté Objet temps réel multi-langage (AST + SvelteKit 5 + VM)')
  .version('1.0.0');

program
  .command('init')
  .description('Initialise un fichier de conception .poo-draft.json dans le projet courant')
  .action(async () => {
    const draftPath = path.resolve(process.cwd(), '.poo-draft.json');
    try {
      await fs.access(draftPath);
      console.log(chalk.yellow('⚠️  Un fichier .poo-draft.json existe déjà dans ce dossier.'));
    } catch {
      const initialDraft = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        classes: []
      };
      await fs.writeFile(draftPath, JSON.stringify(initialDraft, null, 2), 'utf-8');
      console.log(chalk.green('✅ Fichier .poo-draft.json initialisé avec succès !'));
    }
  });

program
  .command('start')
  .description("Lance le serveur d'analyse AST, la sandbox VM et l'interface web locale")
  .option('-p, --port <number>', 'Port du serveur local', '4242')
  .option('-d, --dir <path>', 'Dossier racine du code à observer', '.')
  .option('-l, --lang <id>', 'Driver de langage (auto, javascript, typescript, python, java)', 'auto')
  .option('--no-open', 'Ne pas ouvrir automatiquement le navigateur')
  .action(async (options) => {
    const targetDir = path.resolve(process.cwd(), options.dir);
    const port = Number.parseInt(options.port, 10);

    console.log(chalk.cyan.bold('\n🚀 Démarrage de SeePOO (seepoo)...'));
    console.log(chalk.gray(`📂 Dossier observé : ${targetDir}`));
    console.log(chalk.gray(`🔤 Driver actif    : ${options.lang}`));

    await startServer({ targetDir, port, language: options.lang });

    const url = `http://localhost:${port}`;
    console.log(chalk.green.bold(`\n✨ Interface prête sur ${url}\n`));

    if (options.open) {
      await open(url);
    }
  });

program.parse(process.argv);
