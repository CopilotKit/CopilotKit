# Core checkpoint: 2026-09-08

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
