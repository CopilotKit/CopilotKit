# CopilotKit Intelligence Runtime for Ruby

Connect a Rack-compatible Ruby application to CopilotKit Intelligence with native
Ruby agents or an AG-UI HTTP agent. Rails and Sinatra are supported through Rack;
neither framework is required. The runtime uses the Intelligence Runner.
It does not start a Node process.

## Use Intelligence without Rack or Rails

The gem also includes a standalone SDK. `require 'copilotkit/intelligence'` does not load Runtime or Rack.
Use the SDK from a script, job, or service without mounting HTTP routes.

```ruby
require 'copilotkit/intelligence'

intelligence = CopilotKit::Intelligence.new(api_key: ENV.fetch('CPK_INTELLIGENCE_API_KEY'))
thread = intelligence.get_or_create_thread(
  thread_id: '9dcc02ea-695d-4635-8efc-649c1b94ab90', user_id: 'customer-42', agent_id: 'support',
  learning_container_id: 'support-quality'
)
memories = intelligence.recall_memories(user_id: 'customer-42', query: 'support preferences', limit: 5)
puts thread.fetch('thread').fetch('id')
puts memories.fetch('memories')
```

`learning_container_id` assigns a new thread to an existing Learning Container.
Intelligence owns the binding and rejects attempts to move a bound thread.

Thread methods include `list_threads`, `get_thread`, `create_thread`, `update_thread`, and `archive_thread`.
Read persisted data with `get_thread_messages`, `get_thread_events`, and `get_thread_state`.
`delete_thread` permanently deletes a thread and its history.

Memory methods include `list_memories`, `create_memory`, `update_memory`, `remove_memory`, and `recall_memories`.
Pass `CopilotKit::MemoryGrant.new(user: :read_write, project: :read)` as `memory_grant` to apply explicit limits.
Without a grant, Intelligence applies its policy. Each Memory call requires the bare application user ID.

`annotate` records an annotation. Reuse `client_event_id` when retrying the same annotation.
`CopilotKit::Error` contains the HTTP status but no private response body.
The default transport uses a five-second connection timeout and a 15-second read timeout.
It closes each connection after the call, does not retry requests, and does not follow redirects.

Pass the same SDK client to `CopilotKit::Runtime.new(intelligence: intelligence, identify_user: identify_user, agents: agents)` to mount Runtime routes.
The Runtime borrows the SDK. Existing `api_key:` constructors remain valid.

## Handle thread changes

Register a block on the SDK:

```ruby
unsubscribe = intelligence.on_thread_created { |thread| puts thread.fetch('id') }
# To stop this listener:
unsubscribe.call
```

`on_thread_created` receives the canonical thread after creation.
`on_thread_updated` receives the thread after an update or archive.
`on_thread_deleted` receives `threadId`, `userId`, and `agentId` after deletion.
Listeners receive changes from direct SDK calls and from a Runtime that shares the SDK.

The SDK synchronizes registration across threads and calls listeners outside its mutex.
Failed requests and concurrent-create conflicts emit no success event.
A failed listener does not stop other listeners or replace a completed platform write.
The SDK writes a warning with the event and exception class, without the exception message or thread payload.

## Read Inspector metadata

Read project display metadata from application code:

```ruby
metadata = intelligence.get_inspector_metadata
puts metadata.dig('plan', 'label') if metadata && metadata.key?('plan')
```

The result is a hash with `schemaVersion: 1` and optional string-keyed modules:

| Module     | Fields                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| `identity` | `organizationName`, `projectName`                                           |
| `plan`     | `code`, `label`                                                             |
| `license`  | `state`: `valid`, `none`, `expired`, or `unknown`                           |
| `action`   | `kind`: `manage_plan`, `renew`, or `enable_intelligence`, plus a safe `url` |
| `usage`    | `used`, `limit`, and optional `expiringSoonCount`                           |

A usage limit has kind `finite`, `unlimited`, or `unknown`. Only a finite limit has a positive `value`.
Counts preserve known zero values. An absent expiry count has no `expiringSoonCount` key.
The SDK removes unknown fields and unsafe action URLs.
Metadata describes the project. It does not grant access to a feature or resource.

The request uses the server API key and a five-second deadline, including the response body.
Deadline expiry raises `Timeout::Error`. The default transport closes the connection.
Custom transports must release per-request resources in `ensure` blocks.
A 204, 404, or unsupported schema returns `nil`.
Other provider errors raise `CopilotKit::Error` with the HTTP status. Invalid JSON uses status 502.

