# CopilotKit Intelligence Runtime for Ruby

Native Ruby runtime for Rack and Rails. It requires Intelligence and has no
open-source runner, GraphQL dispatch, single-route mode, or Node process.
This package is under review and has not been published.

## Install from this checkout

```ruby
# Gemfile
gem 'copilotkit-runtime', path: '/path/to/CopilotKit/packages/runtime-ruby'
```

Run `bundle install`. The runtime requires Ruby 2.7 or later and the `websocket`
gem for protocol framing. HTTP, TLS, SSE, and concurrency use Ruby libraries.

## Mount in Rails

See [examples/rails.rb](examples/rails.rb) for a Devise/Warden initializer.
The runtime implements Rack's `call(env)` interface and mounts in Rails routes:

```ruby
mount Rails.application.config.x.copilotkit_runtime => '/copilotkit'
```

`identify_user` must resolve the authenticated application user and return a
hash with string keys `id` and optional `name`. Returning `nil` denies access.
Do not trust user IDs sent in request bodies, query strings, or arbitrary headers.
The conformance example's test headers are for local testing only.

Create the runtime after a worker forks. Call `close(timeout: 10)` in the
application server's worker shutdown hook so runs release their locks and the
telemetry exporter closes. The timeout covers the drain phase; platform cleanup
also has a bounded HTTP timeout.

## Configure

`api_key` and `identify_user` are required. Set `api_url`, `runner_url`, and
`client_url` together for self-hosting. Runner/client URLs end in `/runner` and
`/client`; do not include `/websocket`. TLS checks certificate trust and hostnames.
Secrets stay on server requests and never appear in runtime responses or telemetry.

`agents` maps agent IDs to native `CopilotKit::Agent` subclasses or `HttpAgent`
instances. Native agents implement `each_event(input)` and yield AG-UI event
hashes. Keep mutable state local to each invocation. `HttpAgent` incrementally
reads an AG-UI SSE endpoint and accepts server-configured request headers.

`memory_access` resolves a trusted grant for each request:

```ruby
memory_access: ->(user, env) { { 'user' => 'read-write', 'project' => 'none' } }
```

Each scope accepts `none`, `read`, or `read-write`. Both default to `none`.
The runtime forwards the immutable identity/grant headers to Intelligence for
final resource authorization. `learning_container` optionally selects a stable
container ID from `(user, input)`. A thread must keep the same container.

`cors_origins` is an explicit allowlist. No origins receive CORS headers by default.
`base_path` is useful with a raw Rack server; leave it empty when Rails strips the mount path.

## Wire behavior

The app serves `/info`, `/agent/:id/run`, `/agent/:id/connect`, thread list,
inspection, mutation and subscription routes, memory CRUD/recall/subscription
routes, and `/annotate` under the mount path.

A run resolves ownership, creates a missing thread, handles a concurrent-create
conflict, acquires the platform lock, and loads persisted messages. It uses the
platform's canonical thread/run IDs. The HTTP success response waits for an
authenticated Phoenix channel join. The agent executes in the worker process.

The runner stamps each event with canonical IDs, a stable UUID, and an increasing
sequence number. It waits for an ACK before reading the next event. Reconnect
replays the same event without rerunning the agent. Retries are bounded to four
attempts. A heartbeat renews the platform lease every ten seconds. Completion,
failure, and shutdown release the lock.

## Telemetry

Analytics uses the TypeScript runtime's five event names and property shapes.
Events report instance creation, run/connect requests, and agent start, completion,
or failure. Failed runs emit an error event with a fixed code, not a completion
event. Timestamps use integer Unix seconds. Payloads contain no prompts, user IDs,
thread/run IDs, credentials, route strings, or dependency error messages.

The default HTTP sink is `https://telemetry.copilotkit.ai/ingest`.
`COPILOTKIT_TELEMETRY_URL` changes it. A server can also pass
`Telemetry.new(url: endpoint)`, or provide an application exporter with
`Telemetry.new(exporter: ->(event) { ... })`.

