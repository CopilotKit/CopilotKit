# CopilotKit Intelligence Runtime for ASP.NET Core

Host the CopilotKit browser API in an ASP.NET Core application with .NET 8.
The library implements the Intelligence Runner and sends agent events to the Intelligence gateway for persistence and replay.
Agents can run in your .NET process or at a remote AG-UI endpoint.

For scripts and workers, use the separate [Intelligence SDK](sdk/README.md).
It provides direct thread, Memory, and annotation methods without an ASP.NET Core host or Runtime routes.
Thread results and lifecycle callbacks expose `ThreadSummary` records with canonical IDs and platform metadata.
Memory results expose native C# properties, including content, source thread IDs, recall scores, and save markers.
History and annotation results use native records. State results support C# pattern matching for snapshots, absent snapshots, and decode failures.

## Install from a local package

The package requires the .NET 8 SDK and an ASP.NET Core host.

1. From the CopilotKit repository root, build the SDK and Runtime packages:

   ```sh
   NX_DAEMON=false pnpm nx run runtime-dotnet:pack
   ```

2. From your application directory, install the package from that local feed:

   ```sh
   dotnet add package CopilotKit.Intelligence.Runtime --version 0.1.0-preview.1 --source /absolute/path/to/CopilotKit/packages/runtime-dotnet/src/bin/packages
   ```

The local feed path must point to your checkout.
A project reference to `src/CopilotKit.Intelligence.Runtime.csproj` also works for development within a checkout.

## Connect an ASP.NET Core host

1. Supply these values through ASP.NET Core configuration:

   | Key                      | Value                                                           |
   | ------------------------ | --------------------------------------------------------------- |
   | `Intelligence:ApiUrl`    | The Intelligence HTTP API URL                                   |
   | `Intelligence:RunnerUrl` | The runner WebSocket URL, without the final `/websocket` suffix |
   | `Intelligence:ClientUrl` | The browser WebSocket URL                                       |
   | `Intelligence:ApiKey`    | Your server-side Intelligence API key                           |
   | `Agent:Url`              | Your agent's AG-UI SSE endpoint                                 |

   Environment variables use double underscores, for example `Intelligence__ApiKey`.

2. Register the runtime as a singleton in your authenticated ASP.NET Core application:

   ```csharp
   using System.Security.Claims;
   using CopilotKit.Intelligence;

   var builder = WebApplication.CreateBuilder(args);
   // Keep your application's authentication and authorization registrations here.
   builder.Services.AddHttpClient("agent", client =>
       client.Timeout = Timeout.InfiniteTimeSpan)
       .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
       {
           PooledConnectionLifetime = TimeSpan.FromMinutes(2)
       })
       .SetHandlerLifetime(Timeout.InfiniteTimeSpan);
   builder.Services.AddSingleton<IntelligenceRuntime>(services =>
   {
       var configuration = services.GetRequiredService<IConfiguration>();
       var logger = services.GetRequiredService<ILogger<IntelligenceRuntime>>();
       string Required(string key) => configuration[key]
           ?? throw new InvalidOperationException($"Missing configuration: {key}");

       return new IntelligenceRuntime(new RuntimeOptions
       {
           ApiUrl = new Uri(Required("Intelligence:ApiUrl")),
           RunnerUrl = new Uri(Required("Intelligence:RunnerUrl")),
           ClientUrl = new Uri(Required("Intelligence:ClientUrl")),
           ApiKey = Required("Intelligence:ApiKey"),
           Agents = new Dictionary<string, IRuntimeAgent>
           {
               ["default"] = new HttpAgent(
                   new Uri(Required("Agent:Url")),
                   services.GetRequiredService<IHttpClientFactory>()
                       .CreateClient("agent"))
           },
           IdentifyUser = (context, cancellationToken) =>
           {
               cancellationToken.ThrowIfCancellationRequested();
               var id = context.User.Identity?.IsAuthenticated == true
                   ? context.User.FindFirstValue(ClaimTypes.NameIdentifier)
                   : null;
               return ValueTask.FromResult<RuntimeUser?>(id is null
                   ? null : new RuntimeUser(id, context.User.Identity?.Name));
           },
           OnError = error => logger.LogError(
               error.Exception, "Runtime failure: {Code}", error.Code)
       });
   });

   var app = builder.Build();
   app.UseAuthentication();
   app.UseAuthorization();
   app.Services.GetRequiredService<IntelligenceRuntime>().Map(app, "/copilotkit");
   await app.RunAsync();
   ```

3. Point your CopilotKit frontend at the host's `/copilotkit` URL.

The example uses your existing authentication scheme and sign-in flow.
`IdentifyUser` must return a stable application-user ID from trusted server authentication.
A null result rejects protected requests with HTTP 401. `/info` provides public discovery.
`/inspector-metadata` provides public account display details through the SDK.
Browser-supplied user IDs are not authentication.

The runtime keeps the API key on the server.
`HttpAgent` forwards only headers that you explicitly supply to its constructor.
The sample renews pooled connections because the singleton agent retains its HTTP client.
For cross-origin requests, set `AllowedOrigins` to the exact browser origins.
An empty set adds no CORS response headers and applies no origin restriction.

