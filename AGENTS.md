# SeePOO — Context & Guidelines for AI Agents

## 1. Project Overview & Stack

- **Name**: `seepoo` — Interactive real-time Object-Oriented Programming (OOP) visualizer & execution sandbox.
- **Runtime & Package Manager**: **Bun** (primary dev runtime) & **Node.js >= 18 / npm** (100% compatible via `bunx seepoo` or `npx seepoo`).
- **Frontend (`src/client/`)**: **SvelteKit 2 + Svelte 5 (Runes mode)** compiled via `@sveltejs/adapter-static` into `dist/client/`.
- **Backend Daemon (`src/server/`)**: Pure ESM Node/Bun server (`express` + `socket.io` + `chokidar`) keeping live VM instances (`node:vm`) and file watchers in memory without HMR resets.
- **Internationalization (i18n)**: **Paraglide JS** (`@inlang/paraglide-js`) with `src/client/messages/fr.json` and `src/client/messages/en.json`.
- **Theming**: Native CSS `color-scheme: light dark`, `light-dark()`, `:has(> head > meta[name="color-scheme"])`, and zero-FOUC inline initialization in `src/client/src/app.html`.

---

## 2. Software Architecture (Feature-First + Hexagonal / Ports & Adapters)

All code MUST strictly respect **Feature-First + Hexagonal Architecture**:

```text
seepoo/
├── bin/cli.js                                  # CLI entry point (start / init)
├── src/
│   ├── shared/                                 # Shared contracts (Client <-> Server)
│   │   ├── protocol/events.js                  # WebSocket event names & supported languages
│   │   └── models/umlSchema.js                 # Universal language-agnostic Class/Property/Method models
│   ├── server/
│   │   ├── index.js                            # Express + Socket.IO + Chokidar bootstrapper
│   │   ├── drivers/                            # HEXAGONAL MULTI-LANGUAGE DRIVERS
│   │   │   ├── domain/LanguageDriverPort.js    # Abstract port for any language (JS, TS, Python, Java...)
│   │   │   ├── application/driverRegistry.js   # Central registry of language drivers
│   │   │   ├── javascript/javascriptDriver.js  # Active ES2024 driver (Babel AST + node:vm)
│   │   │   ├── typescript/typescriptDriver.js  # Active TypeScript driver (Babel TS AST + node:vm)
│   │   │   ├── python/pythonDriver.js          # Active Python 3 driver (Python AST + VM transpiler)
│   │   │   └── java/javaDriver.js              # Active Java driver (Java AST + VM transpiler)
│   │   └── features/
│   │       ├── ast-analysis/                   # Static AST extraction & type inference
│   │       ├── draft-sync/                     # .poo-draft.json persistence & reconciliation
│   │       └── vm-sandbox/                     # Dynamic object instantiation & Time-Travel
│   └── client/                                 # Self-contained SvelteKit 2 + Svelte 5 workspace
│       ├── svelte.config.js                    # SvelteKit config (adapter-static -> ../../dist/client)
│       ├── vite.config.js                      # Vite + Paraglide + Socket.IO proxy
│       ├── project.inlang/                     # Inlang project settings
│       ├── messages/                           # Paraglide i18n dictionaries (fr.json, en.json)
│       └── src/
│           ├── routes/                         # SvelteKit shell (+layout.svelte, +page.svelte)
│           └── lib/
│               ├── shared/domain/geometry.js   # Pure 2D geometry & formatting helpers
│               └── features/
│                   ├── class-diagram/          # Tab 1: UML Canvas, orthogonal edges, Post-it notes
│                   ├── object-playground/      # Tab 2: Live object heap, pointer arrows, Time-Travel
│                   ├── realtime/               # Socket.IO client store
│                   ├── i18n/                   # Paraglide reactive locale switcher (FR/EN)
│                   └── theme/                  # Light/Dark theme store & toggle
```

### Key Architectural Rules for Agents
1. **Svelte 5 Runes Only**: Always use `$state`, `$derived`, `$derived.by`, `$effect`, and `$props()` in `.svelte` files. Never use legacy Svelte 4 syntax (`export let`, `$:`, `on:click`).
2. **Every User-Facing String Must Be Localized**: Add keys in both `src/client/messages/fr.json` and `src/client/messages/en.json`, then run `bun run i18n:compile` (or `npm run i18n:compile`).
3. **Multi-Language Extensibility**: Never hardcode language-specific parsing inside `analyzeProjectUseCase.js` or `src/server/index.js`. Always go through `LanguageDriverPort` and `driverRegistry.js` (see `.agents/skills/seepoo-language-driver/SKILL.md`).
4. **Browser Support Policy**: Assume Baseline Widely Available + modern CSS (`color-scheme: light dark`, `light-dark()`, `:has()`). Always maintain `@supports (color: light-dark(white, black))` fallbacks in `src/client/src/app.css`.

---

## 3. Available Svelte MCP Tools (`@sveltejs/mcp`)

You are able to use the Svelte MCP server (`.vscode/mcp.json` / `.gemini/settings.json`), where you have access to comprehensive Svelte 5 and SvelteKit documentation and static analysis:

### 1. `list-sections`
Use this FIRST to discover all available documentation sections. Returns a structured list with titles, `use_cases`, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. `get-documentation`
Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling `list-sections`, analyze the returned sections and fetch all relevant documentation sections for the task.

### 3. `svelte-autofixer`
Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool (or `npx @sveltejs/mcp svelte-autofixer <file>`) whenever writing or editing Svelte code before finalizing changes.

### 4. `playground-link`
Generates a Svelte Playground link with the provided code. Only call this tool after user confirmation and NEVER if code was written to files in the project.

---

## 4. Essential Commands (Bun & NPM)

- **Install dependencies**: `bun install` (or `npm install`)
- **Start full dev mode (Server + SvelteKit HMR)**: `bun run dev` (or `npm run dev`)
- **Build client & launch production CLI on example project**: `bun start` (or `npm start`)
- **Compile i18n dictionaries**: `bun run i18n:compile` (or `npm run i18n:compile`)
- **Build SvelteKit static bundle (`dist/client`)**: `bun run build:client` (or `npm run build:client`)
- **Run AST & Driver smoke test**: `bun run test:ast` (or `npm run test:ast`)
