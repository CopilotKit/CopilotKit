# Mutation testing baseline

Measured on 2026-11-04 against `2.0.0` at `df8b9c633c`, with Stryker 10.1.1
and the config in [stryker.base.mjs](stryker.base.mjs). What the numbers mean
is in [README.md](README.md). The bar for new tests is in
[.claude/docs/testing.md](../../.claude/docs/testing.md).

## Scores

| Package                  | Scope                 | Score     | Score without timeouts | Covered score | Killed | Timeout | Survived | No coverage | Mutants |
| ------------------------ | --------------------- | --------- | ---------------------- | ------------- | ------ | ------- | -------- | ----------- | ------- |
| `@copilotkit/core`       | all of `src/`         | **73.2%** | 68.4%                  | 78.3%         | 12375  | 866     | 3675     | 1175        | 18091   |
| `@copilotkit/runtime`    | all of `src/`         | **69.8%** | 67.5%                  | 75.2%         | 10531  | 364     | 3598     | 1106        | 15599   |
| `@copilotkit/react-core` | logic only, see below | **69.0%** | 44.9%                  | 72.5%         | 628    | 336     | 365      | 69          | 1398    |

- **Score** counts a timeout as a kill, as Stryker does.
- **Score without timeouts** is the lower bound. The runs shared one machine
  with other work, so some timeouts can come from load and not from the
  mutant. In react-core a third of the kills are timeouts, so read its score as
  somewhere between 45% and 69%.
- Static mutants (module-level code) were skipped: 583 in core, 203 in runtime
  and 20 in react-core.

### Scope

- **core** and **runtime**: every file in `src/` except tests and generated
  files (`core/src/styles/stylesheet.ts`).
- **react-core**: only `src/hooks/`, `src/providers/`, `src/lib/`,
  `src/types/`, `src/a2ui/` and `src/context.ts` (37 files with mutants). The
  full package has 17,771 mutants in 147 files. A full run was on track to take
  about 13 hours on a shared 18-core laptop, so it was stopped at 11%. The
  rendering code in `src/components/` and `src/generative-ui/` is **not
  measured**. The CI job runs the full package.

## Lowest-scoring files

Files with at least 20 mutants, worst first. Survived means a test ran the code
and still passed. No coverage means no test ran the code.

### `@copilotkit/core`

| File                                              | Score | Survived | No coverage | Mutants |
| ------------------------------------------------- | ----- | -------- | ----------- | ------- |
| `src/utils/markdown/complete-partial-markdown.ts` | 0.0%  | 0        | 497         | 497     |
| `src/memory-errors.ts`                            | 20.8% | 42       | 0           | 53      |
| `src/utils/http-agent.ts`                         | 42.4% | 18       | 1           | 33      |
| `src/utils/runtime-info-error.ts`                 | 50.0% | 15       | 0           | 30      |
| `src/chat/composer-layout.ts`                     | 54.1% | 102      | 44          | 318     |
| `src/open-generative-ui/placeholder.ts`           | 54.1% | 23       | 5           | 61      |
| `src/core/tool-schema.ts`                         | 56.0% | 17       | 5           | 50      |
| `src/chat/audio-recorder.ts`                      | 58.3% | 105      | 0           | 252     |
| `src/utils/abort-error.ts`                        | 59.3% | 9        | 2           | 27      |
| `src/threads-controller.ts`                       | 60.2% | 77       | 13          | 226     |

- `complete-partial-markdown.ts` is not untested: its only test is in
  react-core (`src/lib/__tests__/completePartialMarkdown.test.ts`), so a core
  run cannot see it. The test should move to core.

### `@copilotkit/runtime`

| File                                                           | Score | Survived | No coverage | Mutants |
| -------------------------------------------------------------- | ----- | -------- | ----------- | ------- |
| `src/runtime/intelligence-platform/learning-management.ts`     | 21.4% | 109      | 16          | 159     |
| `src/agent/state-delta.ts`                                     | 38.9% | 193      | 85          | 455     |
| `src/agent/learned-skills.ts`                                  | 41.1% | 33       | 0           | 56      |
| `src/runtime/handlers/handle-transcribe.ts`                    | 48.8% | 35       | 50          | 166     |
| `src/runtime/handlers/shared/intelligence-utils.ts`            | 52.4% | 16       | 4           | 42      |
| `src/runtime/intelligence-platform/learned-skills.ts`          | 54.0% | 114      | 2           | 252     |
| `src/runtime/intelligence-platform/trajectories.ts`            | 58.9% | 51       | 0           | 124     |
| `src/runtime/handlers/handle-connect.ts`                       | 59.0% | 3        | 13          | 39      |
| `src/runtime/intelligence-platform/skill-registry/registry.ts` | 60.2% | 89       | 17          | 266     |
| `src/runtime/endpoints/node-fetch-handler.ts`                  | 60.5% | 28       | 6           | 86      |

