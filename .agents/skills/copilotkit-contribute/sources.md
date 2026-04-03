# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## contribution-guide.md
- CONTRIBUTING.md (fork/clone instructions, branch naming conventions, PR submission process, communication channels)
- lefthook.yml (pre-commit hooks: check-binaries, sync-lockfile, lint-fix, test-and-check-packages; commit-msg hook: commitlint)
- package.json (pnpm scripts: build, dev, dev:next, dev:classic, test, lint, format, check-prettier, check:packages)
- .commitlintrc.json (conventional commit configuration, type/scope rules, header-max-length: 120)

## repo-structure.md
- packages/v1/ (all v1 package directories: react-core, react-ui, react-textarea, shared, runtime, runtime-client-gql, sdk-js, a2ui-renderer, cli, eslint-config-custom, tailwind-config, tsconfig)
- packages/v2/ (all v2 package directories: shared, core, react, angular, runtime, agent, voice, web-inspector, sqlite-runner, demo-agents, eslint-config, typescript-config)
- examples/ (v1, v2, canvas, e2e, integrations, showcases directory structures)
- showcase/ (shell, packages, scripts)
- pnpm-workspace.yaml (workspace package definitions)
- nx.json (task orchestration config: build parallelism, dependency graph, named inputs, output caching)

## testing-guide.md
- packages/v2/core/vitest.config.mjs (Vitest config: node environment, globals, include patterns, silent mode)
- packages/v2/react/vitest.config.mjs (Vitest config: jsdom environment, globalSetup, setupFiles)
- packages/v2/runtime/vitest.config.mjs (Vitest config: COPILOTKIT_TELEMETRY_DISABLED env var)
- packages/v2/core/src/__tests__/test-utils.ts (MockAgent implementation, MockAgentOptions interface)
- packages/v2/core/src/__tests__/ (test file examples: core-simple.test.ts, core-tool-simple.test.ts, etc.)
- packages/v2/core/src/core/__tests__/ (nested test examples: run-handler-schema.test.ts, etc.)
- packages/v1/runtime/tests/ (v1 test directory structure)
- package.json (test scripts: test, test:next, test:classic, test:watch, test:coverage)
- nx.json (test target configuration, coverage output paths, dependsOn: ^build)

## pr-guidelines.md
- .github/workflows/ (CI workflow: checkout, pnpm install, build, pkg-pr-new preview publishing)
- lefthook.yml (pre-commit and commit-msg hook definitions)
- .commitlintrc.json (commitlint rules for conventional commit enforcement)
- package.json (quality scripts: test, build, check-prettier, lint, check:packages)
- CONTRIBUTING.md (PR template guidance, review process)
