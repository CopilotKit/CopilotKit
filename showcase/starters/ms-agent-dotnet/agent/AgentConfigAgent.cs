using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// AgentConfigAgent — the /agent-config demo.
//
// Reads three forwarded properties — tone, expertise, responseLength — from
// the AG-UI shared-state payload (attached as `ag_ui_state` on
// ChatClientAgentRunOptions.AdditionalProperties, matching the convention
// already used by SharedStateAgent) and builds a dynamic system prompt per
// turn.
//
// The frontend <CopilotKitProvider agent="agent-config-demo" />'s
// useAgent().setState(...) call pushes the typed config into shared state;
// this agent reads it on every run and prepends a system message that adapts
// the inner ChatClientAgent's behavior. Missing / unrecognized values fall
// back to the documented defaults — the agent never throws on malformed
// config, so a misbehaving frontend can't kill the demo.
[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by SalesAgentFactory")]
internal sealed class AgentConfigAgent : DelegatingAIAgent
{
    private static readonly HashSet<string> ValidTones = new(StringComparer.Ordinal)
    {
        "professional",
        "casual",
        "enthusiastic",
    };

    private static readonly HashSet<string> ValidExpertise = new(StringComparer.Ordinal)
    {
        "beginner",
        "intermediate",
        "expert",
    };

    private static readonly HashSet<string> ValidResponseLengths = new(StringComparer.Ordinal)
    {
        "concise",
        "detailed",
    };

    private const string DefaultTone = "professional";
    private const string DefaultExpertise = "intermediate";
    private const string DefaultResponseLength = "concise";

    private readonly ILogger<AgentConfigAgent> _logger;

    public AgentConfigAgent(AIAgent innerAgent, ILogger<AgentConfigAgent>? logger = null)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(innerAgent);
        _logger = logger ?? NullLogger<AgentConfigAgent>.Instance;
    }

    public override Task<AgentRunResponse> RunAsync(IEnumerable<ChatMessage> messages, AgentThread? thread = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default)
    {
        return RunStreamingAsync(messages, thread, options, cancellationToken).ToAgentRunResponseAsync(cancellationToken);
    }

    public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentThread? thread = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);

        // Materialize up-front so we can both inspect it (to read the state)
        // and forward it to the inner agent without re-enumerating a
        // single-use iterator.
        var messageList = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();

        var (tone, expertise, responseLength) = ReadConfig(options);
        var systemPrompt = BuildSystemPrompt(tone, expertise, responseLength);

        _logger.LogInformation(
            "AgentConfigAgent: tone={Tone}, expertise={Expertise}, responseLength={ResponseLength}",
            tone, expertise, responseLength);

        var systemMessage = new ChatMessage(ChatRole.System, systemPrompt);
        var augmentedMessages = new List<ChatMessage>(messageList.Count + 1) { systemMessage };
        augmentedMessages.AddRange(messageList);

        await foreach (var update in InnerAgent.RunStreamingAsync(augmentedMessages, thread, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }
    }

    /// <summary>
    /// Reads the forwarded config triple from the AG-UI shared-state payload
    /// attached to the run options. Any missing / unrecognized value falls
    /// back to the corresponding default constant. Never throws.
    /// </summary>
    internal static (string Tone, string Expertise, string ResponseLength) ReadConfig(AgentRunOptions? options)
    {
        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } ||
            !properties.TryGetValue("ag_ui_state", out JsonElement state) ||
            state.ValueKind != JsonValueKind.Object)
        {
            return (DefaultTone, DefaultExpertise, DefaultResponseLength);
        }

        var tone = ReadStringProperty(state, "tone", ValidTones, DefaultTone);
        var expertise = ReadStringProperty(state, "expertise", ValidExpertise, DefaultExpertise);
        var responseLength = ReadStringProperty(state, "responseLength", ValidResponseLengths, DefaultResponseLength);

        return (tone, expertise, responseLength);
    }

    private static string ReadStringProperty(JsonElement state, string name, HashSet<string> valid, string defaultValue)
    {
        if (!state.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return defaultValue;
        }
        var value = element.GetString();
        return value is not null && valid.Contains(value) ? value : defaultValue;
    }

    internal static string BuildSystemPrompt(string tone, string expertise, string responseLength)
    {
        var toneRule = tone switch
        {
            "casual" => "Use friendly, conversational language. Contractions OK. Light humor welcome.",
            "enthusiastic" => "Use upbeat, energetic language. Exclamation points OK. Emoji OK.",
            _ => "Use neutral, precise language. No emoji. Short sentences.",
        };
        var expertiseRule = expertise switch
        {
            "beginner" => "Assume no prior knowledge. Define jargon. Use analogies.",
            "expert" => "Assume technical fluency. Use precise terminology. Skip basics.",
            _ => "Assume common terms are understood; explain specialized terms.",
        };
        var lengthRule = responseLength switch
        {
            "detailed" => "Respond in multiple paragraphs with examples where relevant.",
            _ => "Respond in 1-3 sentences.",
        };

        return "You are a helpful assistant.\n\n" +
            $"Tone: {toneRule}\n" +
            $"Expertise level: {expertiseRule}\n" +
            $"Response length: {lengthRule}";
    }
}