### `@copilotkit/react-core`

| File                                        | Score | Survived | No coverage | Mutants |
| ------------------------------------------- | ----- | -------- | ----------- | ------- |
| `src/hooks/use-attachments.tsx`             | 20.5% | 39       | 31          | 88      |
| `src/a2ui/A2UIRecoveryStates.tsx`           | 25.8% | 69       | 0           | 93      |
| `src/hooks/use-configure-suggestions.tsx`   | 42.4% | 19       | 0           | 33      |
| `src/hooks/use-render-tool.tsx`             | 43.3% | 12       | 5           | 30      |
| `src/a2ui/A2UIMessageRenderer.tsx`          | 44.6% | 35       | 1           | 65      |
| `src/lib/react-core.ts`                     | 59.1% | 11       | 7           | 44      |
| `src/hooks/use-frontend-tools.tsx`          | 60.0% | 18       | 0           | 45      |
| `src/hooks/tool-registration.ts`            | 66.1% | 33       | 8           | 121     |
| `src/hooks/use-render-activity-message.tsx` | 70.0% | 5        | 1           | 20      |
| `src/hooks/use-render-custom-messages.tsx`  | 75.0% | 4        | 2           | 24      |

## Tests that catch nothing

A test "kills nothing" when no mutant in its package's `src/` makes it fail.
The runs used `disableBail`, so every test that fails on a mutant is recorded,
not only the first.

| Package                                        | Tests that kill nothing | Test files that kill nothing | Test files with no unique kill |
| ---------------------------------------------- | ----------------------- | ---------------------------- | ------------------------------ |
| `@copilotkit/core`                             | 60 of 2479              | 2 of 152                     | 23 of 152                      |
| `@copilotkit/runtime`                          | 34 of 2980              | 1 of 181                     | 49 of 181                      |
| `@copilotkit/react-core` (in-scope test files) | 184 of 674              | 9 of 68                      | not measured                   |

"No unique kill" means every mutant the file kills is also killed by another
file, so deleting that one file lets no mutant survive. These files are
candidates for merging or deleting, not proof of rot: a file can be the
clearest test of a behavior and still overlap with others.

The three whole files in core and runtime that kill nothing are **false
positives**:

- `core/src/chat/__tests__/icons.test.ts` checks module-level icon data. All
  164 mutants in `icons.ts` are static, and static mutants were skipped.
- `core/src/chat/__tests__/renderer-types.test.ts` and
  `runtime/src/runtime/__tests__/handler-channels-types.test.ts` are type tests
  (`expectTypeOf`, `tsc`). Types have no runtime mutants.

### Test files with the most tests that kill nothing

**core**

| Test file                                         | Tests that kill nothing | Tests |
| ------------------------------------------------- | ----------------------- | ----- |
| `src/__tests__/debug-config-threading.test.ts`    | 3                       | 9     |
| `src/__tests__/message-filter.test.ts`            | 3                       | 100   |
| `src/chat/__tests__/labels.test.ts`               | 3                       | 7     |
| `src/__tests__/features.test.ts`                  | 2                       | 4     |
| `src/__tests__/proxied-runtime-transport.test.ts` | 2                       | 55    |
| `src/__tests__/state-manager-raw-event.test.ts`   | 2                       | 12    |

(Leaves out the two false-positive files above.)

**runtime**

| Test file                                                       | Tests that kill nothing | Tests |
| --------------------------------------------------------------- | ----------------------- | ----- |
| `src/agent/__tests__/standard-schema-types.test.ts`             | 7                       | 9     |
| `src/runtime/__tests__/mcp-apps-middleware-integration.test.ts` | 5                       | 10    |
| `src/runtime/__tests__/node-fetch-handler.test.ts`              | 3                       | 5     |
| `src/runtime/__tests__/agents-factory.test.ts`                  | 2                       | 8     |
| `src/runtime/__tests__/cross-surface-memory.test.ts`            | 2                       | 3     |
| `src/runtime/__tests__/node-fetch-handler-preparsed.test.ts`    | 2                       | 21    |

**react-core** (test files under the measured folders only)

