// Which CI job runs each test file. Read by
// `scripts/validate-test-ci-coverage.mjs` (PE-1113).
//
// Every tracked test file must match a RULE (a CI job runs it) or an
// ALLOWLIST entry (CI does not run it, on purpose, with the reason).
//
// A rule says: the workflow `.github/workflows/<workflow>` contains the
// command `runs`, and that command runs the files that `files` matches. Keep
// `files` as narrow as the runner's own include globs (vitest `include`,
// pytest path, playwright `testDir`), so a test placed outside them shows up
// as unmapped instead of silently never running. The check fails when the
// workflow no longer contains `runs`, so a removed job cannot leave a rule
// behind that still claims coverage.
//
// Globs: `**` is any number of directories, `*` and `?` stay inside one path
// segment, `{a,b}` is a choice.

/** What counts as a test file, in every language the repo uses. */
export const TEST_FILE_GLOBS = [
  // TypeScript / JavaScript
  "**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/*.browser.{ts,tsx}",
  "**/*.integration.{ts,mjs}",
  // Python
  "**/test_*.py",
  "**/*_test.py",
  // Go
  "**/*_test.go",
  // Ruby
  "**/*_test.rb",
  "**/*_spec.rb",
  "**/test_*.rb",
  // Java / Kotlin
  "**/src/test/**/*.{java,kt}",
  // .NET: one entry per test project
  "**/*Tests.csproj",
  // Codemod (jssg) cases: one `input.*` / `expected.*` pair per case.
  "codemods/*/tests/*/*/input.{ts,tsx}",
  // Dart / Flutter
  "**/*_test.dart",
  // Swift
  "**/*Tests.swift",
  // Shell
  "**/*.bats",
  "**/*.test.sh",
];

/** Paths that match TEST_FILE_GLOBS but are not tests. */
export const NOT_TEST_GLOBS = [
  // Inputs that test suites read, not tests themselves.
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/testdata/**",
  // pytest configuration, not a test module.
  "**/conftest.py",
  // Production code (a JUnit/console report parser) whose name starts with
  // `test_`; tools.py and a2ui.py import it.
  "examples/showcases/antigravity-repo-doctor/agent/src/repo_doctor/test_report.py",
];

/** `test_unit.yml` runs `nx run-many -t test` over affected `packages/**`. */
const TEST_UNIT = {
  workflow: "test_unit.yml",
  runs: "npx nx run-many -t build,test",
};

/** A package that `test_unit.yml` tests; `include` mirrors its vitest config. */
function unit(root, include, extra = {}) {
  return {
    ...TEST_UNIT,
    files: [include].flat().map((glob) => `${root}/${glob}`),
    ...extra,
  };
}

