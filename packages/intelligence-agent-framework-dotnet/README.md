# CopilotKit.Intelligence.AgentFramework

Learned-skill delivery for native Microsoft Agent Framework `ChatClientAgent` agents. Version `0.1.0` targets .NET 9 and supports Agent Framework `>=1.0.0,<2.0.0`.

Publication requires a deployed learned-skill delivery API and a published canonical `CopilotKit.Intelligence` client with `GetLearnedSkillsSnapshotAsync`. This source checkout uses the canonical client project in the same repository.

## Setup

Set `CPK_INTELLIGENCE_API_KEY` and `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID` on the server. Set `INTELLIGENCE_API_URL` for a self-hosted server. Set `CPK_INTELLIGENCE_SKILLS_REVISION` to pin one exact revision.

```csharp
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

// chatClient is your application's IChatClient.
using var skills = new SkillRegistryContextProvider(new SkillRegistryOptions());
try
{
    await skills.InitializeAsync();
}
catch (LearnedSkillsException error)
{
    Console.Error.WriteLine(error.Message);
    // The application remains alive. A later invocation retries the check.
}

var agent = skills.CreateAgent(chatClient, new ChatClientAgentOptions
{
    Name = "support",
    ChatOptions = new() { Instructions = "Follow the application's support policy." }
});
var response = await agent.RunAsync("Help with a refund.");
Console.WriteLine(response.Text);
```

`CreateAgent` copies the supplied agent configuration. Existing developer instructions, context providers, and tools remain in place. Each invocation receives a delimited catalog and two native tools: `copilotkit_load_skill(skill_name)` and `copilotkit_read_skill_file(skill_name, path)`. The tools remain available when the registry is empty. Reads stay inside that invocation's immutable snapshot; supporting files must contain UTF-8 text. Tool errors follow the framework's normal behavior.

Developer instructions outrank learned skills. The adapter asks the model to load relevant skills, but does not guarantee model selection or compliance. It does not execute scripts.

## Dependency injection

```csharp
services.AddCopilotKitIntelligenceSkills(
    "support",
    new SkillRegistryOptions { ContainerId = "your-container" },
    provider => provider.GetRequiredService<IChatClient>(),
    new ChatClientAgentOptions
    {
        ChatOptions = new() { Instructions = "Follow the application's support policy." }
    });

// Resolve both services with the same key.
var skills = serviceProvider.GetRequiredKeyedService<SkillRegistryContextProvider>("support");
await skills.InitializeAsync();
var agent = serviceProvider.GetRequiredKeyedService<AIAgent>("support");
```

Import `Microsoft.Extensions.DependencyInjection` for these extensions. DI owns the registered context provider. An injected canonical Intelligence client remains application-owned. To share one registry across several selected agents, call `CreateAgent` on the same provider. Subagents receive learned skills only when explicitly configured; the adapter does not discover or modify an agent hierarchy.

## Lifecycle and status

Explicit configuration overrides environment values. `Client` accepts an existing canonical `IntelligenceClient`; its connection configuration is authoritative, and the adapter creates no second HTTP client. `FreshnessWindow` and `RequestTimeout` default to five seconds. A zero freshness window checks on every invocation. Debug output is disabled unless `Debug` is true; diagnostics contain no credentials, response bodies, or skill contents.

`InitializeAsync` is optional preload. Missed or concurrent initialization shares the same refresh used by invocations. A verified empty snapshot counts as initialized. Cancellation of one waiter does not cancel a shared refresh needed by another invocation.

`Status` returns immutable `Initialized`, `Revision`, `Mode`, `LastCheckedAt`, `Stale`, and `LastError` fields. `LastCheckedAt` records the last successful check, including a matching 304 response. Failures throw `LearnedSkillsException` with stable `Code`, `Message`, and `Retryable` fields; `InnerException` is available for explicit diagnostics.

A transient failure keeps a previously verified snapshot available with no maximum stale age. Confirmed denial blocks new invocations until a successful authorization check. An invocation already in progress retains its snapshot. Pinned mode still checks access and revocation and never substitutes a different revision. Disposal cancels pending refreshes and releases only an adapter-owned canonical client. There is no disk cache or coordination across registry instances or processes.

## Supported native execution

Use `CreateAgent` or the DI extension for complete invocation checks. Direct attachment through `AIContextProviders` supplies the catalog and tools, but cannot guard background continuations: Agent Framework skips all context providers for those calls.

The creation helper rejects background responses and continuation tokens with `INVALID_CONFIG` before model execution. Ordinary new runs, streaming runs, and tool-result resumes with new messages use native framework execution and acquire a new pin. Custom client stacks using `UseProvidedChatClientAsIs` must supply their own native function-invocation decorator. Arbitrary custom agents are outside the turnkey scope.

## Development

From the repository root, with .NET 9 installed:

```sh
pnpm nx run intelligence-agent-framework-dotnet:test
pnpm nx run intelligence-agent-framework-dotnet:build
pnpm nx run intelligence-agent-framework-dotnet:pack
```

Tests use shared snapshot and lifecycle fixtures plus the real `ChatClientAgent` with a deterministic model client. The native tests cover streaming tool loops, refresh during a run, denial during a pinned run, keyed DI, and continuation guards. Package publication is a separate release step after the canonical client and server prerequisites.
