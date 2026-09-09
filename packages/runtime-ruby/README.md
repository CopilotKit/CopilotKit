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

Pass `Telemetry.new(exporter: ->(event) { ... })`. Events use the TypeScript
runtime's lifecycle names and package/global-properties envelope. Additional
events report retries and failed cleanup. Attribute allowlisting excludes
prompts, messages, IDs, credentials, and dependency error bodies. Exporter errors
do not fail application requests. Exporters can implement `close` to flush.

Set `disabled: true`, `DO_NOT_TRACK=1`, or
`COPILOTKIT_TELEMETRY_DISABLED=true` to suppress export. No network exporter is
enabled by default. The driver posts telemetry only to the local harness fixture.

## Validation and remaining work

From the repository root:

```sh
NX_DAEMON=false pnpm nx run-many -t test,lint,build -p runtime-ruby
node tools/runtime-conformance/run.mjs -- ruby packages/runtime-ruby/examples/conformance.rb
```

The initial 16 shared socket cases pass, including lost-ACK reconnect, join
rejection, ownership, API mutations, validation, and AIMock agent execution.
Local tests cover denied identity, memory grants, startup validation, and safe
telemetry. A gem build checks the installable artifact.

MCP Apps, A2UI, user-requested cancellation, distributed stop signaling,
suggestions, Inspector metadata, and an OpenTelemetry exporter are not yet
implemented. Rails boots, certificate-failure cases, prolonged lease loss,
high concurrency, and shutdown deadlines need integration coverage before a
production-readiness claim. The shared suite is one gate, not release approval.