The default sample rate is `0.05`. Set `sample_rate:` to change it;
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides that option. Values must be finite
numbers from zero through one; invalid values use the default. Events include
the sample rate and weight. `telemetry_id:` takes precedence over
`CPK_TELEMETRY_ID`. A valid ID contains 1–128 letters, digits, underscores, or
hyphens after trimming spaces and tabs. It travels only in the
`X-CopilotKit-Telemetry-Id` header and does not bypass sampling.

Set `disabled: true`, or set either `DO_NOT_TRACK` or
`COPILOTKIT_TELEMETRY_DISABLED` to `true` or `1`, to disable analytics.
Opt-out wins over sample rate and identity. The exporter queues at most 256
events and drops new events when full. Each export has a three-second timeout,
does not follow redirects, and cannot fail a runtime request. `flush(timeout:)`
waits for queued events; `close(timeout:)` drains and stops the worker within
its deadline. The conformance driver uses the library exporter with a local sink.

Use the separate runtime `on_error:` callback for application error reporting.
It receives the native exception. Callback failures do not affect HTTP responses
or agent cleanup. This callback never copies errors into analytics.

## A2UI and MCP Apps

Pass `a2ui: { 'injectA2UITool' => true, 'schema' => catalog }` to inject the
render tool, usage context, and server-owned component schema. A string value
for `injectA2UITool` selects a custom tool name. Set `agents` to an array of
agent IDs to limit A2UI to those agents. `enabled: false` disables it.

The middleware follows A2UI middleware 0.0.10 and toolkit 0.0.4 semantics:
complete component arrays pass root, ID, type, required-property, reference,
and cycle checks before painting. Complete data items can then paint during
streaming. Building, retrying, failure, and painted states share one activity
ID. Browser actions append synthetic tool history. Adapter-owned model retries
remain the agent's responsibility; the runtime reports recovery state.

Use `defaultCatalogId` to select the host catalog. Otherwise the runtime uses
the frontend schema's catalog ID, a streamed non-basic ID, or the basic catalog
URL, in that order. Binding resolution and general JSON Schema validation are
not part of the streaming semantic gate, matching the reference middleware.

MCP Apps configuration is server-owned:

```ruby
mcp_apps: { 'servers' => [{
  'type' => 'http', 'url' => 'https://mcp.example.com/mcp',
  'serverId' => 'cards', 'agentId' => 'default',
  'headers' => { 'authorization' => ENV.fetch('MCP_AUTHORIZATION') }
}] }
```

The runtime initializes Streamable HTTP sessions, forwards session credentials,
discovers UI tools, injects tool schemas, executes pending UI calls, and persists
`mcp-apps` activity snapshots with the result and resource URI. The iframe can
reenter through `__proxiedMCPRequest` with a configured server ID/hash. Only
`tools/call`, `resources/read`, `notifications/message`, and `ping` are allowed.
Reentry bypasses the agent and cannot select a browser-supplied server URL.
Session headers stay on MCP HTTP requests. Legacy MCP SSE discovery transport
is excluded; SSE responses to Streamable HTTP requests are supported.

## Validation and remaining work

From the repository root:

```sh
NX_DAEMON=false pnpm nx run-many -t test,lint,build -p runtime-ruby
node tools/runtime-conformance/run.mjs -- ruby packages/runtime-ruby/examples/conformance.rb
```

All 43 shared socket, UI, and analytics cases pass, including lost-ACK reconnect, join
rejection, ownership, API mutations, validation, and AIMock agent execution.
Local tests cover denied identity, memory grants, startup validation, and safe
telemetry. A gem build checks the installable artifact.

User-requested cancellation, distributed stop signaling, suggestions,
and Inspector metadata are not yet implemented. Analytics matches the reference
TypeScript runtime; OpenTelemetry is not a dependency or claimed capability.
Rails boots, certificate-failure cases, prolonged lease loss,
high concurrency, and shutdown deadlines need integration coverage before a
production-readiness claim. The shared suite is one gate, not release approval.