The Runtime exposes this data at `GET /inspector-metadata`, relative to its mount path.
Like `/info`, this display route does not require an application-user identity.
It never forwards browser credentials to Intelligence.
Responses use `Cache-Control: no-store, private`. Provider errors produce an empty 204 response and call `on_error`.
The `/info` response advertises the route through `inspectorMetadata: true`.

## Read Runtime entitlements

Read the Runtime grant without a web server:

```ruby
result = intelligence.get_runtime_entitlements
if result.fetch('status') == 'ready'
  puts result.fetch('entitlement').fetch('active')
else
  puts result.fetch('error').fetch('code')
end
```

The result is a string-keyed hash. A ready result contains the grant, features, and limits.
Its `active` value determines Runtime access.
Other results have status `degraded`, `misconfigured`, or `unavailable` and contain a structured error.
The SDK accepts both current responses and legacy flat responses.

Concurrent threads share one lookup. Each caller receives a separate copy.
Active grants remain in the cache for 30 seconds. Other results and request errors remain for five seconds.
After expiry, the SDK requests a fresh result. A failed lookup does not return an expired grant.
The cache uses a monotonic clock, so changes to the system clock do not extend grants.

The full request deadline is 1.5 seconds, including the response body.
`CopilotKit::RuntimeEntitlementError` extends `CopilotKit::Error` with a `retryable` value.
Invalid responses use status 502 with `retryable: false`. Timeouts use status 504 with `retryable: true`.
The default transport closes the connection and excludes private response bodies from errors.
Custom transports must release per-request resources in `ensure` blocks.

The Runtime uses this SDK method and cache for `/info`.
Configuration errors produce a non-retryable `misconfigured` result.
Retryable failures produce an `unavailable` result and an `unknown` compatibility license status.

## Install

1. Add the gem from your checkout to your application's `Gemfile`:

   ```ruby
   gem 'copilotkit-runtime', path: '/path/to/CopilotKit/packages/runtime-ruby'
   ```

2. Run `bundle install`.

Ruby 2.7 or later is required. The gem installs its `websocket` dependency.
Your application supplies a Rack-compatible server. The gem does not depend on Rails.

## Mount with Rack

`CopilotKit::Runtime` is a Rack application. Its `call(env)` method accepts the
Rack environment and returns `[status, headers, body]`. Your application owns
authentication and passes an `identify_user` callback that reads that environment.

Mount a configured runtime in your application's `config.ru`:

```ruby
map '/copilotkit' do
  run runtime
end
```

