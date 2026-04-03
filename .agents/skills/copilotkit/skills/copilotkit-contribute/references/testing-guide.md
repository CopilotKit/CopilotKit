# Testing Guide

## Test Framework

CopilotKit uses **Vitest** for all unit and integration tests across both V1 and V2 packages.

## Running Tests

### All packages

```bash
# Run all tests
pnpm run test

# V2 packages only
pnpm test:next

# V1 packages only
pnpm test:classic

# Watch mode (all)
pnpm run test:watch

# Watch mode (v2 only)
pnpm test:watch:next
```

### Single package

```bash
# V2 packages use @copilotkit/ namespace
nx run @copilotkit/core:test
nx run @copilotkit/runtime:test
nx run @copilotkit/react:test
nx run @copilotkit/agent:test
nx run @copilotkit/shared:test
nx run @copilotkit/angular:test
nx run @copilotkit/web-inspector:test
nx run @copilotkit/demo-agents:test
nx run @copilotkit/sqlite-runner:test

# V1 packages use @copilotkit/ namespace
nx run @copilotkit/react-core:test
nx run @copilotkit/runtime:test
nx run @copilotkit/react-ui:test
nx run @copilotkit/sdk-js:test
nx run @copilotkit/shared:test
nx run @copilotkit/react-textarea:test
nx run @copilotkit/runtime-client-gql:test
nx run @copilotkit/a2ui-renderer:test
```

## Coverage

```bash
# All packages with coverage
pnpm run test:coverage

# V2 only
pnpm test:coverage:next

# V1 only
pnpm test:coverage:classic
```

Coverage reports are generated to `{package}/coverage/` in three formats: `text` (console), `lcov`, and `html`.

Coverage configuration (from vitest.config):

```js
coverage: {
  reporter: ["text", "lcov", "html"],
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.d.ts", "src/**/index.ts", "src/**/__tests__/**"],
}
```

## Vitest Configuration

Each package has its own `vitest.config.mjs` (or `.mts`/`.ts`). Common settings across packages:

### V2 Core / Runtime / Shared / SQLite-Runner

```js
// vitest.config.mjs
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.{test,spec}.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});
```

### V2 React (requires jsdom for React hooks)

```js
// vitest.config.mjs
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globalSetup: ["./src/__tests__/globalSetup.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
  },
});
```

### V2 Runtime (disables telemetry during tests)

```js
test: {
  env: {
    COPILOTKIT_TELEMETRY_DISABLED: "true",
  },
  // ...
}
```

## Test File Locations and Naming

Tests are colocated with source code in `__tests__/` directories:

```
packages/v2/core/src/
  __tests__/
    core-simple.test.ts
    core-tool-simple.test.ts
    core-edge-cases.test.ts
    core-credentials.test.ts
    core-headers.test.ts
    core-context-injection.test.ts
    test-utils.ts              # Shared test utilities
  core/
    __tests__/
      run-handler-schema.test.ts
      run-handler-ensureObjectArgs.test.ts
      run-handler-available.test.ts
```

V1 tests follow the same pattern but may also have top-level `tests/` directories:

```
packages/v1/runtime/tests/
  service-adapters/
    groq/groq-adapter-language-model.test.ts
    shared/sdk-client-utils.test.ts
```

### Naming conventions

- Test files: `*.test.ts` or `*.spec.ts` (`.tsx` for React component tests)
- Test utilities: `test-utils.ts` in `__tests__/` directories
- Setup files: `setup.ts`, `globalSetup.ts` in `__tests__/` directories

## Test Utilities

The primary test utility is at `packages/v2/core/src/__tests__/test-utils.ts`. It provides:

- **`MockAgent`** — a mock implementation of the agent interface with:
  - Configurable messages, state, errors, and delays
  - Spied methods: `addMessages`, `addMessage`, `abortRun`, `clone`
  - `runAgent()` tracking via `runAgentCalls` array
  - Clone support (clones share parent tracking)

```typescript
import { MockAgent, MockAgentOptions } from "../test-utils";

const agent = new MockAgent({
  messages: [],
  newMessages: [/* messages returned by runAgent */],
  agentId: "test-agent",
  threadId: "test-thread",
  state: { key: "value" },
  runAgentDelay: 100,    // ms delay before runAgent resolves
  error: new Error("boom"), // make runAgent reject
});
```

## Tips

- **Nx caches test results.** If source hasn't changed, `nx run @copilotkit/core:test` returns cached results instantly. Use `nx reset` to clear the cache if needed.
- **Globals are enabled.** You don't need to import `describe`, `it`, `expect`, `vi`, etc. — they're globally available via `globals: true`.
- **Silent mode is on.** Console output from tests is suppressed by default (`silent: true`). Remove it temporarily if you need to debug with `console.log`.
- **Build before testing.** Tests depend on upstream packages being built (`dependsOn: ["^build"]` in nx.json). Run `pnpm build` if you get import errors in tests.
