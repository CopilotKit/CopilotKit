# Runtime conformance

Run the same socket tests against each native library:

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

Each driver configures agent `default` and a trusted identity callback.
The callback uses `x-test-user-id` and `x-test-user-name`, with defaults `test-user` and `Test User`.
These headers exist only in the test driver. They are not a production authentication scheme.
The driver mounts the library without reimplementing routes, middleware, telemetry, or persistence.

## Current coverage limit

The initial 16 cases cover core discovery, routing, connect, runs, thread and memory APIs, annotations, and analytics.
They do not yet prove MCP Apps, A2UI, browser replay, production telemetry exporters, cancellation, or full recovery deadlines.
The fixture's event journal is test evidence, not an implementation of the Intelligence database.
The wider requirements and remaining release gates live in [PLAN.md](PLAN.md).

## Source references

The initial reference is TypeScript commit `862ff3c180`.
Browser route contracts live in `packages/runtime/src/v2/runtime/core/fetch-router.ts` and `handlers/intelligence/`.
Platform requests live in `intelligence-platform/client.ts`.
Phoenix delivery lives in `runner/intelligence.ts`.
Analytics contracts live in `telemetry/` and `packages/shared/src/telemetry/lambda-client.ts`.

The fixture makes one deliberate security requirement stronger than a route stub:
native runtimes must verify app-user ownership before exposing key-scoped inspector data.
Future case changes must cite their reference behavior or explain an intentional correction.
