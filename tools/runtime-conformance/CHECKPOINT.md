# Runtime checkpoint: 2026-09-08

## UI and analytics checkpoint

The goal remains active. TypeScript is the fifth supported implementation.
Only IntelligenceRunner is in scope. The four new libraries do not use other runners.
The public website must use simple-english for its text and diagram captions.

The shared suite contains 43 cases: 16 initial cases, 16 UI cases, and 11 additional analytics cases.
Python, Go, Ruby, and C# pass all 43 cases in the language-agent runs.
The parent reran Python, Go, and Ruby successfully. The first C# parent run found an agent-scope error.
The C# fix prevents scoped-out MCP requests from reaching the agent. Its final 43-case run passed.
The parent reran that final C# state successfully before this checkpoint.

The suite covers atomic A2UI component trees, progressive data, action history, catalog selection,
custom tools, cycles, duplicate IDs, MCP tool calls, iframe requests, server scope, and transport credentials.
MCP credentials remain outside agent inputs, persisted events, and analytics.
The fixture verifies session removal, not only receipt of a DELETE request.
Native authenticated HTTP headers, session deletion, and pre-connection rejection improve the pinned TypeScript behavior.

Analytics uses the existing TypeScript event names and properties, Unix seconds, sampling weights,
opt-out flags, header-only identity, and safe error codes. Native exporters have bounded queues and shutdown.
The TypeScript baseline has no OpenTelemetry spans or metrics. No new OTel system is required for analytics parity.

Native checks passed: Python 31 tests, Ruff, mypy, wheel and source distribution;
Go 21 tests with the race detector, vet, formatting, and build;
Ruby 26 tests with 79 assertions, syntax, and gem build;
C# 39 assertions and all four Nx targets with no warnings.
The parent reran the native Nx targets. Go required the documented Command Line Tools override.

The TypeScript driver mounts the actual public runtime package and auto-wired IntelligenceAgentRunner.
Its first full run passed 34 of 43 cases. Six MCP cases exposed missing authentication or scope checks.
One analytics case used an incomplete connect input. That fixture now uses complete RunAgentInput.
The other failures concern error analytics and strict base-path routing.
All TypeScript A2UI, discovery, and run cases passed in separate runs.
The TypeScript stop-ownership fix has 96 passing focused tests and awaits its own commit.

Latest parent commands:

```sh
NX_DAEMON=false pnpm nx run-many -p runtime-python,runtime-go,runtime-ruby,runtime-dotnet,runtime-conformance -t lint,test,check-types,build --parallel=4
DEVELOPER_DIR=/Library/Developer/CommandLineTools GOFLAGS=-ldflags=-linkmode=external NX_DAEMON=false pnpm nx run-many -p runtime-go -t lint,test,build
NX_DAEMON=false pnpm nx run runtime-python:typecheck
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- uv run --project packages/runtime-python python packages/runtime-python/examples/conformance.py
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- /tmp/cpk-runtime-go-telemetry
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- ruby packages/runtime-ruby/examples/conformance.rb
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- dotnet packages/runtime-dotnet/driver/bin/Release/net9.0/Runtime.Driver.dll
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- node tools/runtime-conformance/typescript-driver.mjs
```

The separate wiki project is `/Users/mikeryan/Repos/cpk/runtime-wiki`.
Its first local preview is open. Three diagrams and a social image exist.
The architecture and factory diagrams include all five languages. The text uses simple-english.
The site is not complete or published. It must explain final APIs, guarantees, evidence, and exclusions.
There is no PR yet. No packages were published.

Next requirements:

1. Carry MCP safety and analytics fixes into TypeScript, with the same shared tests.
2. Complete IntelligenceRunner recovery, batching, cancellation, lock renewal, backpressure, and shutdown checks in all five languages.
3. Finish canonical identity, memory-policy, entitlement, history, and malformed-input checks.
4. Review library APIs and artifacts. Add CI matrices and browser integration evidence. Complete real Rails run coverage.
5. Finish the simple-english wiki, publish it publicly, and open the reviewed PR with its link.

## Earlier core checkpoint

## State

The goal remains active. This checkpoint is not a production-readiness claim.
All four native drivers pass the initial 16 shared cases: 64 passing case executions.
The parent agent reran each suite after the language workers finished.
The harness has six passing self-tests and no lint warnings.

The libraries use native ASGI, net/http, Rack/Rails, and ASP.NET Core adapters.
They return Intelligence connection credentials after an authenticated Phoenix join.
They publish agent events with stable IDs and sequence numbers.
The shared fault test proves replay after persistence and disconnect without another agent invocation.
The HTTP agent fixture obtains its text from AIMock. No live model key was used.

