# Shared regression evidence

## Agent event identity

Baseline: `d6de4ddd0f4ad09f4d0d07312cd07b945b519b54`.
Case: `runner.agent-cannot-forge-event-identity`.

The case sends two distinct agent events with the same forged durable event ID and sequence.
The TypeScript runtime failed with `Agent-supplied identity reached the durable gateway` before the fix.
The runner now removes agent-controlled durable identity before it assigns its own values.
Other metadata remains intact. Internal retries retain the assigned identity.

This intentionally strengthens the TypeScript reference in `packages/runtime/src/v2/runtime/runner/intelligence.ts`.
The durable gateway requires unique event IDs and consecutive sequence numbers.
An agent cannot assign these transport fields or collapse distinct events into one.

The following command failed before the fix and passed after the public runtime build:

```sh
pnpm nx run runtime-conformance:conformance -- --filter runner.agent-cannot-forge-event-identity -- node tools/runtime-conformance/typescript-driver.mjs
```

## Late A2UI identifiers

Baseline: `d6de4ddd0f4ad09f4d0d07312cd07b945b519b54`.
Case: `a2ui.late-identifiers-preserve-painted-surface`.

The case sends complete components before the surface ID, catalog ID, and progressive data.
Python failed with `A late surfaceId must not replace a painted surface`.
.NET failed with `A late catalogId must not replace a painted catalog`.
TypeScript already passed the same case.
Both fixes retain the surface and catalog from the first painted components.
Later data updates still reach that surface.

This preserves the streaming identity contract in the TypeScript A2UI middleware.
The following commands failed before the fixes and passed after them:

```sh
pnpm nx run runtime-conformance:conformance -- --filter a2ui.late-identifiers-preserve-painted-surface -- packages/runtime-python/.venv/bin/python packages/runtime-python/examples/conformance.py
pnpm nx run runtime-conformance:conformance -- --filter a2ui.late-identifiers-preserve-painted-surface -- dotnet packages/runtime-dotnet/driver/bin/Release/net9.0/Runtime.Driver.dll
```

The .NET command requires a rebuilt driver after a source change.
These results come from local socket tests against the shared platform fixture.
They do not claim deployed-service or browser validation.

## Aggregate CI gate

The scope test first failed because the stub did not select a runtime source change.
The result test first failed because the stub rejected a complete successful matrix.
Both passed after the gate implementation.
The rejection cases cover failed, cancelled, missing, and unexpectedly skipped jobs.
A real Git rename test also failed when a runtime file moved outside `packages/`.
The scope command now disables rename detection so it includes deleted paths. The same test then passed.

```sh
node --test tools/runtime-conformance/test/gate.test.mjs
```

## CI scope cost

The unrelated-frontend case failed because any `packages/` path triggered all native jobs.
The gate now selects runtime packages and the `core`, `shared`, and `aimock` test dependencies.
The same test passes for changes confined to React packages and documentation scripts.

## Preserve completion analytics after RUN_ERROR (human review)

Source: `packages/runtime/src/v2/runtime/handlers/intelligence/run.ts` on main
`e2702705e9` captures `agent_execution_stream_ended` whenever the runner observable completes.
A `RUN_ERROR` event does not prevent that completion callback. The PR had changed this
count while removing private error text. That count change was not part of the privacy fix.

The existing `telemetry.error-content-is-private` case now requires one error event and
one completion event after a terminal `RUN_ERROR`, while retaining every privacy assertion.
Before the fix, TypeScript, Python, Go, .NET, and Ruby/Rack all timed out waiting for the
completion event. The TypeScript unit tests also failed their completion-event assertions.

Each runtime now separates stream completion from the error outcome. Raw upstream messages
and error codes remain excluded from analytics. Observable errors and startup rejection
still do not create a TypeScript completion event. The GTM month-close query was not available;
this correction restores the existing event behavior rather than changing its meaning.

Focused reproduction:

```sh
node tools/runtime-conformance/run.mjs --filter telemetry.error-content-is-private -- node tools/runtime-conformance/typescript-driver.mjs
```

All 102 shared cases passed on TypeScript, Python, Go, .NET, Ruby/Rack, and Ruby/Rails
after the correction (612 executions). TypeScript runtime tests (2,339), native tests,
typechecks, builds, and native lint passed. The harness passed its 23 tests, including
negative stub rejection. This is local socket and unit evidence, not deployed-service proof.

## Preserve shipped route matching and SDK update precedence (human review)

Source: the router and `updateThread` implementation on main `e2702705e9`.
The TypeScript router accepts known suffix routes inside an explicit base path.
The trusted server SDK applies `updates` after explicit user and agent fields.
The PR had changed both behaviors without requiring a migration.

Four route tests and the SDK update test failed against the changed behavior, then
passed after restoring the shipped implementations. Browser thread mutations still
remove untrusted identity fields at the HTTP handler. The shared
`threads.trusted-identity-and-mutations` case passes through the real runtime.