## Show Inspector metadata

Inspector reads `GET /copilotkit/inspector-metadata` to show identity, plan, license, action, and usage details.
The Runtime reads these values through its standalone SDK with the server-side API key.
It does not forward browser credentials or call `IdentifyUser` for this display route.
The configured origin restriction still applies. Thread and Memory routes still require authentication.

The route returns sanitized metadata as JSON with `Cache-Control: no-store, private`.
For absent metadata or provider errors, it returns HTTP 204 with the same cache header and no body.
Provider errors also reach `OnError` with operation `inspector.metadata` and code `INSPECTOR_METADATA_FAILED`.
`GET /copilotkit/info` reports `inspectorMetadata: true` without a metadata request.

## Share an SDK with the Runtime

The Runtime uses the standalone SDK for platform requests.
You can share that SDK with application code that reads threads, uses Memory, or records feedback.
`/info` shares the SDK's entitlement cache and returns normalized `runtimeEntitlements`.
The compatibility field `licenseStatus` reports `valid`, `none`, or `unknown` from that result.

1. Before the Runtime registration in the host example, register the SDK:

   ```csharp
   builder.Services.AddSingleton<IntelligenceClient>(services =>
   {
       var configuration = services.GetRequiredService<IConfiguration>();
       return new IntelligenceClient(new IntelligenceOptions
       {
           ApiKey = configuration["Intelligence:ApiKey"]
               ?? throw new InvalidOperationException("Missing Intelligence:ApiKey"),
           ApiUrl = new Uri(configuration["Intelligence:ApiUrl"]
               ?? "https://api.intelligence.copilotkit.ai"),
           RunnerUrl = new Uri(configuration["Intelligence:RunnerUrl"]
               ?? "wss://realtime.intelligence.copilotkit.ai/runner"),
           ClientUrl = new Uri(configuration["Intelligence:ClientUrl"]
               ?? "wss://realtime.intelligence.copilotkit.ai/client")
       });
   });
   ```

2. In `RuntimeOptions`, replace `ApiKey`, `ApiUrl`, `RunnerUrl`, and `ClientUrl` with the SDK reference:

   ```csharp
   Intelligence = services.GetRequiredService<IntelligenceClient>(),
   ```

The Runtime uses the SDK's endpoints, credentials, and request deadline.
Conflicting duplicate configuration fails during construction.
Configure a supplied platform `HttpClient` on the SDK, not on both constructors.

The DI container owns the registered SDK and disposes it after the Runtime.
For manual ownership, dispose the Runtime before the shared SDK.
Runtime shutdown leaves an injected SDK available for other application work.
Without injection, the Runtime creates and disposes its own SDK.

## Write a native agent

Implement `IRuntimeAgent` with an async iterator:

```csharp
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

public sealed class GreetingAgent : IRuntimeAgent
{
    public string Description => "Sends a greeting";

    public async IAsyncEnumerable<JsonObject> RunAsync(
        JsonObject input,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();
        var messageId = Guid.NewGuid().ToString();
        yield return new() { ["type"] = "RUN_STARTED" };
        yield return new()
        {
            ["type"] = "TEXT_MESSAGE_START",
            ["messageId"] = messageId, ["role"] = "assistant"
        };
        yield return new()
        {
            ["type"] = "TEXT_MESSAGE_CONTENT",
            ["messageId"] = messageId, ["delta"] = "Hello from .NET."
        };
        yield return new() { ["type"] = "TEXT_MESSAGE_END", ["messageId"] = messageId };
        yield return new() { ["type"] = "RUN_FINISHED" };
    }
}
```

Register the instance under `Agents["default"]` instead of `HttpAgent`.
The input contains AG-UI messages, state, tools, and context.
The runtime assigns canonical thread and run IDs to each event.

Pass the cancellation token to model calls, HTTP calls, and waits.
Emit `RUN_FINISHED` for success or `RUN_ERROR` for failure.
A stream without a terminal event closes open text and tools, then emits `INCOMPLETE_STREAM`.
The runtime stops consumption at the first terminal event.
It permits at most 4,096 open text and tool items.

## Control memory access

`MemoryGrant` resolves permissions from trusted application policy.
Each grant contains `user` and `project`, with values `none`, `read`, or `read-write`:

```csharp
MemoryGrant = (context, user, cancellationToken) =>
    ValueTask.FromResult<JsonObject?>(new JsonObject
    {
        ["user"] = "read-write",
        ["project"] = "read"
    }),
```

A configured callback that returns null denies access before a platform request.
Without a callback, the runtime delegates memory access to the platform without grant restrictions.
Invalid grants fail with HTTP 500. Two `none` values deny access with HTTP 403.
The platform resolves the stored scope for updates and deletes.

`LearningContainer` selects a container at run initialization from the trusted user, agent ID, and run input.
Memory CRUD, recall, and subscriptions use the runtime's memory routes.
Thread routes provide reads and mutations. Annotation routes record feedback.

## Enable A2UI and MCP Apps

Add UI configuration to `RuntimeOptions`:

