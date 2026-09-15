using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using AGUI.Abstractions;
using AGUI.Server;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by ProverbsAgentFactory")]
internal sealed class SharedStateAgent : DelegatingAIAgent
{
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public SharedStateAgent(AIAgent innerAgent, JsonSerializerOptions jsonSerializerOptions)
        : base(innerAgent)
    {
        _jsonSerializerOptions = jsonSerializerOptions;
    }

    protected override Task<AgentResponse> RunCoreAsync(IEnumerable<ChatMessage> messages, AgentSession? session = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default)
    {
        return RunCoreStreamingAsync(messages, session, options, cancellationToken).ToAgentResponseAsync(cancellationToken);
    }

    protected override async IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (options is not ChatClientAgentRunOptions { ChatOptions: { } chatOptions } chatRunOptions ||
            !chatOptions.TryGetRunAgentInput(out RunAgentInput? input) ||
            input.State is not { ValueKind: JsonValueKind.Object } state)
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(messages, session, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
            yield break;
        }

        var firstRunChatOptions = chatRunOptions.ChatOptions.Clone();
        var firstRunOptions = new ChatClientAgentRunOptions(firstRunChatOptions)
        {
            ChatClientFactory = chatRunOptions.ChatClientFactory,
        };

        // Configure JSON schema response format for structured state output
        firstRunChatOptions.ResponseFormat = ChatResponseFormat.ForJsonSchema<ProverbsStateSnapshot>(
            schemaName: "ProverbsStateSnapshot",
            schemaDescription: "A response containing the current list of proverbs");

        ChatMessage stateUpdateMessage = new(
            ChatRole.System,
            [
                new TextContent("Here is the current state in JSON format:"),
                new TextContent(state.GetRawText()),
                new TextContent("The new state is:")
            ]);

        var firstRunMessages = messages.Append(stateUpdateMessage);

        var allUpdates = new List<AgentResponseUpdate>();
        await foreach (var update in InnerAgent.RunStreamingAsync(firstRunMessages, session, firstRunOptions, cancellationToken).ConfigureAwait(false))
        {
            allUpdates.Add(update);

            // Yield all non-text updates (tool calls, etc.)
            bool hasNonTextContent = update.Contents.Any(c => c is not TextContent);
            if (hasNonTextContent)
            {
                yield return update;
            }
        }

        var response = allUpdates.ToAgentResponse();

        JsonElement? stateSnapshot = null;
        try
        {
            stateSnapshot = JsonSerializer.Deserialize<JsonElement>(response.Text, _jsonSerializerOptions);
        }
        catch (JsonException)
        {
            // The model did not return the requested state snapshot.
        }

        if (stateSnapshot is not { } parsedStateSnapshot)
        {
            yield break;
        }

        byte[] stateBytes = JsonSerializer.SerializeToUtf8Bytes(
            parsedStateSnapshot,
            _jsonSerializerOptions.GetTypeInfo(typeof(JsonElement)));
        yield return new AgentResponseUpdate
        {
            Contents = [new DataContent(stateBytes, "application/json")]
        };

        var secondRunMessages = messages.Concat(response.Messages).Append(
            new ChatMessage(
                ChatRole.System,
                [new TextContent("Please provide a concise summary of the state changes in at most two sentences.")]));

        await foreach (var update in InnerAgent.RunStreamingAsync(secondRunMessages, session, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }
    }
}
