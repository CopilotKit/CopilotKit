# CopilotKit Intelligence Runtime for ASP.NET Core

This native .NET 9 library mounts the multi-route CopilotKit browser API.
Every run uses the Intelligence platform and its realtime ingestion gateway.
The library has no local runner or Node.js sidecar.

## Host the runtime

Reference `src/CopilotKit.Intelligence.Runtime.csproj` from an ASP.NET Core project.
Resolve the application user through your existing server authentication.

```csharp
using System.Security.Claims;
using CopilotKit.Intelligence;

var builder = WebApplication.CreateBuilder(args);
// Register your existing authentication scheme here.
var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

using var agentHttp = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
await using var runtime = new IntelligenceRuntime(new RuntimeOptions
{
    ApiUrl = new Uri(builder.Configuration["Intelligence:ApiUrl"]!),
    RunnerUrl = new Uri(builder.Configuration["Intelligence:RunnerUrl"]!),
    ClientUrl = new Uri(builder.Configuration["Intelligence:ClientUrl"]!),
    ApiKey = builder.Configuration["Intelligence:ApiKey"]!,
    Agents = new Dictionary<string, IRuntimeAgent>
    {
        ["default"] = new HttpAgent(
            new Uri(builder.Configuration["Agent:Url"]!), agentHttp)
    },
    IdentifyUser = (context, _) =>
    {
        var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        return ValueTask.FromResult<RuntimeUser?>(
            id is null ? null : new RuntimeUser(id, context.User.Identity?.Name));
    },
    A2UI = new A2UIOptions { InjectTool = true },
    OnError = error => app.Logger.LogError(
        error.Exception, "Runtime failure: {Code}", error.Code)
});
runtime.Map(app, "/copilotkit");
await app.RunAsync();
```

Supply separate platform API, runner WebSocket, and browser WebSocket URLs.
The runner URL excludes the final `/websocket` suffix.
Use `IRuntimeAgent` for native agents; `HttpAgent` accepts an AG-UI SSE endpoint.
Dispose the runtime on host shutdown so it cancels active runs and flushes analytics.

The `driver/` project serves the shared conformance suite.
Its `x-test-user-id` identity callback is test-only. Do not use it in an application.

## Runtime features

The library provides run/connect, thread reads and mutations, memory CRUD and recall,
subscriptions, and annotations. A run returns credentials after the gateway accepts
its ingestion channel. Each event retains its ID across acknowledged delivery retries.
Lock renewal failure cancels the agent. Input history filtering prevents duplicate persistence.

A2UI transforms occur before persistence. They include catalog context, render tools,
atomic component validation, progressive data, user actions, and recovery activity states.
The agent adapter owns generation retries; the runtime validates and renders their results.

Configure `McpAppsServers` with `McpAppServer` entries for MCP Apps.
Servers can have an `AgentId`, `ServerId`, and server-owned authentication headers.
Discovery includes UI tools only. Tool execution emits MCP Apps activities.
Iframe requests can call tools, read resources, send message notifications, and ping
registered servers. Sessions support Streamable HTTP with JSON or SSE responses.
The legacy MCP SSE transport is not supported.

`MemoryGrant` resolves user/project grants from trusted application policy.
A configured callback that returns null denies access before any platform call.
`LearningContainer` selects the container at run initialization.

## Analytics and error reporting

Analytics uses the TypeScript event names and property shapes.
By default, it samples each event at 5% and posts to
`https://telemetry.copilotkit.ai/ingest`.
The sink receives no API keys, prompts, user IDs, thread IDs, run IDs, or raw errors.
The timestamp uses integer Unix seconds.

| Setting                                           | Behavior                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `TelemetryDisabled`                               | Stops analytics for this runtime.                                               |
| `DO_NOT_TRACK` or `COPILOTKIT_TELEMETRY_DISABLED` | `true` or `1` disables analytics, regardless of runtime options.                |
| `TelemetrySampleRate`                             | Sampling probability from 0 to 1; default 0.05.                                 |
| `COPILOTKIT_TELEMETRY_SAMPLE_RATE`                | Overrides the configured rate; invalid or non-finite values fail configuration. |
| `TelemetryUrl` / `COPILOTKIT_TELEMETRY_URL`       | Changes the sink; the environment value takes precedence.                       |
| `TelemetryId` / `CPK_TELEMETRY_ID`                | Optional attribution; the first valid configured or environment value wins.     |

Telemetry IDs must contain 1–128 ASCII letters, digits, underscores, or hyphens.
The library trims surrounding spaces and tabs. It sends valid IDs only through
`X-CopilotKit-Telemetry-Id`. An ID does not bypass sampling.
The `telemetry_identified` field remains false because this runtime has no
license-based sampling bypass.

The exporter uses a queue of at most 256 waiting events. Overflow drops analytics.
HTTP requests time out after three seconds and never follow redirects.
Shutdown allows three seconds for queued analytics, plus at most half a second
for exporter disposal. Sink errors do not fail requests or invoke `OnError`.

`OnError` belongs to the host application. It receives runtime failures separately
from analytics. Callback exceptions do not replace the original runtime response.
Local `ActivitySource` and `Meter` instruments are available under
`CopilotKit.Intelligence.Runtime`; the library does not configure an OpenTelemetry exporter.

## Verify and package locally

Run from the repository root:

```sh
NX_DAEMON=false pnpm nx run-many --projects=runtime-dotnet --targets=test,build,lint,check-types --parallel=1
node tools/runtime-conformance/run.mjs -- dotnet packages/runtime-dotnet/driver/bin/Release/net9.0/Runtime.Driver.dll
dotnet pack packages/runtime-dotnet/src/CopilotKit.Intelligence.Runtime.csproj --configuration Release
```

The package command creates a local NuGet artifact. It does not publish anything.
Current validation covers .NET 9 only. Package release and production approval remain separate gates.