```csharp
A2UI = new A2UIOptions { InjectTool = true },
McpAppsServers =
[
    new McpAppServer
    {
        Url = new Uri("https://mcp.example.com/mcp"),
        ServerId = "catalog",
        AgentId = "default",
        Headers = new Dictionary<string, string>
        {
            ["Authorization"] = "Bearer " + mcpToken
        }
    }
],
```

A2UI validates components and transforms render tools, progressive data, and user actions before persistence.
It preserves recovery activity states. The agent adapter owns generation retries.
`A2UIOptions.Agents` restricts A2UI to named agents.

MCP Apps discovers UI tools and records tool results as activities.
Servers use Streamable HTTP endpoints with JSON or SSE responses.
Iframe requests select registered servers, not browser-supplied URLs.
The proxy supports tool calls, resource reads, message notifications, ping, and sessions.
Server headers belong to your application configuration, not the browser.
Endpoints with headers require HTTPS. Numeric loopback addresses (`127.0.0.1` and `::1`)
allow HTTP for local development; hostnames do not receive this exception.
MCP requests do not follow redirects.

## Manage delivery and shutdown

The runtime returns run credentials after the Intelligence gateway accepts the channel.
Delivery retries preserve event IDs and sequence numbers. Completion waits for every gateway acknowledgment.
Gateway restarts do not rerun the agent. A failed lock renewal cancels the agent.
Stop requests require thread access and cannot cancel a different run or agent.

The publisher holds at most 256 queued events plus an active batch of at most 32 events.
A full queue pauses agent consumption.
`MaxRequestBytes` defaults to 4 MiB. `RequestTimeout` defaults to 30 seconds.

The DI container disposes the singleton runtime asynchronously with the host.
For a manually created runtime, use `await using` around the host lifetime.
Do not create a runtime per request.
A supplied platform `HttpClient` remains caller-owned. Otherwise, the runtime creates and disposes its own client.

Shutdown cancels active agents, including runs that await startup.
It waits up to `RequestTimeout`, then attempts publisher and lock cleanup within another `RequestTimeout`.
An expired shutdown deadline reports `RUN_SHUTDOWN_TIMEOUT` through `OnError`.
Native agents must obey cancellation. The runtime cannot forcibly stop application-owned code.

## Configure analytics and diagnostics

Analytics samples each event at 5% by default and sends events to `https://telemetry.copilotkit.ai/ingest`.
Events exclude API keys, prompts, user IDs, thread IDs, run IDs, and raw errors.

| Configuration                                     | Behavior                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `TelemetryDisabled`                               | Disables analytics                                                                        |
| `DO_NOT_TRACK` or `COPILOTKIT_TELEMETRY_DISABLED` | `true` or `1` disables analytics regardless of other configuration                        |
| `TelemetrySampleRate`                             | Probability from 0 to 1, default `0.05`                                                   |
| `COPILOTKIT_TELEMETRY_SAMPLE_RATE`                | Overrides the rate. Invalid or non-finite values fail configuration                       |
| `TelemetryUrl` / `COPILOTKIT_TELEMETRY_URL`       | Changes the destination. The environment value wins                                       |
| `TelemetryId` / `CPK_TELEMETRY_ID`                | Selects the first valid configured or environment identity                                |
| `LicenseToken` / `COPILOTKIT_LICENSE_TOKEN`       | Supplies a legacy analytics token. A blank configured token uses the environment fallback |

Telemetry IDs contain 1–128 ASCII letters, digits, underscores, or hyphens.
The runtime trims surrounding spaces and tabs and sends the ID only through `X-CopilotKit-Telemetry-Id`.
A standalone ID does not bypass sampling.

Without a standalone ID, a valid `telemetry_id` claim selects every event and sets `telemetry_identified` to true.
The exporter sends the extracted ID, never the license token.
This claim does not verify a license signature or grant access. Analytics opt-out always wins.

The analytics queue holds at most 256 waiting events. Overflow drops analytics.
HTTP requests time out after three seconds and do not follow redirects.
Shutdown allows three seconds for queued analytics and half a second for exporter disposal.
Sink errors do not fail requests or invoke `OnError`.
`TelemetryExporter` accepts a custom `IRuntimeTelemetryExporter` implementation.

`OnError` receives original runtime exceptions separately from analytics.
Your application controls access to these diagnostics. Callback exceptions do not replace runtime responses.
Local `ActivitySource` and `Meter` instruments use the name `CopilotKit.Intelligence.Runtime`.

## Build and test the package

From the CopilotKit repository root, run the package checks:

```sh
NX_DAEMON=false pnpm nx run-many --projects=runtime-dotnet --targets=test,build,lint,check-types --parallel=1
NX_DAEMON=false pnpm nx run runtime-dotnet:pack
```

## .NET 8 compatibility

The SDK and runtime target .NET 8. The SDK uses System.Text.Json 9.0.20, which supports
.NET 8, to retain nullable-field validation and out-of-order metadata handling.
The runtime test target also hosts a real Microsoft Agent Framework AG-UI endpoint
and consumes its event stream through `HttpAgent`. The model response is deterministic;
this is a local framework integration test, not a hosted-model test.