| Test file                                                               | Tests that kill nothing | Tests |
| ----------------------------------------------------------------------- | ----------------------- | ----- |
| `src/providers/__tests__/CopilotChatConfigurationProvider.test.tsx`     | 38                      | 44    |
| `src/providers/__tests__/trajectory-wiring.test.tsx`                    | 31                      | 32    |
| `src/providers/__tests__/CopilotKitProvider.test.tsx`                   | 28                      | 44    |
| `src/lib/__tests__/renderSlot.test.tsx`                                 | 11                      | 31    |
| `src/providers/__tests__/CopilotKitProvider.stability.test.tsx`         | 11                      | 19    |
| `src/providers/__tests__/CopilotKitProvider.headersAtSendTime.test.tsx` | 10                      | 13    |
| `src/providers/__tests__/CopilotKitProvider.license.test.tsx`           | 10                      | 10    |
| `src/providers/__tests__/learning-wiring.test.tsx`                      | 8                       | 8     |
| `src/hooks/__tests__/use-agent-throttle.test.tsx`                       | 7                       | 37    |

react-core test files where every test kills nothing:
`CopilotKitProvider.license`, `learning-wiring`,
`CopilotKitProvider.messageFilter`, `cn`, `CopilotKitProvider.deferConnection`,
`CopilotKitProvider.onError`, `providers-exports`,
`CopilotKitProvider.deferWiring`, `CopilotKitProvider.licenseRace`.

Many provider tests check behavior that lives in `@copilotkit/core`. Mutants
in core are not part of a react-core run, so these tests can be useful and
still show as killing nothing here. Check each one before you delete it.

### Test files with no unique kill

<details><summary>core: 23 files</summary>

- `src/__tests__/agent-registry-preserve-instance.test.ts` (3 tests, 117 kills)
- `src/__tests__/core-follow-up.test.ts` (10 tests, 109 kills)
- `src/__tests__/core-parallel-tool-order.test.ts` (3 tests, 72 kills)
- `src/__tests__/core-tool-minimal.test.ts` (2 tests, 36 kills)
- `src/core/__tests__/run-handler-schema.test.ts` (3 tests, 32 kills)
- `src/core/__tests__/run-handler-zod-regression.test.ts` (20 tests, 32 kills)
- `src/__tests__/core-abort-during-tool.test.ts` (6 tests, 28 kills)
- `src/core/__tests__/run-handler-standard-schema.test.ts` (6 tests, 23 kills)
- `src/__tests__/core-tool-simple.test.ts` (2 tests, 19 kills)
- `src/__tests__/intelligence-redirect.test.ts` (8 tests, 17 kills)
- `src/__tests__/core-defer-runtime-connection.test.ts` (7 tests, 16 kills)
- `src/core/__tests__/record-annotation-transport.test.ts` (1 tests, 14 kills)
- `src/__tests__/core-agent-constraints.test.ts` (3 tests, 13 kills)
- `src/__tests__/core-run-agent-resume.test.ts` (3 tests, 9 kills)
- `src/__tests__/core-basic.test.ts` (2 tests, 8 kills)
- `src/__tests__/core-a2ui-scoping.test.ts` (4 tests, 7 kills)
- `src/__tests__/core-suggestions-capability.test.ts` (3 tests, 7 kills)
- `src/__tests__/core-wildcard.test.ts` (2 tests, 6 kills)
- `src/__tests__/debug-config-threading.test.ts` (9 tests, 5 kills)
- `src/__tests__/agent-registry-resync.test.ts` (1 tests, 4 kills)
- `src/__tests__/core-simple.test.ts` (1 tests, 4 kills)
- `src/chat/__tests__/labels.test.ts` (7 tests, 4 kills)
- `src/utils/__tests__/shallow-equal.test.ts` (5 tests, 4 kills)

</details>

<details><summary>runtime: 49 files</summary>