Native checks passed: Python pytest/Ruff/mypy/wheel/sdist, Go tests/race/vet/build/gofmt,
Ruby tests/syntax/gem build, and C# assertions/build with warnings as errors.
Ruby syntax checking and C# compilation are the current `lint` targets, not full style analyzers.
The Rails mount example exists, but a full Rails application test remains pending.
The C# package targets .NET 9. Other target frameworks remain unverified.

## Review fixes

Go initially forwarded private thread suffixes to the platform.
A regression test demonstrated 12 unauthorized calls before the route allowlist fix.
Private lock, connect, and unknown suffixes now return 404 without upstream requests.

C# initially treated a configured memory callback returning null as no policy.
A regression test failed before the fix and passed afterward.
Null policy results now return 403 before platform access.
Another test proves unknown route segments do not enter C# telemetry.

The harness initially created an unhandled rejection when a driver executable was missing.
Its new regression test failed before the process-close promise fix and passes afterward.

## Commands run

```sh
NX_DAEMON=false pnpm nx run-many -t test,lint -p runtime-conformance
DEVELOPER_DIR=/Library/Developer/CommandLineTools GOFLAGS=-ldflags=-linkmode=external NX_DAEMON=false pnpm nx run-many -t test,lint,build,typecheck,check-types -p runtime-go,runtime-python,runtime-ruby,runtime-dotnet --parallel=4 --skip-nx-cache
CGO_ENABLED=0 NX_DAEMON=false pnpm nx run runtime-go:build --command='go build -o /tmp/cpk-runtime-go-conformance ./cmd/conformance'
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- /tmp/cpk-runtime-go-conformance
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- uv run --project packages/runtime-python python packages/runtime-python/examples/conformance.py
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- ruby packages/runtime-ruby/examples/conformance.rb
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- dotnet packages/runtime-dotnet/driver/bin/Release/net9.0/Runtime.Driver.dll
pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts --reporter=silent
git diff --cached --check
```

The local Xcode installation fails to load a required library.
Go race checks passed with the Command Line Tools path and external linking.
The isolated driver build passed with CGO disabled.
Nx caching is disabled for native targets until their source and artifact inputs have complete coverage.
The first focused checks shared the main checkout's installed Node dependencies and disabled the Nx daemon.
After broad pre-commit checks failed, the worktree received its own frozen-lockfile dependency install.
The broad hook result remains a separate gate from the passing native checks.
The pnpm lockfile adds only the new projects and harness dependency entries.

## Next required work

1. Add native MCP Apps and A2UI middleware, with shared executable cases for UI activity, tool execution, and iframe/action reentry.
2. Expand recovery tests for canonical ID remapping, dropped ACKs, lock expiry, stop ownership, shutdown, history replay, and malformed upstream data.
3. Complete bounded telemetry exporters, opt-out, sampling, traces/metrics, and failure isolation in every library.
4. Review API ergonomics and package artifacts, add CI/toolchain matrices, and verify real frontend compatibility and Rails hosting.
5. Build the public Sites wiki, generate architecture images, review/cull the full change, and open the CopilotKit PR with the site link.

There is no PR or published site yet. No packages were published.
The first generated diagram is saved locally at `output/runtime-wiki/architecture.png` for the future site.

## A2UI reference correction

The main checkout's installed A2UI middleware is stale (`0.0.5`).
The current runtime manifest and lockfile require `@ag-ui/a2ui-middleware@0.0.10` and toolkit `0.0.4`.
Use those exact versions for the ports.
The inspected source maps are in `/tmp/cpki-a2ui-audit.NEbRkW/package/dist/index.js.map`
and `/tmp/cpki-a2ui-audit.NEbRkW/toolkit/package/dist/index.js.map`.
These files are temporary references, not build inputs. Download the pinned packages again if necessary.

Version 0.0.10 emits atomic validated component arrays and progressive `data.items`.
It uses `a2ui-surface-${outerCallId ?? callId}` as the stable activity ID.
It emits building, retrying, and failed states on that ID.
The adapter owns actual model retries. The middleware reports recovery state.
Catalog precedence is configured default, frontend schema context, streamed non-basic catalog, then the basic URL.
Validation checks component IDs/types, roots, catalog membership, required properties, child references, and cycles.
The validator is not a general JSON Schema validator.

MCP Apps remains `@ag-ui/mcp-apps-middleware@0.0.3`.
Required behavior includes Streamable HTTP discovery/execution, `mcp-apps` activity snapshots,
and allowlisted `__proxiedMCPRequest` reentry without calling the agent.
The legacy MCP SSE transport remains a candidate for a disclosed exclusion.
