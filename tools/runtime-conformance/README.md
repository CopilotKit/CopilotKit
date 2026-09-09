# Runtime conformance

Run the same socket tests against each runtime library:

```sh
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- ruby packages/runtime-ruby/examples/conformance.rb
```

Use `--filter` before the command separator to select a stable case ID:

```sh
node tools/runtime-conformance/run.mjs --filter run.replay-after-disconnect -- ruby packages/runtime-ruby/examples/conformance.rb
```

The Nx target uses the same runner. The direct command also supports external agent tooling that supplies its own process supervisor.

## Test boundary

Each case starts a fresh native driver and a fresh platform fixture on loopback ports.
TypeScript uses the existing public runtime package through `typescript-driver.mjs`.
It is the fifth supported implementation, not only a reference.
Only the Intelligence Runner is in scope for all five languages.
The driver receives configuration through `CPK_CONFIG` and reports its port as one JSON line.
The harness calls the public runtime API under `/copilotkit`.
It records the runtime's platform HTTP calls and authenticated Phoenix frames.
Agent completions come from AIMock. Tests do not load `.env` or contact a live model.

The fixture checks project-key authentication, app-user ownership, locks, event order, and immutable replay.
It acknowledges an event only after recording that event.
Fault cases drop the acknowledgment or close the socket after persistence.
A reconnect must resend the same event and must not restart the agent.

The test suite also verifies that an HTTP-200 stub fails conformance.
An empty case selection is an error.

## Driver configuration

| Key                   | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `port`                | Listen on this loopback port. Zero requests an available port. |
| `apiUrl`              | Platform HTTP base URL                                         |
| `runnerUrl`           | Phoenix runner base URL, ending in `/runner`                   |
| `clientUrl`           | Browser realtime base URL, ending in `/client`                 |
| `apiKey`              | Fixture project key                                            |
| `agentUrl`            | Fixture AG-UI HTTP agent                                       |
| `telemetryUrl`        | Fixture analytics collector                                    |
| `telemetrySampleRate` | One for deterministic lifecycle assertions                     |
| `telemetryDisabled`   | Explicit analytics opt-out                                     |
| `telemetryId`         | Header-only analytics identity                                 |
| `licenseToken`        | Legacy token with an analytics identity claim                  |
| `a2ui`                | A2UI configuration for the selected case                       |
| `mcpApps`             | MCP server configuration for the selected case                 |

Each driver configures agent `default` and a trusted identity callback.
The callback uses `x-test-user-id` and `x-test-user-name`, with defaults `test-user` and `Test User`.
These headers exist only in the test driver. They are not a production authentication scheme.
The driver mounts the library without reimplementing routes, middleware, telemetry, or persistence.

## Current coverage limit

The suite has 70 cases. These include 16 initial cases, 16 UI cases, and 18 additional analytics cases.
Ten runner cases, nine access cases, and one frontend-client case cover the remaining requirements.
The UI cases cover A2UI validation, progressive data, action history, MCP calls, and iframe request boundaries.
Analytics cases cover canonical events, timestamps, sampling, identity, privacy, and opt-out.
Seven cases cover legacy license identity, environment fallback, whitespace rules, standalone identity precedence, malformed tokens, and opt-out precedence.
Runner cases cover batches, draining joins, planned restarts, final acknowledgments, and stop boundaries.
They also require input persistence before early stop or error and reject incomplete streams as successful runs.
The frontend-client case uses the public core package and real Phoenix sockets to run an agent and replay its history.
It runs in Node, not an actual browser. It does not prove browser layout or every recovery path.
Native tests cover additional cancellation, shutdown, and lease failures beyond the shared cases.
Access cases require current ownership, canonical stop IDs, valid stop input, agent scope, and memory denial before upstream access.
They distinguish omitted memory policy from explicit denial and check read-only writes and trusted identity headers.
The fixture's event journal is test evidence, not an implementation of the Intelligence database.
The wider requirements and remaining release gates live in [PLAN.md](PLAN.md).

## Build boundaries

`pnpm build` and `pnpm test` select JavaScript packages. They do not require native language toolchains.
`pnpm build:native-runtimes` and `pnpm test:native-runtimes` select the four native implementations.
The native commands require Python, Go, Ruby, and .NET. The five-language CI workflow installs each toolchain in its own job.

## Source references

The initial reference is TypeScript commit `862ff3c180`.
Browser route contracts live in `packages/runtime/src/v2/runtime/core/fetch-router.ts` and `handlers/intelligence/`.
Platform requests live in `intelligence-platform/client.ts`.
Phoenix delivery lives in `runner/intelligence.ts`.
Analytics contracts live in `telemetry/` and `packages/shared/src/telemetry/lambda-client.ts`.

The fixture makes one deliberate security requirement stronger than a route stub:
all runtimes must verify app-user ownership before exposing key-scoped inspector data.
The suite also requires trusted MCP HTTP headers, explicit session deletion, and blocked-method rejection before a connection.
These MCP requirements improve the pinned TypeScript middleware and must apply to TypeScript too.
Future case changes must cite their reference behavior or explain an intentional correction.
