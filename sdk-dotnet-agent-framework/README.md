# CopilotKit Intelligence for Microsoft Agent Framework

`CopilotKit.Intelligence.AgentFramework` exposes verified CopilotKit Intelligence Registry skills through Microsoft Agent Framework's native `AIContextProvider` extension point. It adapts an existing `IntelligenceClient`; it does not construct, wrap, or delegate an agent and does not implement Registry transport or cache verification.

## Installation

Install the independently versioned NuGet package in a .NET 8 or newer project:

```bash
dotnet add package CopilotKit.Intelligence.AgentFramework --version 0.1.0
```

The package supports `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)` and `CopilotKit.Intelligence` `[0.1.0,1.0.0)`. Those bounded dependencies are declared by the package.

## Native registration

Register `SkillRegistryContextProvider` directly in `ChatClientAgentOptions.AIContextProviders`:

```csharp
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;

using var intelligence = new IntelligenceClient(new IntelligenceClientOptions(
    new Uri("https://intelligence.example.com/"),
    Environment.GetEnvironmentVariable("COPILOTKIT_API_KEY")!,
    "my-project",
    Path.Combine(Path.GetTempPath(), "copilotkit-intelligence")));

await using var skillRegistry = new SkillRegistryContextProvider(
    intelligence,
    "55555555-5555-4555-8555-555555555555");

var agentOptions = new ChatClientAgentOptions
{
    AIContextProviders = [skillRegistry],
};
```

The provider derives from `AIContextProvider` and overrides `ProvideAIContextAsync(AIContextProvider.InvokingContext, CancellationToken)`, returning `ValueTask<AIContext>`. Agent Framework combines its additional instructions with context from other registered providers; this adapter does not replace those providers.

## Lifecycle and preload

`PreloadAsync` performs a fresh networked load, `PreloadCachedAsync` performs an explicitly offline cached load, and `LoadAsync` is the request-time path used by the native hook. `IsReady` is true only for `Ready` and `Revoked`; inspect `Status` and the immutable `Snapshot`, or await `WaitUntilReadyAsync`. A cold native invocation blocks until a complete verified snapshot is available and fails closed if loading fails.

## Fresh and cached data

Fresh preload and request-time refresh call `IntelligenceClient.GetAsync`; only explicit cached preload calls `GetCachedAsync`. `Snapshot.Source` reports `Fresh`, `Cached`, or `None`. Loads inside the 30-second default refresh interval are throttled, and concurrent callers share one in-flight task. A failed refresh can retry at the interval boundary. Transient or integrity failures retain the last-good snapshot only for diagnostics and change status to `Stale`; the provider never injects it as an implicit fallback.

## Limits and scripts

The adapter accepts at most 128 skills, 262,144 UTF-8 bytes in one `SKILL.md`, and 1,048,576 UTF-8 bytes across the set. Files are decoded as strict UTF-8. Limits, invalid encoding, invalid verified projections, or any manifest file with role `script` or a normalized path under `scripts/` reject the complete set: there is no truncation, partial load, reordering, process spawn, or executable tool creation.

## Telemetry

Set `SkillRegistryContextProviderOptions.Telemetry` to receive `load.started`, `load.throttled`, `load.singleflight_joined`, `load.succeeded`, `load.failed`, and `status.changed`. Permitted fields are framework, adapter version, source/freshness, status, joined caller count, skill count, registry revision, outcome, reason, and canonical error code/category/retryability/request ID/trace ID when present. Events never contain access tokens, project namespaces, learning-container IDs, skill text, local paths, or bundle contents. An asynchronous sink failure fails the initiating operation; every joined caller observes the same terminal `LEARNING_TELEMETRY_SINK_FAILED` exception instance.

## Errors

Authentication and permission categories, HTTP 401/403/404/410, `LEARNING_CONTAINER_ARCHIVED`, `LEARNING_CONTAINER_PROJECT_MISMATCH`, `LEARNING_CONTAINER_NOT_FOUND`, and `LEARNING_REGISTRY_UNRECOVERABLE` fail closed as `Denied`. Transient and integrity refresh failures surface `LEARNING_REGISTRY_STALE`. Adapter validation uses `INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS`, `INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE`, `INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE`, `INTELLIGENCE_ADAPTER_INVALID_UTF8`, `INTELLIGENCE_ADAPTER_SCRIPT_DISABLED`, or `INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION`. `IntelligenceSdkException` preserves the canonical category, retryability, request ID, trace ID, and inner error where available.

## Closing

`DisposeAsync` is idempotent. It does not cancel an already-running model invocation, which retains the snapshot captured for that invocation. Disposal closes the provider and every future preload, load, readiness wait, or native load rejects with `LEARNING_REGISTRY_CLOSED`.

## Compatibility

The runtime floor is .NET 8. The supported Agent Framework range is `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)` and the generic SDK range is `CopilotKit.Intelligence` `[0.1.0,1.0.0)`. The native `AIContextProvider` inheritance, protected asynchronous context method, cancellation-token position, `AIContext` result, and `ChatClientAgentOptions.AIContextProviders` registration are compiled against exact minimum `1.13.0` and the newest stable version below `2.0.0` in CI.

## Ownership and release

The Intelligence/Learning team owns this adapter. `CopilotKit.Intelligence.AgentFramework` is versioned, tagged, and published independently in its own NuGet release lane; its release is not coupled to the Python, TypeScript, or another adapter's release train. It shares conformance fixtures with those adapters without taking a runtime dependency on them.