The full TypeScript suite then exposed a fixture error at
`routing.no-legacy-dispatch`: it expected `/unknown/info` to return 404 even though
`/info` is a supported TypeScript suffix route. That negative assertion now uses
`/unknown/not-a-route`, which has no supported suffix. The separate TypeScript
route tests retain positive suffix-matching assertions. The rejection of JSON
single-route dispatch and unknown agents remains unchanged.

## Calibrate foreign-thread privacy against the platform service

Source: Intelligence commit `c5265330cee3d9e8d42d262f3a20cb72fb6fe33b`,
`apps/app-api/src/routes/threads-routes.ts` (`assertThreadUserOwnership` and
`getThreadForAppUser`) and `apps/app-api/src/errors/registry.ts` (`THREAD_NOT_FOUND`).
The service hides a foreign thread with HTTP 404, the same as a missing thread.
Its `appUserBodySchema` accepts the runtime's `userId` alias.

The fixture instead returned 403. A direct fixture test failed with `403 !== 404`
before the correction. The fixture and the three shared ownership-status assertions
now require 404. Assertions that a foreign caller cannot stop the agent or access
thread data remain unchanged. Agent mismatch and memory-policy denials remain 403.

This is source calibration against the platform repository, not deployed-platform
execution. The previously recorded live-demo directory is absent from this workspace;
a current test-project configuration is still needed for hosted-service validation.

After both fixture corrections, all 102 shared cases pass on each of the six drivers
(612 executions). The harness passes 24 tests, including the independent ownership-status
fixture regression. This does not validate identity aliases or deployed-service behavior.

## Remove the TypeScript MCP fork (human review)

The local `IntelligenceMCPAppsMiddleware` implementation was removed in favor of
`@ag-ui/mcp-apps-middleware`. Its transport fixes now live in AG-UI PR #2718.
The CopilotKit integration retains the six real HTTP/SSE tests against the imported package.

Three new scope tests failed before the integration change: ordinary runs attached middleware
when no server was configured or selected, and the proxy path used the local implementation.
Ordinary runs now skip MCP middleware when no server is selected. Proxy requests still use
the upstream empty-server guard, preventing requests scoped to another agent from reaching
the model. Strict discovery preserves the prior failure boundary without a second implementation.

The draft pins upstream commit `b86ec049180a696b0a51957f75bea6d683390c54` by its exact
pkg.pr.new URL and integrity hash. A frozen install passes. Only that dependency's lock entries
changed; unrelated peer dependency resolution changes from installation were discarded.
A released AG-UI package must replace this preview before CopilotKit #6967 leaves draft.

The upstream package passes 82 tests, typecheck, build, and CI. The six downstream transport
tests and three scope tests pass. All 2,342 TypeScript runtime tests, typecheck, and build pass.

All 102 existing shared cases pass on each driver after extraction and fixture calibration.
The later human findings for identity aliases, deletion reasons, current MCP metadata,
Ruby heartbeat recovery, and .NET 8 support remain open and are not proved by that count.

## Browser identity aliases (human review, September 10)

Intelligence `c5265330` in `apps/app-api/src/routes/threads-routes.ts` resolves
`endUserId ?? end_user_id ?? userId`. The fixture previously accepted only `userId`.
The eight `access.thread-identity-*` cases now check both aliases on message reads,
thread lists, updates, and archives. They require rejection to match the same request
without a spoofed alias and verify that foreign thread data remains unchanged.
The TypeScript SDK maps these REST errors to 500; native runtimes preserve 404.
This change preserves those existing error mappings while closing the identity bypass.

RED: Go accepted all eight attacks; Ruby accepted updates and archives; TypeScript
accepted both update attacks. The response was 200 and the fixture exposed or changed
the victim thread. Go and Ruby now allowlist browser query/body fields; TypeScript
allowlists update fields before calling its trusted SDK. Focused cases pass on all three.

Commands: `node tools/runtime-conformance/run.mjs --filter access.thread-identity -- <driver>`.
Logs are `/tmp/pr6967-identity-{go,ruby,ts}-red*.log` and matching `*-green.log`.
Native Go/Ruby tests, lint, and build pass; TypeScript tests, typecheck, and build pass.
All 110 shared cases pass on each of the six drivers (660 local case executions).
These are local socket and unit tests, not deployed-platform or browser proof.

## Platform audit reasons, MCP metadata, and idle gateway recovery

The September 10 human review found three missing contract cases.

- Intelligence `c5265330` requires a trimmed deletion reason of 1 to 1000 characters
  in `apps/app-api/src/routes/threads-routes.ts`. The new
  `access.thread-delete-audit-reason` case failed with HTTP 400 in Python, Go, and Ruby.
  Each now supplies a generated audit reason. The fixture enforces the source schema.