- `src/runtime/__tests__/thread-access.test.ts` (5 tests, 644 kills)
- `src/runtime/__tests__/fetch-router.test.ts` (52 tests, 367 kills)
- `src/runtime/__tests__/trajectory-learning-auth.test.ts` (8 tests, 329 kills)
- `src/runtime/__tests__/inspector-metadata-passthrough.test.ts` (4 tests, 257 kills)
- `src/runtime/__tests__/hooks-edge-cases.test.ts` (18 tests, 229 kills)
- `src/runtime/__tests__/hooks.test.ts` (22 tests, 224 kills)
- `src/runtime/__tests__/middleware-express.test.ts` (6 tests, 206 kills)
- `src/runtime/__tests__/channels-integration.test.ts` (2 tests, 203 kills)
- `src/runtime/__tests__/routing-express.test.ts` (9 tests, 203 kills)
- `src/runtime/__tests__/middleware-single-express.test.ts` (6 tests, 201 kills)
- `src/runtime/__tests__/middleware.test.ts` (6 tests, 201 kills)
- `src/runtime/__tests__/middleware-sse-route.test.ts` (1 tests, 197 kills)
- `src/runtime/__tests__/middleware-single.test.ts` (6 tests, 193 kills)
- `src/runtime/__tests__/license-telemetry-endpoints.integration.test.ts` (3 tests, 186 kills)
- `src/runtime/__tests__/express-single-sse.test.ts` (1 tests, 184 kills)
- `src/runtime/__tests__/routing-single.test.ts` (13 tests, 172 kills)
- `src/runtime/__tests__/fetch-hooks.test.ts` (6 tests, 169 kills)
- `src/runtime/__tests__/routing-single-express.test.ts` (8 tests, 168 kills)
- `src/runtime/__tests__/express-adapter.test.ts` (6 tests, 167 kills)
- `src/runtime/__tests__/express-body-order.test.ts` (2 tests, 161 kills)
- `src/runtime/__tests__/sse-license-telemetry.integration.test.ts` (1 tests, 150 kills)
- `src/runtime/__tests__/handler-channels-public-export.test.ts` (2 tests, 148 kills)
- `src/runtime/__tests__/sse-license-env-fallback.integration.test.ts` (1 tests, 146 kills)
- `src/runtime/__tests__/fetch-telemetry.integration.test.ts` (3 tests, 143 kills)
- `src/runtime/__tests__/express-telemetry.integration.test.ts` (3 tests, 142 kills)
- `src/runtime/__tests__/cross-surface-memory.test.ts` (3 tests, 135 kills)
- `src/runtime/__tests__/intelligence-history-lookup.test.ts` (3 tests, 130 kills)
- `src/agent/__tests__/factory-native-interrupt.test.ts` (2 tests, 120 kills)
- `src/runtime/__tests__/in-process-agent-runner.test.ts` (20 tests, 117 kills)
- `src/runtime/__tests__/inspector-learning-endpoints.test.ts` (2 tests, 117 kills)
- `src/agent/__tests__/system-prompt-native.test.ts` (2 tests, 115 kills)
- `src/runtime/__tests__/handle-stop-consumed-body.test.ts` (1 tests, 110 kills)
- `src/agent/__tests__/provider-id-collision.test.ts` (5 tests, 92 kills)
- `src/runtime/__tests__/in-process-agent-runner-messages.test.ts` (3 tests, 82 kills)
- `src/agent/__tests__/ai-sdk-v6-compat.test.ts` (1 tests, 63 kills)
- `src/runtime/intelligence-platform/__tests__/thread-update-identity.test.ts` (2 tests, 48 kills)
- `src/runtime/__tests__/express-single-telemetry.integration.test.ts` (1 tests, 46 kills)
- `src/runtime/__tests__/fetch-single-telemetry.integration.test.ts` (1 tests, 44 kills)
- `src/runtime/__tests__/telemetry-sampling-metadata.test.ts` (4 tests, 39 kills)
- `src/runtime/runner/__tests__/intelligence-backend-thread-id.test.ts` (2 tests, 38 kills)
- `src/agent/__tests__/converter-custom.test.ts` (11 tests, 29 kills)
- `src/runtime/__tests__/agent-header-precedence.test.ts` (2 tests, 29 kills)
- `src/runtime/telemetry/__tests__/global-properties.test.ts` (6 tests, 29 kills)
- `src/runtime/__tests__/telemetry-blank-license-identity.test.ts` (5 tests, 27 kills)
- `src/agent/__tests__/ag-ui-tool-validation.test.ts` (6 tests, 21 kills)
- `src/agent/__tests__/nullable-tools.test.ts` (3 tests, 21 kills)
- `src/runtime/__tests__/web-crypto.test.ts` (25 tests, 16 kills)
- `src/runtime/core/__tests__/debug-event-bus.test.ts` (8 tests, 12 kills)
- `src/agent/__tests__/standard-schema-types.test.ts` (9 tests, 1 kills)

</details>

## Limits of this baseline

- One run per package, on a shared machine. Timeouts are noisy (see above).
- Only mutants in the package's own `src/` count. A test that guards another
  package's code kills nothing here.
- Static mutants are skipped, so tests of module-level data look idle.
- Type-level tests always kill nothing.
- react-core covers 8% of its mutants (1,398 of 17,771).

## Reproduce

```sh
pnpm nx run @copilotkit/core:test:mutation
pnpm nx run @copilotkit/runtime:test:mutation
pnpm nx run @copilotkit/react-core:test:mutation -- --mutate "src/hooks/**/*.ts,src/hooks/**/*.tsx,src/providers/**/*.ts,src/providers/**/*.tsx,src/lib/**/*.ts,src/lib/**/*.tsx,src/types/**/*.ts,src/a2ui/**/*.ts,src/a2ui/**/*.tsx,src/context.ts,!src/**/__tests__/**,!src/**/*.test.ts,!src/**/*.test.tsx"
pnpm nx run repo-scripts:mutation-report
```

Wall time on an 18-core laptop shared with other work: core 3h40m at 8
workers, runtime 5h50m at 6 workers, react-core (scoped) 2h25m at 10 workers.
