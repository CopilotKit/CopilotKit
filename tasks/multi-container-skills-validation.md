# Multi-container skill delivery validation

## Passed checks

- TypeScript: 36 focused runtime/BuiltInAgent tests, shared legacy conformance tests, native LangGraph and Mastra tests, type checks, and serial runtime/adapter builds. Runtime, LangGraph, and Mastra `publint` and `attw` checks passed.
- Python: `NX_DAEMON=false pnpm nx run-many -t test,lint,typecheck,build,verify-distribution -p intelligence-delivery-python-core,intelligence-langgraph-python,intelligence-adk-python --parallel=3` passed. Tests: 92 core, 18 LangGraph, 19 ADK. Standalone wheel consumers passed.
- .NET: `PATH=/tmp/copilotkit-dotnet9:$PATH DOTNET_ROOT=/tmp/copilotkit-dotnet9 NX_DAEMON=false pnpm nx run-many -t test,build,pack,verify-distribution -p intelligence-agent-framework-dotnet --parallel=1` passed. Build reported zero warnings and errors. Standalone NuGet consumer passed.
- Product docs: 7 focused tests, type check, and full Next build passed in `showcase/shell-docs`.
- CLI companion: 31 focused tests, 5 built-CLI end-to-end tests, local build, CLI lint/typecheck, cli-e2e typecheck, and `pnpm docs:check` passed. CLI lint reported four existing warnings outside this change.

## Review

Independent specification and code quality reviews completed. Python now rejects whitespace-only pins and invalid Unicode identifiers before any request, consistent with TypeScript and .NET. The final reviews reported no remaining findings.

## Limits

No live-server acceptance test or minimum/latest framework-version matrix was run. ADK emitted existing experimental-feature warnings.

The broad `test-packages` commit hook reached unrelated downstream packages outside the scoped dependency installation and failed on the missing `@copilotkit/typescript-config/base.json` dependency in web-inspector. Concurrent runtime builds also collided in their shared output directory. The final runtime and adapter builds ran serially and passed, followed by successful package checks. Commits excluded only the broad `test-packages` hook after these explicit scoped checks; the remaining hooks ran.

No packages were published, and no pull requests were merged.

## Batch transport follow-up

The SDK containers interface now uses one POST for all sources due for refresh. The CLI uses one product-authenticated POST for multiple downloads. Legacy single-container requests stay unchanged.

Passed after the batch changes:

- TypeScript: 95 runtime transport/registry/BuiltInAgent/type-fixture tests, 89 delivery-core tests, 41 LangGraph tests, and 22 Mastra tests. Runtime and adapter type checks and serial builds passed. Fresh `publint` and `attw` checks passed for Runtime, LangGraph, and Mastra.
- Runtime server: 51 route/auth/registry/snapshot tests. Product batch route and credential integration tests passed, along with 44 CLI unit tests and 5 built-CLI end-to-end tests. App API and CLI lint/typecheck/build passed. CLI lint retains four existing warnings.
- Python: 325 canonical runtime tests, 98 core tests, 18 LangGraph tests, and 19 ADK tests. Lint, typecheck, builds, and standalone distribution checks passed for all four projects. The ADK tests emitted two existing experimental warnings.
- .NET: tests, build, pack, and standalone NuGet distribution verification passed for runtime-dotnet and intelligence-agent-framework-dotnet. The private .NET 9 install used `DOTNET_ROLL_FORWARD=Major` to run net8 tests.
- Product docs: 7 focused tests, type check, full Next build. Intelligence `pnpm docs:check` passed.
- Actual-source SDK/server smoke: a TypeScript registry called the production Express route over localhost. Two containers used one POST with independent pins. The second request sent per-source ETags. Revocation stayed blocking through a later server outage. The database reads and runtime auth context were dependency-injected.

Database-backed acceptance was attempted but could not run without `APP_LEARNED_SKILLS_TEST_DATABASE_URL`. Standalone App API test-tsconfig checks hit existing `TS6059`/`TS6307` workspace rootDir errors; normal App API typecheck passed. No deployed-server or framework-version matrix acceptance was run. The server batch endpoints must deploy before clients use the new containers interface.

Batch validation commands (run from the matching repository root unless stated):

```sh
# CopilotKit
NX_DAEMON=false pnpm nx run-many -t lint,typecheck,test,build,verify-distribution -p runtime-python,intelligence-delivery-python-core,intelligence-langgraph-python,intelligence-adk-python --parallel=4
PATH=/tmp/copilotkit-dotnet9:$PATH DOTNET_ROOT=/tmp/copilotkit-dotnet9 DOTNET_ROLL_FORWARD=Major NX_DAEMON=false pnpm nx run-many -t test,build,pack,verify-distribution -p runtime-dotnet,intelligence-agent-framework-dotnet --parallel=1
NX_DAEMON=false pnpm nx run-many -t check-types,build -p @copilotkit/intelligence-delivery-core,@copilotkit/intelligence-langgraph,@copilotkit/intelligence-mastra --parallel=1
NX_DAEMON=false pnpm nx run-many -t publint,attw -p @copilotkit/runtime,@copilotkit/intelligence-langgraph,@copilotkit/intelligence-mastra --parallel=1 --skip-nx-cache
# Intelligence
pnpm nx test @cpki/app-api -- src/routes/learned-skill-delivery-routes.spec.ts src/runtime-auth.spec.ts src/learning/learned-skill-registry.spec.ts src/learning/learned-skill-snapshot.spec.ts
pnpm nx run-many -t lint,typecheck,build -p @cpki/app-api
pnpm docs:check
# showcase/shell-docs
npm run test -- src/lib/__tests__/learned-skills-mastra.test.ts src/lib/__tests__/intelligence-landing.test.ts
npm run typecheck
npm run build
```

Specification and code quality reviews found no remaining issues. The specification review caught an injected Python client returning `None`, which could call the legacy transport. The registry now rejects that value, and a regression test proves that no single-container request occurs.
