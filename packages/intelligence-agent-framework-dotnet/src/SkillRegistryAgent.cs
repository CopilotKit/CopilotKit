using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace CopilotKit.Intelligence.AgentFramework;

/// <summary>Guards modes where ChatClientAgent deliberately skips all context providers.</summary>
internal sealed class SkillRegistryAgent(AIAgent innerAgent, ChatOptions? defaults) : DelegatingAIAgent(innerAgent)
{
    internal static void RequireSupportedRun(ChatOptions? defaults, AgentRunOptions? options)
    {
        var chat = (options as ChatClientAgentRunOptions)?.ChatOptions;
        // Inspect experimental background APIs only to reject their context-provider bypass.
#pragma warning disable MEAI001
        if (options?.ContinuationToken is not null || chat?.ContinuationToken is not null || defaults?.ContinuationToken is not null
            || (options?.AllowBackgroundResponses ?? chat?.AllowBackgroundResponses ?? defaults?.AllowBackgroundResponses) is true)
            throw new LearnedSkillsException("INVALID_CONFIG", false);
#pragma warning restore MEAI001
    }

    protected override Task<AgentResponse> RunCoreAsync(IEnumerable<ChatMessage> messages, AgentSession? session = null,
        AgentRunOptions? options = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        RequireSupportedRun(defaults, options);
        return base.RunCoreAsync(messages, session, options, cancellationToken);
    }

    protected override IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(IEnumerable<ChatMessage> messages, AgentSession? session = null,
        AgentRunOptions? options = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        RequireSupportedRun(defaults, options);
        return base.RunCoreStreamingAsync(messages, session, options, cancellationToken);
    }
}