- The current [MCP Apps metadata contract](https://apps.extensions.modelcontextprotocol.io/api/variables/server-helpers.RESOURCE_URI_META_KEY.html)
  prefers `_meta.ui.resourceUri` and retains the flat key as fallback.
  `mcp-apps.current-metadata-{nested,both}` failed discovery in TypeScript, Python, Go,
  and .NET; Ruby chose the legacy URI when both keys existed. All five now prefer
  current metadata. TypeScript consumes upstream AG-UI `258fa169`, which passed 84
  tests and all reported CI checks. This remains a draft-only preview dependency.
- `runner.idle-heartbeat-reconnect` closes the gateway during an idle heartbeat.
  Ruby rejoined only to emit its cancellation terminal event: the test found the
  agent disconnected while its platform lease remained valid. Bounded heartbeat
  recovery now keeps the agent alive and serializes reconnects with event ACKs.
  Actual platform renewal failures retain `LOCK_RENEWAL_FAILED`; exhausted gateway
  recovery uses `GATEWAY_UNAVAILABLE`. The focused case passes.

RED logs: `/tmp/pr6967-audit-{python,go,ruby}-red.log`,
`/tmp/pr6967-meta-go-red-corrected.log`, `/tmp/pr6967-meta-ruby-green.log`
(the initial Ruby run records the precedence failure), and
`/tmp/pr6967-heartbeat-ruby-red.log`. Rerun with
`node tools/runtime-conformance/run.mjs --filter <case-id> -- <driver>`.
All 114 cases pass on each of the six drivers (684 local case executions).

## .NET 8 and Agent Framework

The .NET 8 SDK rejected the former net9.0 projects (`NETSDK1045`). After changing
the target, the compiler also rejected `Convert.ToHexStringLower`.
Both libraries, drivers, and tests now target net8.0. Hex formatting uses
`ToHexString(...).ToLowerInvariant()` and preserves the existing hash assertions.
[System.Text.Json 9.0.20](https://www.nuget.org/packages/System.Text.Json/9.0.20)
supports .NET 8 and retains nullable-field checks and out-of-order metadata support;
no response validation was removed.

`pnpm nx run-many -t test,lint,check-types,build -p runtime-dotnet --parallel=1`
and `pnpm nx run-many -t test,pack -p runtime-dotnet --parallel=1` pass using the .NET 8 SDK. The test target includes an actual Microsoft Agent
Framework AG-UI server and the runtime's HTTP agent over loopback HTTP. Its model
is deterministic. Both packed libraries contain net8.0 assemblies. CI installs
.NET 8 and runs the same tests and complete shared suite. This does not prove
hosted-model, browser, or deployed-platform behavior.

## MCP model visibility and account selection

Baseline: `f2926a54e3c0b2140b95c3bd984c1ac6c0d96649`.
Review comments: `3983860329` and `3983860336` on CopilotKit PR #6967.

The five `mcp-apps.visibility-*` cases cover omitted, model, app, both, and empty visibility.
Before the fixes, `mcp-apps.visibility-app` failed in Python, Go, Ruby, and .NET:
`Explicit visibility must include model before a tool enters model input` (`true !== false`).
Discovery now excludes a tool when its explicit visibility does not include `model`.
The cases also call each tool through the iframe proxy and require a tool result without another agent invocation.
This preserves UI access independently of model visibility.
The released TypeScript MCP Apps middleware already passes these cases.
The source contract is the MCP Apps tool `_meta.ui.visibility` field and upstream middleware 0.1.0.

The four `mcp-apps.server-selection-*` cases register two accounts at one URL with distinct credential headers.
Before the fixes, every native runtime sent requests for an ambiguous hash and for an unknown explicit ID.
The assertion was `Ambiguous hashes and unknown explicit IDs must fail before sending credentials`:
Python sent five requests; Go, Ruby, and .NET sent four.
Go also failed `Explicit server ID must select its own credentials` for the second registered account.
Each runtime now resolves an explicit ID without falling back to the hash and requires exactly one matching registration.
The cases require zero MCP requests for rejected selections and inspect every outgoing credential header for accepted selections.
TypeScript middleware 0.1.0 already passes all four cases.

Use either `mcp-apps.visibility` or `mcp-apps.server-selection` as `CASE_FILTER`:

```sh
pnpm nx run runtime-conformance:conformance -- --filter "$CASE_FILTER" -- packages/runtime-python/.venv/bin/python packages/runtime-python/examples/conformance.py
pnpm nx exec --projects=runtime-go -- go build -o /tmp/pr6967-go-driver ./cmd/conformance
pnpm nx run runtime-conformance:conformance -- --filter "$CASE_FILTER" -- /tmp/pr6967-go-driver
pnpm nx run runtime-conformance:conformance -- --filter "$CASE_FILTER" -- ruby packages/runtime-ruby/examples/conformance.rb
pnpm nx run runtime-dotnet:build
pnpm nx run runtime-conformance:conformance -- --filter "$CASE_FILTER" -- dotnet packages/runtime-dotnet/driver/bin/Release/net8.0/Runtime.Driver.dll
pnpm nx run runtime-conformance:conformance -- --filter "$CASE_FILTER" -- node tools/runtime-conformance/typescript-driver.mjs
```

These are local HTTP and Phoenix socket tests. They do not prove browser UI behavior or deployed-service compatibility.
They do not establish support for MCP protocol revision `2026-07-28`.