export const RULES = [
  // ---------------------------------------------------------------------
  // packages/* — TypeScript packages, `nx run-many -t test` in test_unit.yml
  // ---------------------------------------------------------------------
  unit("packages/a2ui-renderer", "**/__tests__/**/*.{test,spec}.{ts,tsx}"),
  unit("packages/agentcore-runner", "src/**/__tests__/**/*.{test,spec}.ts"),
  unit("packages/angular", "src/**/*.{spec,test}.{ts,tsx}"),
  unit("packages/channels", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-core", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-discord", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-intelligence", "src/**/*.test.ts"),
  unit("packages/channels-slack", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-teams", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-ui", "src/**/*.test.{ts,tsx}"),
  unit("packages/channels-whatsapp", "src/**/*.test.ts"),
  unit("packages/core", "src/**/__tests__/**/*.{test,spec}.ts"),
  unit("packages/intelligence-delivery-core", "src/**/__tests__/**/*.test.ts"),
  unit("packages/intelligence-langgraph", "src/**/__tests__/**/*.test.ts"),
  unit("packages/intelligence-mastra", "src/**/__tests__/**/*.test.ts"),
  unit("packages/learning", "src/**/__tests__/**/*.test.ts"),
  unit("packages/markdown", "src/**/*.{test,spec}.{ts,tsx}"),
  unit("packages/mcp-apps-renderer", "**/__tests__/**/*.{test,spec}.ts"),
  unit("packages/react-core", [
    "src/**/*.{test,spec}.{ts,tsx}",
    // `test` also runs `test:scripts` (node --test).
    "scripts/__tests__/*.test.mjs",
  ]),
  unit("packages/react-native", [
    "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
    // `test` also runs `test:scripts` (node --test).
    "scripts/__tests__/*.test.mjs",
  ]),
  unit(
    "packages/runtime",
    ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    {
      exclude: "packages/runtime/**/integration/bun/**",
    },
  ),
  unit("packages/sdk-js", "src/**/*.{test,spec}.ts"),
  unit("packages/shared", "src/**/*.{test,spec}.ts"),
  unit("packages/sqlite-runner", "src/**/__tests__/**/*.{test,spec}.ts"),
  unit("packages/voice", "src/**/*.{test,spec}.ts"),
  unit("packages/vue", "**/__tests__/**/*.test.ts"),
  unit("packages/web-components", "**/__tests__/**/*.{test,spec}.ts"),
  // No `include` in its vitest config: vitest's default picks up every
  // `*.test.*` / `*.spec.*` in the package, including `dev/`.
  unit("packages/web-inspector", "**/*.{test,spec}.{ts,tsx}"),

  // Browser suites that test_unit.yml runs as separate steps.
  {
    workflow: "test_unit.yml",
    runs: "pnpm nx run @copilotkit/react-core:test:browser",
    files: "packages/react-core/browser/*.spec.ts",
  },
  {
    workflow: "test_unit.yml",
    runs: "pnpm nx run @copilotkit/react-core:test:browser-scroll",
    files: "packages/react-core/browser-tests/*.test.mjs",
  },
  {
    workflow: "test_unit.yml",
    runs: "pnpm nx run @copilotkit/web-inspector:test:browser",
    files: "packages/web-inspector/dev/*.browser.ts",
  },
  {
    workflow: "test_integration-runtime.yml",
    runs: "bun test src/runtime/__tests__/integration/bun/bun-servers.integration.test.ts",
    files:
      "packages/runtime/src/runtime/__tests__/integration/bun/bun-servers.integration.test.ts",
  },

  // ---------------------------------------------------------------------
  // packages/* — other languages. test_unit.yml excludes these projects;
  // each has its own workflow.
  // ---------------------------------------------------------------------
  {
    workflow: "intelligence-runtimes.yml",
    runs: "pnpm nx run-many -t test,lint,build -p runtime-go",
    files: "packages/runtime-go/**/*_test.go",
  },
  {
    workflow: "intelligence-runtimes.yml",
    runs: "pnpm nx run-many -t test,lint,typecheck,build -p runtime-python",
    files: "packages/runtime-python/tests/**/test_*.py",
  },
  {
    workflow: "intelligence-runtimes.yml",
    runs: "bundle exec pnpm nx run-many -t test,lint,build -p runtime-ruby",
    // The `test` target requires `test/*_test.rb`.
    files: "packages/runtime-ruby/test/*_test.rb",
  },
  {
    workflow: "intelligence-runtimes.yml",
    runs: "pnpm nx run-many -t test,lint,check-types,build,pack -p runtime-dotnet",
    files:
      "packages/runtime-dotnet/{tests,sdk-tests,agent-framework-tests}/*.Tests.csproj",
  },
  {
    workflow: "intelligence-skill-adapters.yml",
    runs: "pnpm nx run-many -t test,lint,typecheck -p runtime-python,intelligence-delivery-python-core",
    files: "packages/intelligence-delivery-python-core/tests/**/test_*.py",
  },
  {
    workflow: "intelligence-skill-adapters.yml",
    runs: [
      "project: [intelligence-langgraph-python, intelligence-adk-python]",
      'pnpm nx run "${{ matrix.project }}:test-${{ matrix.compatibility }}"',
    ],
    files:
      "packages/{intelligence-langgraph-python,intelligence-adk-python}/tests/**/test_*.py",
  },
  {
    workflow: "intelligence-skill-adapters.yml",
    runs: 'pnpm nx run "intelligence-agent-framework-dotnet:test-${{ matrix.compatibility }}"',
    files:
      "packages/intelligence-agent-framework-dotnet/tests/Skills.Tests.csproj",
  },

  // ---------------------------------------------------------------------
  // scripts/ and codemods/ — repo tooling
  // ---------------------------------------------------------------------
  {
    workflow: "test_unit.yml",
    runs: "npx vitest run --config scripts/release/vitest.config.mts",
    files: "scripts/release/**/*.test.ts",
  },
  {
    // `repo-scripts:test` in scripts/project.json lists every file below.
    workflow: "test_unit-repo-tooling.yml",
    runs: "pnpm nx run repo-scripts:test",
    files: [
      "scripts/__tests__/agentcore-deploy-skip-backend.test.ts",
      "scripts/__tests__/agentcore-runtime-security.test.ts",
      "scripts/__tests__/lint-baseline.test.ts",
      "scripts/__tests__/lint-gate.test.ts",
      "scripts/__tests__/runtime-entitlement-recovery.test.ts",
      "scripts/__tests__/telemetry-fragment.test.ts",
      "scripts/__tests__/validate-integration-pins.test.ts",
      "scripts/__tests__/validate-test-ci-coverage.test.mjs",
      "scripts/deprecations/v1-dist-notices.test.mjs",
      "scripts/doc-tests/__tests__/extract.test.ts",
      "scripts/release/__tests__/detect-py-version-changes.test.sh",
      "codemods/__tests__/*.test.ts",
    ],
  },
  {
    workflow: "test_unit-repo-tooling.yml",
    runs: "pnpm nx run @copilotkit/v2-migration:test",
    files: "codemods/v2-migration/tests/*/*/input.{ts,tsx}",
  },
  {
    workflow: "static_quality.yml",
    runs: "pnpm exec vitest run scripts/__tests__/validate-dts-ambient.test.ts",
    files: "scripts/__tests__/validate-dts-ambient.test.ts",
  },
  {
    workflow: "static_quality.yml",
    runs: [
      "scripts/__tests__/validate-dts-imports.test.ts",
      "scripts/__tests__/validate-optional-peer-entries.test.ts",
      "scripts/__tests__/validate-module-scope-create-require.test.ts",
    ],
    files: [
      "scripts/__tests__/validate-dts-imports.test.ts",
      "scripts/__tests__/validate-optional-peer-entries.test.ts",
      "scripts/__tests__/validate-module-scope-create-require.test.ts",
    ],
  },
  {
    workflow: "static_quality.yml",
    runs: "pnpm exec vitest run scripts/__tests__/docs-reference-generator.test.ts",
    files: "scripts/__tests__/docs-reference-generator.test.ts",
  },
  {
    workflow: "static_quality.yml",
    runs: "pnpm exec vitest run scripts/__tests__/docs-prompt-telemetry.test.ts",
    files: "scripts/__tests__/docs-prompt-telemetry.test.ts",
  },
  {
    workflow: "static_quality.yml",
    runs: "pnpm exec nx run repo-scripts:validate-production-verification",
    files: [
      "scripts/__tests__/showcase-promote-workflow.test.mjs",
      "scripts/__tests__/showcase-build-impact.test.mjs",
    ],
  },
  {
    workflow: "integrations_parity.yml",
    runs: "pnpm exec vitest run scripts/__tests__/integration-intelligence-migration.test.ts",
    files: "scripts/__tests__/integration-intelligence-migration.test.ts",
  },
  {
    workflow: "integrations_parity.yml",
    runs: "pnpm exec vitest run scripts/__tests__/starter-model-env-contract.test.ts",
    files: "scripts/__tests__/starter-model-env-contract.test.ts",
  },
  {
    workflow: "plugin-skills-check.yml",
    runs: "pnpm exec vitest run scripts/__tests__/sync-plugin-skills.test.ts",
    files: "scripts/__tests__/sync-plugin-skills.test.ts",
  },
  {
    workflow: "plugin-skills-check.yml",
    runs: "pnpm exec vitest run scripts/__tests__/public-skill-drift.test.ts",
    files: "scripts/__tests__/public-skill-drift.test.ts",
  },
  {
    workflow: "static_intelligence-env-names.yml",
    runs: "pnpm exec vitest run scripts/__tests__/validate-intelligence-env-names.test.ts",
    files: "scripts/__tests__/validate-intelligence-env-names.test.ts",
  },
  {
    workflow: "static_intelligence-env-names.yml",
    runs: "pnpm exec vitest run scripts/__tests__/validate-intelligence-wiring-block.test.ts",
    files: "scripts/__tests__/validate-intelligence-wiring-block.test.ts",
  },
  {
    workflow: "test_integration-docs.yml",
    runs: "pnpm exec vitest run scripts/__tests__/validate-doc-model-names.test.ts",
    files: "scripts/__tests__/validate-doc-model-names.test.ts",
  },
  {
    workflow: "test_integration-docs.yml",
    runs: "pnpm nx run repo-scripts:validate-docs-deprecated-imports",
    files: "scripts/__tests__/validate-docs-deprecated-imports.test.mjs",
  },
  {
    workflow: "test_integration-docs.yml",
    runs: "pnpm nx run learned-skill-conformance:test-doc-dependencies",
    files: "scripts/doc-tests/dependencies.test.mjs",
  },
  {
    workflow: "static_retired-anthropic-models.yml",
    runs: "pnpm nx run repo-scripts:validate-retired-anthropic-models",
    files: "scripts/__tests__/validate-retired-anthropic-models.test.mjs",
  },
  {
    workflow: "static_starter-deps.yml",
    runs: "pnpm nx run repo-scripts:validate-starter-deps",
    files: "scripts/__tests__/validate-starter-deps.test.mjs",
  },
  {
    workflow: "static_channels-zod.yml",
    runs: "pnpm nx run repo-scripts:validate-channels-zod",
    files: "scripts/__tests__/validate-channels-zod.test.mjs",
  },
  {
    workflow: "test_e2e-public-examples.yml",
    runs: "pnpm nx run repo-scripts:validate-examples-catalog",
    files: "scripts/__tests__/examples-readme-catalog.test.mjs",
  },
  {
    workflow: "package-licenses.yml",
    runs: "pnpm nx run package-licenses:test",
    files: "scripts/package-licenses/*.test.mjs",
  },

  // ---------------------------------------------------------------------
  // tools/
  // ---------------------------------------------------------------------
  {
    workflow: "intelligence-skill-adapters.yml",
    runs: "pnpm nx run compatibility-monitor:test",
    files: "tools/compatibility-monitor/*.test.mjs",
  },
  {
    workflow: "test_genui-eval.yml",
    runs: "pnpm nx run-many -t typecheck,test -p genui-eval",
    files: "tools/genui-eval/test/**/*.test.ts",
  },
  {
    workflow: "intelligence-smoke.yml",
    runs: "pnpm nx run intelligence-smoke:test",
    files: "tools/intelligence-smoke/*.test.mjs",
  },
  {
    workflow: "intelligence-skill-adapters.yml",
    runs: "pnpm nx run learned-skill-conformance:test-native-delivery-drivers",
    files: "tools/learned-skill-conformance/native-drivers.test.mjs",
  },
  {
    workflow: "test_unit-repo-tooling.yml",
    runs: "pnpm nx run learned-skill-conformance:test-workspace-artifacts",
    files: "tools/learned-skill-conformance/workspace-artifacts.test.mjs",
  },
  {
    workflow: "test_unit-repo-tooling.yml",
    runs: "pnpm nx run oxlint-rules:test",
    files: "tools/oxlint-rules/**/*.test.mjs",
  },
  {
    workflow: "intelligence-rich-threads-deploy.yml",
    runs: "pnpm nx run-many -t test,lint --projects=railway-runner-deploy",
    files: "tools/railway-runner-deploy/*.test.mjs",
  },
  {
    workflow: "intelligence-runtimes.yml",
    runs: "pnpm nx run-many -t test,lint -p runtime-conformance",
    files: "tools/runtime-conformance/test/*.test.mjs",
  },

  // ---------------------------------------------------------------------
  // sdk-python/
  // ---------------------------------------------------------------------
  {
    workflow: "test_unit-python-sdk.yml",
    runs: "poetry run python -m pytest tests/ -v",
    files: "sdk-python/tests/**/test_*.py",
  },

  // ---------------------------------------------------------------------
  // showcase/ — packages and apps
  // ---------------------------------------------------------------------
  {
    // `test:ci` is the harness vitest config minus vitest.quarantine.json;
    // the next step re-runs quarantined files and requires them to fail.
    workflow: "test_unit-showcase.yml",
    runs: "npx nx run @copilotkit/showcase-harness:test:ci",
    files: [
      "showcase/harness/src/**/*.test.ts",
      "showcase/harness/test/unit/**/*.test.ts",
    ],
  },
  {
    workflow: "test_unit-showcase.yml",
    runs: "npx nx run @copilotkit/showcase-harness:test:integration",
    files: "showcase/harness/test/integration/**/*.test.ts",
    // Excluded in vitest.integration.config.ts; see ALLOWLIST.
    exclude:
      "showcase/harness/test/integration/bubble-race-repro-defect-*.test.ts",
  },
  {
    // vitest's default include, minus the config's e2e and fixture excludes.
    workflow: "showcase_validate.yml",
    runs: [
      "name: Run build pipeline tests",
      "working-directory: showcase/scripts",
    ],
    files: "showcase/scripts/**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    exclude: "showcase/scripts/__tests__/{e2e,fixtures}/**",
  },
  {
    // `bats <dir>` runs the `.bats` files directly in that directory.
    workflow: "showcase_validate.yml",
    runs: "bats showcase/scripts/__tests__/",
    files: "showcase/scripts/__tests__/*.bats",
  },
  {
    workflow: "showcase_validate.yml",
    runs: "pnpm exec nx run showcase-shared-typescript:test",
    files: "showcase/shared/typescript/tools/__tests__/**/*.test.ts",
  },
  {
    workflow: "showcase_validate.yml",
    runs: '"$venv/bin/python" -m pytest showcase/shared/python/tests -v',
    files: "showcase/shared/python/tests/**/test_*.py",
  },
  {
    workflow: "showcase_validate.yml",
    runs: "name: Run showcase shell unit tests",
    files: "showcase/shell/src/**/*.test.{ts,tsx}",
  },
  {
    workflow: "test_unit-shell-docs.yml",
    runs: "npm run test:ci",
    files: "showcase/shell-docs/src/**/*.test.{ts,tsx}",
  },
  {
    workflow: "test_unit-showcase.yml",
    runs: "name: Run shell-dashboard unit suite",
    files: "showcase/shell-dashboard/src/**/*.test.{ts,tsx}",
  },
  {
    // `test` runs `test:node` (vitest.config.ts) and `test:angular`
    // (`ng test`, angular.json includes src/**/*.test.ts).
    workflow: "test_unit-showcase.yml",
    runs: "-p @copilotkit/showcase-angular-host,@copilotkit/showcase-vue-host",
    files: [
      "showcase/angular/scripts/**/*.test.ts",
      "showcase/angular/src/**/*.test.ts",
      "showcase/vue/src/**/*.test.ts",
    ],
  },
  {
    workflow: "showcase_lint_prod.yml",
    // all_tests.rb requires every `test_*.rb` beside it.
    runs: "ruby showcase/bin/spec/all_tests.rb",
    files: "showcase/bin/spec/test_*.rb",
  },
  {
    // The starter compose files mount showcase/tests and run
    // `npx playwright test starter-smoke`.
    workflow: "test_smoke-starter.yml",
    runs: "docker compose -f docker-compose.test.yml up",
    files: "showcase/tests/e2e/starter-smoke.spec.ts",
  },

  // ---------------------------------------------------------------------
  // showcase/integrations/*
  // ---------------------------------------------------------------------
  {
    workflow: "showcase_validate.yml",
    runs: "-m pytest tests/python/ -v",
    files: "showcase/integrations/*/tests/python/**/{test_*,*_test}.py",
  },
  {
    workflow: "showcase_validate.yml",
    runs: "-m pytest tests/native/ -v",
    files: "showcase/integrations/strands/tests/native/**/test_*.py",
  },
  {
    // Python modules kept directly in tests/ or in src/agents/.
    workflow: "showcase_validate.yml",
    runs: [
      '"${pkg_dir}"tests/test_*.py "${pkg_dir}"src/agents/test_*.py',
      '-m pytest "${extra_tests[@]}" -v',
    ],
    files: [
      "showcase/integrations/*/tests/test_*.py",
      "showcase/integrations/*/src/agents/test_*.py",
    ],
    exclude: "showcase/integrations/_shared/**",
  },
  {
    workflow: "showcase_validate.yml",
    runs: '"$venv/bin/python" -m pytest showcase/integrations/_shared/tests -v',
    files: "showcase/integrations/_shared/tests/**/test_*.py",
  },
  {
    workflow: "test_unit-spring-ai.yml",
    runs: "mvn -B test",
    files: "showcase/integrations/spring-ai/src/test/**/*.java",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: "pnpm exec vitest run --config vitest.config.ts",
    files:
      "showcase/integrations/strands-typescript/src/agent/{*.test.ts,lib/**/*.test.ts}",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: "node --import tsx tests/unit/forwarding-proxy-fetch-nullguard.test.mts",
    files:
      "showcase/integrations/strands-typescript/tests/unit/forwarding-proxy-fetch-nullguard.test.mts",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: "pnpm exec vitest run --root showcase/integrations/_shared/ts",
    files: "showcase/integrations/_shared/ts/*.test.ts",
  },
  {
    // The `include` list in built-in-agent/vitest.config.ts.
    workflow: "test_unit-showcase-integrations.yml",
    runs: ["- built-in-agent", "run: npx vitest run"],
    files: [
      "showcase/integrations/built-in-agent/src/cvdiag-backend.test.ts",
      "showcase/integrations/built-in-agent/src/cvdiag-backend-persist.e2e.test.ts",
      "showcase/integrations/built-in-agent/src/lib/factory/{tanstack-factory,demo-stream,byoc-json-render-factory}.test.ts",
      "showcase/integrations/built-in-agent/src/app/demos/gen-ui-agent/InlineAgentStateCard.test.ts",
      "showcase/integrations/built-in-agent/src/app/demos/multimodal/sample-attachment-buttons.test.ts",
      "showcase/integrations/built-in-agent/src/lib/transcription-service.test.ts",
    ],
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: ["- claude-sdk-typescript", "run: npx vitest run"],
    files: [
      "showcase/integrations/claude-sdk-typescript/src/{cvdiag-backend,claude-agent-sdk-adapter}.test.ts",
      "showcase/integrations/claude-sdk-typescript/shared-tools/__tests__/*.test.ts",
    ],
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: ["- langgraph-typescript", "run: npx vitest run"],
    files: [
      "showcase/integrations/langgraph-typescript/src/cvdiag-backend.test.ts",
      "showcase/integrations/langgraph-typescript/src/agent/*.test.ts",
      "showcase/integrations/langgraph-typescript/shared-tools/__tests__/*.test.ts",
    ],
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: "node --import tsx --test tests/model-parameters.test.ts",
    files:
      "showcase/integrations/langgraph-typescript/src/agent/tests/model-parameters.test.ts",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: ["- mastra", "run: npx vitest run"],
    files: "showcase/integrations/mastra/tests/vitest/**/*.test.ts",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: [
      "dotnet test",
      "showcase/integrations/_shared/dotnet/tests/CvdiagSchema.Tests.csproj",
    ],
    files:
      "showcase/integrations/_shared/dotnet/tests/CvdiagSchema.Tests.csproj",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: [
      "dotnet test",
      "showcase/integrations/ms-agent-dotnet/agent/tests/SharedStateAgent.Tests.csproj",
    ],
    files:
      "showcase/integrations/ms-agent-dotnet/agent/tests/SharedStateAgent.Tests.csproj",
  },
  {
    workflow: "test_unit-showcase-integrations.yml",
    runs: [
      "dotnet test",
      "showcase/integrations/ms-agent-harness-dotnet/agent/tests/CvdiagBackend.Tests.csproj",
    ],
    files:
      "showcase/integrations/ms-agent-harness-dotnet/agent/tests/CvdiagBackend.Tests.csproj",
  },
  {
    // ON DEMAND ONLY: a maintainer comments `/test-aimock <slug>` on a PR
    // (or dispatches the workflow). These Playwright specs do not gate PRs.
    workflow: "test_e2e-showcase-on-demand.yml",
    runs: "npx playwright test",
    files: "showcase/integrations/*/tests/e2e/**/*.spec.ts",
  },

  // ---------------------------------------------------------------------
  // examples/ and templates/
  // ---------------------------------------------------------------------
  {
    // Matrix `pnpm test` in each example directory; these four use
    // vitest's default include.
    workflow: "test_e2e-public-examples.yml",
    runs: [
      "directory: examples/v1/form-filling",
      "directory: examples/v1/travel",
      "directory: examples/v1/research-canvas",
      "directory: examples/v1/state-machine",
      "run: pnpm test",
    ],
    files:
      "examples/v1/{form-filling,travel,research-canvas,state-machine}/**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  },
  {
    // Its `test` script lists these files (node --test and tsx --test).
    workflow: "test_e2e-public-examples.yml",
    runs: ["directory: examples/v1/chat-with-your-data", "run: pnpm test"],
    files: "examples/v1/chat-with-your-data/**/*.test.{mjs,tsx}",
  },
  {
    workflow: "test_e2e-public-examples.yml",
    runs: ["directory: examples/canvas/mastra-pm", "run: pnpm test"],
    files: "examples/canvas/mastra-pm/src/**/*.test.{ts,tsx}",
  },
  {
    workflow: "test_e2e-public-examples.yml",
    runs: "uv run --locked --with pytest==9.1.1 python -m pytest tests",
    files: "examples/v1/travel/agent/tests/**/test_*.py",
  },
  {
    workflow: "test_e2e-public-examples.yml",
    runs: ["working-directory: examples/e2e", "run: pnpm test"],
    files: "examples/e2e/tests/**/*.spec.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "pnpm nx run-many -t test -p slack-example,teams-example,demo",
    files: [
      "examples/slack/app/**/*.test.{ts,tsx}",
      "examples/teams/app/**/*.test.{ts,tsx}",
      "examples/v2/react/demo/src/**/__tests__/**/*.{test,spec}.ts",
    ],
  },
  {
    workflow: "test_claude-managed-starter.yml",
    runs: "run: npm test",
    files: "examples/integrations/claude-managed-agents/tests/*.test.ts",
  },
  {
    workflow: "test_claude-managed-starter.yml",
    runs: "run: npm run test:e2e",
    files: "examples/integrations/claude-managed-agents/tests/e2e/**/*.spec.ts",
  },
  {
    workflow: "test_ms-agent-dotnet-starter-regression.yml",
    runs: "dotnet run --project examples/integrations/ms-agent-framework-dotnet/agent-tests/SharedStateAgent.RegressionTests.csproj",
    files:
      "examples/integrations/ms-agent-framework-dotnet/agent-tests/SharedStateAgent.RegressionTests.csproj",
  },
  {
    workflow: "test_reskinnable-demo.yml",
    runs: "run: pnpm test:unit",
    files: "examples/showcases/reskinnable-demo/src/**/*.test.{ts,tsx}",
  },
  {
    workflow: "test_claude-managed-flutter-starter.yml",
    runs: "run: npm test",
    files: "templates/claude-managed-agents-flutter/tests/*.test.ts",
  },
  {
    workflow: "test_claude-managed-flutter-starter.yml",
    runs: "run: flutter test",
    files:
      "templates/claude-managed-agents-flutter/flutter/test/**/*_test.dart",
  },
  {
    workflow: "test_reskinnable-demo.yml",
    runs: "name: E2E against aimock",
    files:
      "examples/showcases/reskinnable-demo/e2e/{smoke,locked-skin,inset-layout,a2ui-canvas,exec-blocks}.spec.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: [
      "directory: examples/integrations/agentcore/infra-cdk",
      "test: npx jest",
    ],
    files: "examples/integrations/agentcore/infra-cdk/test/**/*.test.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/integrations/strands-typescript/agent",
    files: "examples/integrations/strands-typescript/agent/src/*.test.ts",
  },
  {
    // npm workspaces root; the tests live in the `server` workspace.
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/showcases/claude-managed-agents",
    files: "examples/showcases/claude-managed-agents/server/src/**/*.test.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/showcases/strands-crm/agent",
    files: "examples/showcases/strands-crm/agent/src/**/*.test.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/showcases/strands-crm/frontend",
    files: "examples/showcases/strands-crm/frontend/lib/**/*.test.ts",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "node --test examples/showcases/chatkit-studio/apps/world/e2e/migration-contract.test.cjs",
    files:
      "examples/showcases/chatkit-studio/apps/world/e2e/migration-contract.test.cjs",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "node --test examples/showcases/mcp-apps/compatibility.test.mjs",
    files: "examples/showcases/mcp-apps/compatibility.test.mjs",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "pytest a2ui_extension/tests -v",
    files: "examples/integrations/a2a-a2ui/a2ui_extension/tests/**/test_*.py",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "python -m unittest test_message_payload -v",
    files: "examples/integrations/llamaindex/agent/test_message_payload.py",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/integrations/ms-agent-framework-python/agent",
    files:
      "examples/integrations/ms-agent-framework-python/agent/tests/**/test_*.py",
  },
  {
    workflow: "test_unit-examples.yml",
    runs: "directory: examples/showcases/antigravity-repo-doctor/agent",
    files:
      "examples/showcases/antigravity-repo-doctor/agent/tests/**/test_*.py",
  },
];

/**
 * Test files CI does not run, on purpose. Every entry says why. Prefer
 * adding a CI job: an entry here is a test that guards nothing on a PR.
 */
export const ALLOWLIST = [
  {
    files: "showcase/scripts/__tests__/e2e/*.spec.ts",
    reason:
      "Manual Playwright checks against a showcase dev server you start yourself (BASE_URL); " +
      "screenshots.spec.ts only saves screenshots for a person to inspect. The same demos are " +
      "covered by the per-integration e2e specs and the harness probes.",
  },
  {
    files:
      "showcase/harness/test/integration/bubble-race-repro-defect-*.test.ts",
    reason:
      "Drive `bin/showcase test <slug> --d5 --direct` against a showcase stack running on the " +
      "same machine. Run with BUBBLE_RACE_LIVE=1 (see vitest.integration.config.ts).",
  },
  {
    files: "showcase/harness/test/e2e/*.test.ts",
    reason:
      "Real local UI proof: needs SHOWCASE_TEST_URL and AIMOCK_URL pointing at a running demo " +
      "and aimock on loopback.",
  },
  {
    files: "showcase/shell-dashboard/tests/runtime-env-switch.spike.test.ts",
    reason:
      "Integration spike (one `next build`, two `next start` boots on fixed ports) that hangs " +
      "in the unit job; test_unit-showcase.yml excludes it and documents why.",
  },
  {
    files: "showcase/shell-dashboard/tests/visual/*.spec.ts",
    reason:
      "Visual Playwright run (`npm run test:visual`) for manual layout review.",
  },
  {
    files: "showcase/pocketbase/tests/*.{integration.mjs,test.sh}",
    reason:
      "Need a disposable PocketBase container built from showcase/pocketbase/Dockerfile " +
      "(see showcase/pocketbase/tests/README.md). No CI job starts one yet.",
  },
  {
    files: "showcase/tests/e2e/integration-smoke.spec.ts",
    reason:
      "Runs through showcase/scripts/smoke-local.sh against integration containers started " +
      "on this machine.",
  },
  {
    files: "showcase/tests/env-routing.spec.ts",
    reason: "Checks the live Railway deployments, not code in this checkout.",
  },
  {
    files: [
      "examples/showcases/deep-agents-finance-erp/agent/test_multi_turn.py",
      "examples/showcases/deep-agents-finance-erp/agent/evals/test_agent.py",
    ],
    reason:
      "Scripts run by hand (`python test_multi_turn.py`, `python -m evals.test_agent`), not " +
      "pytest suites: they call OpenAI, and the eval pushes a dataset to LangSmith.",
  },
  {
    files: [
      "examples/showcases/oracle-agent-memory/agent/tests/test_oracle_checkpointer.py",
      "examples/showcases/oracle-agent-memory/frontend/e2e/*.spec.ts",
    ],
    reason:
      "Need a live Oracle AI Database (docker compose plus db/setup-db.sh); the e2e specs " +
      "also need a real OPENAI_API_KEY. The frontend has no lockfile to install from.",
  },
  {
    files: "examples/showcases/reskinnable-demo/e2e/memory-learning.spec.ts",
    reason:
      "Needs the Docker memory stack (app-api on localhost:7250), which CI does not start.",
  },
  {
    files: "examples/showcases/reskinnable-demo/e2e/ogui-routing.spec.ts",
    reason:
      "The whole file is `test.describe.fixme` (marked obsolete pending a redesign).",
  },
  {
    files:
      "templates/claude-managed-agents-flutter/flutter/ios/RunnerTests/RunnerTests.swift",
    reason:
      "Unmodified `flutter create` iOS scaffold (one empty test). Needs Xcode on macOS; " +
      "the Xcode project references it, so it stays.",
  },
];
