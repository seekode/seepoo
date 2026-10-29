---
name: seepoo-language-driver
description: >-
  Step-by-step guide for adding a new programming language driver (e.g., Python, PHP, Java, C#, TypeScript)
  to SeePOO's Hexagonal Architecture. Activate this skill whenever the user asks to support a new language
  for AST class diagram parsing or dynamic object execution.
---

# Adding a New Language Driver to SeePOO

SeePOO uses **Feature-First + Hexagonal Architecture (Ports & Adapters)** so that the UI (`src/client/`) and server orchestration (`src/server/features/`) remain 100% independent of the analyzed programming language.

## Step 1. Implement `LanguageDriverPort`

Create a new directory `src/server/drivers/<lang>/` and implement a class extending [`LanguageDriverPort`](../../../src/server/drivers/domain/LanguageDriverPort.js):

```javascript
import { LanguageDriverPort } from '../domain/LanguageDriverPort.js';
import { createClassModel } from '../../../shared/models/umlSchema.js';

export class PythonLanguageDriver extends LanguageDriverPort {
  constructor() {
    super({
      id: 'python',
      label: 'Python 3',
      extensions: ['.py'],
      globPatterns: ['**/*.py']
    });
  }

  async parseProject(rootDir, ignorePatterns = []) {
    // 1. Scan files matching this.globPatterns
    // 2. Parse AST (via web-tree-sitter or language parser)
    // 3. Map classes to createClassModel({ name, language: 'python', properties, methods, ... })
    return { classes: [], errors: [] };
  }

  createSandboxRunner(rootDir) {
    // Return a runner implementing:
    // - async reloadClasses(classes)
    // - instantiate(className, label, args, position)
    // - executeMethod(instanceId, methodName, args)
    // - reset()
    // - history / historyIndex
  }
}
```

## Step 2. Register the Driver

Register the new driver in [`src/server/drivers/application/driverRegistry.js`](../../../src/server/drivers/application/driverRegistry.js):

```javascript
import { PythonLanguageDriver } from '../python/pythonDriver.js';
registerLanguageDriver(new PythonLanguageDriver());
```

And update the `status` of the language to `'active'` in [`src/shared/protocol/events.js`](../../../src/shared/protocol/events.js).

## Step 3. Verify

Run the AST smoke test with the new language flag:

```bash
bun ./bin/cli.js start --dir ./examples/tp-python --lang python --no-open
```