Here, `runtime` is your configured `CopilotKit::Runtime` instance. Rack removes
the mount prefix from `PATH_INFO`, so leave the runtime's `base_path` empty.
Create one runtime per worker and close it during worker shutdown; see
[Worker lifecycle](#worker-lifecycle).

## Mount in Rails

1. Set `CPK_INTELLIGENCE_API_KEY` and `AG_UI_AGENT_URL` in your server environment.
2. Add this initializer:

   ```ruby
   # config/initializers/copilotkit.rb
   require 'copilotkit/runtime'

   Rails.application.config.x.copilotkit_runtime = CopilotKit::Runtime.new(
     api_key: ENV.fetch('CPK_INTELLIGENCE_API_KEY'),
     agents: {
       'default' => CopilotKit::HttpAgent.new(url: ENV.fetch('AG_UI_AGENT_URL'))
     },
     identify_user: lambda do |env|
       user = env['warden']&.user
       user && { id: user.id.to_s, name: user.name.to_s }
     end
   )
   ```

3. Mount the runtime in your routes:

   ```ruby
   # config/routes.rb
   Rails.application.routes.draw do
     mount Rails.application.config.x.copilotkit_runtime => '/copilotkit'
   end
   ```

4. Point your CopilotKit frontend at `/copilotkit`.

This example uses Devise/Warden for authentication. If you use another system,
replace `identify_user` with your application's authentication lookup.
The callback receives the real Rack environment. It returns a hash with `id`
and optional `name`. Symbol and string keys are accepted. A `nil` result denies access.

The initializer assumes each worker boots Rails without preloading.
For preloaded applications, follow [Worker lifecycle](#worker-lifecycle).

## Write a Ruby agent

Subclass `CopilotKit::Agent` and yield AG-UI event hashes from `each_event(input)`:

```ruby
class GreetingAgent < CopilotKit::Agent
  def each_event(_input)
    message_id = SecureRandom.uuid
    yield('type' => 'TEXT_MESSAGE_START', 'messageId' => message_id, 'role' => 'assistant')
    yield('type' => 'TEXT_MESSAGE_CONTENT', 'messageId' => message_id, 'delta' => 'Hello')
    yield('type' => 'TEXT_MESSAGE_END', 'messageId' => message_id)
    yield('type' => 'RUN_FINISHED')
  end
end
```

Register the instance with `agents: { 'default' => GreetingAgent.new }`.
The input contains canonical thread and run IDs and message history.
State and tools remain available from the request.
The runner adds `RUN_STARTED`, event IDs, and sequence numbers.

Each invocation must keep mutable state local. Multiple runs can share an agent
instance. Use `ensure` to release resources when a run stops.

For agents that use Active Record, wrap the event method in the Rails executor.
The executor manages connection cleanup on the runtime's agent thread:

```ruby
class DatabaseAgent < CopilotKit::Agent
  def each_event(_input)
    Rails.application.executor.wrap do
      value = ActiveRecord::Base.connection.select_value('SELECT 1')
      message_id = SecureRandom.uuid
      yield('type' => 'TEXT_MESSAGE_START', 'messageId' => message_id, 'role' => 'assistant')
      yield('type' => 'TEXT_MESSAGE_CONTENT', 'messageId' => message_id, 'delta' => value.to_s)
      yield('type' => 'TEXT_MESSAGE_END', 'messageId' => message_id)
      yield('type' => 'RUN_FINISHED')
    end
  end
end
```

Each agent must yield `RUN_FINISHED` or `RUN_ERROR`. A return without a terminal
event produces `INCOMPLETE_STREAM`, not success. The runner closes open text
and tool streams before that error.

`CopilotKit::HttpAgent.new(url:, headers: {}, description: '')` connects to an
AG-UI SSE endpoint. The server owns its headers. The adapter reads events as
they arrive and applies the same terminal-event rule.

## Mount in Rack

The runtime implements `call(env)`. Mount it inside your authenticated Rack
application with `Rack::Builder`:

```ruby
require 'copilotkit/runtime'
require 'rack'

runtime = CopilotKit::Runtime.new(
  api_key: ENV.fetch('CPK_INTELLIGENCE_API_KEY'),
  agents: { 'default' => CopilotKit::HttpAgent.new(url: ENV.fetch('AG_UI_AGENT_URL')) },
  identify_user: lambda do |env|
    user = env['warden']&.user
    user && { id: user.id.to_s, name: user.name.to_s }
  end
)

app = Rack::Builder.new do
  map('/copilotkit') { run runtime }
end.to_app
```

Pass `app` to your Rack server behind your authentication middleware.
This example expects Warden to have resolved the current user.
Rails and `Rack::Builder#map` strip the mount prefix. Leave `base_path` empty
for these mounts. For a host that preserves the prefix, set
`base_path: '/copilotkit'`.

## Configure access and connections

Keep API keys and agent credentials on the server. Resolve user IDs from
authenticated application state, not request bodies, query strings, or arbitrary
HTTP headers. Intelligence checks resource ownership using that identity.

Without `memory_access`, Intelligence applies its platform memory policy.
The runtime sends the trusted user ID without a grant override.
To set an application policy, pass a callback:

```ruby
memory_access: ->(user, env) { { user: 'read-write', project: 'none' } }
```

Each scope accepts `none`, `read`, or `read-write`. A `nil` grant or two `none`
grants deny access. Invalid grants return a server error without an upstream
request. Callback errors also stop the request without a platform fallback.
The callback receives the trusted user and Rack environment.
Grant keys accept symbols or strings. Callback user hashes use string keys.
When both key forms exist, the string value takes precedence, including `nil` or `false`.

`learning_container: ->(user, input) { ... }` selects a learning container ID.
A thread must keep the same container.

For self-hosted Intelligence, set `api_url`, `runner_url`, and `client_url`
together. Runner and client URLs end in `/runner` and `/client`.
Do not append `/websocket`. TLS checks certificate trust and hostnames.

For a frontend on another origin, set `cors_origins: ['https://app.example.com']`.
The runtime sends no CORS allow headers by default.

The mount serves agent run/connect/stop routes, thread and memory routes,
subscriptions, annotations, and `/info`. A successful run response means the
runner joined its authenticated gateway channel, not that the agent finished.
The frontend receives events through Intelligence.

## Add A2UI or MCP Apps

Pass a server-owned catalog through `a2ui`:

```ruby
a2ui: {
  'injectA2UITool' => true,
  'schema' => catalog,
  'agents' => ['default']
}
```

A string value for `injectA2UITool` selects a custom tool name.
The `agents` array limits A2UI to named agents. Omit it to include all agents.
Set `'enabled' => false` to disable A2UI.

The middleware adds the render tool and context. It validates complete component
trees before publishing them, then publishes complete data items as they arrive.
Browser actions become tool history for the next run. The agent owns model retries.

Set `defaultCatalogId` to select a host catalog. Otherwise, catalog selection uses
the frontend schema, a streamed non-basic ID, or the basic catalog URL.
The streaming gate checks component structure and references, not general JSON
Schema rules or binding resolution.

Configure MCP Apps servers and credentials on the server:

```ruby
mcp_apps: { 'servers' => [{
  'type' => 'http',
  'url' => 'https://mcp.example.com/mcp',
  'serverId' => 'cards',
  'agentId' => 'default',
  'headers' => { 'authorization' => ENV.fetch('MCP_AUTHORIZATION') }
}] }
```

The runtime discovers UI tools, executes calls, and publishes MCP Apps activities.
Iframe requests use configured server IDs or hashes. They cannot override the
server URL or credentials. The proxy accepts `tools/call`, `resources/read`,
`notifications/message`, and `ping`.

MCP Apps uses Streamable HTTP. SSE responses to HTTP requests are supported.
Legacy MCP SSE discovery is not supported.

## Worker lifecycle

Create one runtime per worker after fork. Close it from your server's worker
shutdown hook:

```ruby
Rails.application.config.x.copilotkit_runtime.close(timeout: 10)
```

For preloaded Rails applications, create the runtime in the worker-boot hook
instead of the initializer. Mount a callable that resolves the worker instance:

```ruby
mount ->(env) { Rails.application.config.x.copilotkit_runtime.call(env) } => '/copilotkit'
```

Shutdown cancels pending startup requests and agent producers before draining
event delivery. The timeout bounds the drain phase. Platform cleanup has its
own three-second bound. If cleanup cannot reach Intelligence, the lease expires.

The default lease lasts 20 seconds and renews every 15 seconds. Set `lock_ttl:`
and `lock_heartbeat_interval:` together to change them. Renewal starts before
history loading and channel join. A lost lease cancels the agent.

The producer queue holds at most 32 events. The publisher waits for durable ACKs
and replays unacknowledged events after reconnect without rerunning the agent.
Gateway batches contain at most 32 events. Retries use at most four attempts.

HTTP stop requests check current ownership and an optional `runId` before
stopping a local run. Use the authenticated realtime gateway to stop a run
on another worker. Repeated stops do not cancel pending durable delivery.

## Telemetry and errors

Pass a `CopilotKit::Telemetry` instance to control analytics:

```ruby
telemetry: CopilotKit::Telemetry.new(disabled: true)
```

`DO_NOT_TRACK=true` or `COPILOTKIT_TELEMETRY_DISABLED=true` also disables analytics.
Both variables accept `1`. Opt-out takes precedence over identity and sampling.

Analytics reports runtime creation, run/connect requests, and agent start,
completion, or failure. Event bodies contain no prompts, user IDs, thread/run
IDs, credentials, routes, or dependency error messages.

The default sample rate is `0.05`. Set `sample_rate:` on `Telemetry` to change it.
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides this value. Rates must be finite
numbers from zero through one. Invalid rates use the default.

`telemetry_id:` takes precedence over `CPK_TELEMETRY_ID`. IDs allow 1–128 ASCII
letters, digits, underscores, or hyphens after spaces and tabs are trimmed.
An ID travels only in `X-CopilotKit-Telemetry-Id` and does not bypass sampling.

`license_token:` accepts a legacy analytics token. A blank value falls back to
`COPILOTKIT_LICENSE_TOKEN`. Without a standalone ID, a valid `telemetry_id` claim
selects every event. The exporter sends only the extracted ID, never the token.
This claim does not verify a license signature or grant access.

The default sink is `https://telemetry.copilotkit.ai/ingest`.
Set `COPILOTKIT_TELEMETRY_URL` or `Telemetry.new(url: endpoint)` to change it.
Use `Telemetry.new(exporter: ->(event) { ... })` for an application exporter.
An injected exporter owns its telemetry configuration.

The queue holds at most 256 events and discards new events when full.
Exports have a three-second timeout and do not follow redirects.
Exporter failures do not fail runtime requests. `flush(timeout:)` waits for
queued events. `close(timeout:)` drains the queue and stops the exporter.

Use `on_error: ->(error) { ... }` on the runtime for application error reporting.
It receives the native exception separately from analytics. Callback failures
do not affect HTTP responses or cleanup.
