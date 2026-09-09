# CopilotKit Intelligence SDK for .NET

Use Intelligence from a .NET 9 application, script, or worker.
Read thread history, save and recall Memory, and record feedback through asynchronous methods.
Assign a new thread to an existing Learning Container with its stable ID.

The SDK is a separate assembly from `CopilotKit.Intelligence.Runtime`.
It requires no ASP.NET Core host, agent registration, or Runtime routes.

## Install from a local package

1. From the CopilotKit repository root, build the NuGet packages:

   ```sh
   NX_DAEMON=false pnpm nx run runtime-dotnet:pack
   ```

2. From your application directory, install the SDK from the local feed:

   ```sh
   dotnet add package CopilotKit.Intelligence --version 0.1.0-preview.1 --source /absolute/path/to/CopilotKit/packages/runtime-dotnet/src/bin/packages
   ```

The feed path must point to your checkout.

## Read a thread without a Runtime

Set `CPK_INTELLIGENCE_API_KEY` in your server environment.
Then call the SDK from your application:

```csharp
using CopilotKit.Intelligence;

using var intelligence = new IntelligenceClient(new IntelligenceOptions
{
    ApiKey = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY")
        ?? throw new InvalidOperationException("CPK_INTELLIGENCE_API_KEY is required")
});

var thread = await intelligence.GetThreadAsync(
    "e8b69588-7872-4c98-b1d8-80583a4f285c", "customer-123");
Console.WriteLine(thread["name"]);
```

Use your thread ID and the application-user ID that owns it.
Keep the API key on the server. A browser-supplied user ID does not prove identity.
The platform resolves the project from the API key.

## Assign a thread to a Learning Container

```csharp
var thread = await intelligence.CreateThreadAsync(
    threadId: Guid.NewGuid().ToString(),
    userId: "customer-123",
    agentId: "default",
    learningContainerId: "support-assistant");
```

The container must already exist.
`GetOrCreateThreadAsync` returns the thread and a `Created` flag.
After a concurrent creation conflict, the SDK reads the thread with the same user scope.

## Use Memory

```csharp
var grant = new MemoryGrant(MemoryAccess.ReadWrite, MemoryAccess.Read);
var result = await intelligence.RecallMemoriesAsync(
    userId: "customer-123",
    query: "Preferred response format",
    limit: 5,
    grant: grant);

foreach (var memory in result["memories"]!.AsArray())
{
    Console.WriteLine(memory?["content"]);
}
```

Resolve grants from trusted application policy.
The grant limits access to user and project Memory.
Without a grant, the platform applies its access rules to the API key and application user.

## Available operations

| Resource | Methods                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threads  | `ListThreadsAsync`, `GetThreadAsync`, `CreateThreadAsync`, `GetOrCreateThreadAsync`, `UpdateThreadAsync`, `ArchiveThreadAsync`, `DeleteThreadAsync` |
| History  | `GetThreadMessagesAsync`, `GetThreadEventsAsync`, `GetThreadStateAsync`                                                                             |
| Memory   | `ListMemoriesAsync`, `CreateMemoryAsync`, `UpdateMemoryAsync`, `RemoveMemoryAsync`, `RecallMemoriesAsync`                                           |
| Feedback | `AnnotateAsync`                                                                                                                                     |

Resource methods return `JsonObject` values and preserve platform fields.
Thread reads and mutations return the thread without its response envelope.
Lists retain their envelopes, including pagination and subscription credentials.
Memory results retain relevance scores, absorbed markers, and retired IDs.
Archive and removal methods return `Task` without a result.

Inspection methods use project-level authorization rather than a user filter.
Reuse `clientEventId` when you retry an annotation with the same content.

## Manage connections and errors

Reuse one SDK client across requests.
The default client renews pooled connections after two minutes and blocks redirects.
`RequestTimeout` defaults to 30 seconds and covers the response body.
Responses have a 16 MiB limit. The SDK does not retry requests automatically.

Every asynchronous method accepts a `CancellationToken`.
Cancellation and request deadlines raise `OperationCanceledException`.
`IntelligenceException.StatusCode` retains the platform HTTP status.
Transport errors and invalid responses use status 502 without private response content.

For application-managed transport, pass an `HttpClient` to the constructor.
Configure that client's handler to disable redirects and automatic retries.
The SDK does not change or dispose a supplied client.
Its request deadline still applies. A shorter supplied-client timeout also applies.

Dispose the SDK after its last request.
Disposal closes SDK-owned connections and rejects later SDK calls.
