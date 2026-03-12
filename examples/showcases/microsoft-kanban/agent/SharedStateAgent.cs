using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using ProverbsAgent.Models;

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by CanvasAgentFactory")]
internal sealed class SharedStateAgent : DelegatingAIAgent
{
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly AgentState _state;

    public SharedStateAgent(AIAgent innerAgent, JsonSerializerOptions jsonSerializerOptions, AgentState state)
        : base(innerAgent)
    {
        _jsonSerializerOptions = jsonSerializerOptions;
        _state = state;
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
        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } chatRunOptions ||
            !properties.TryGetValue("ag_ui_state", out JsonElement state))
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(messages, thread, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
            yield break;
        }

        // Hydrate backend state from frontend (frontend is source of truth)
        HydrateStateFromFrontend(state);

        var firstRunOptions = new ChatClientAgentRunOptions
        {
            ChatOptions = chatRunOptions.ChatOptions.Clone(),
            AllowBackgroundResponses = chatRunOptions.AllowBackgroundResponses,
            ContinuationToken = chatRunOptions.ContinuationToken,
            ChatClientFactory = chatRunOptions.ChatClientFactory,
        };

        // Configure JSON schema response format for structured state output
        firstRunOptions.ChatOptions.ResponseFormat = ChatResponseFormat.ForJsonSchema<AgentStateSnapshot>(
            schemaName: "AgentStateSnapshot",
            schemaDescription: "A response containing the current Kanban board state with all boards and tasks");

        // Filter out tool-related messages from incoming history to avoid "tool_calls must be followed by tool messages" errors
        var cleanMessages = messages.Where(m =>
            m.Role != ChatRole.Tool &&
            !m.Contents.Any(c => c is FunctionCallContent || c is FunctionResultContent));

        ChatMessage stateUpdateMessage = new(
            ChatRole.System,
            [
                new TextContent("Here is the current state in JSON format:"),
                new TextContent(state.GetRawText()),
                new TextContent("The new state is:")
            ]);

        var firstRunMessages = cleanMessages.Append(stateUpdateMessage);

        var allUpdates = new List<AgentRunResponseUpdate>();
        await foreach (var update in InnerAgent.RunStreamingAsync(firstRunMessages, thread, firstRunOptions, cancellationToken).ConfigureAwait(false))
        {
            allUpdates.Add(update);

            // Yield all non-text updates (tool calls, etc.)
            bool hasNonTextContent = update.Contents.Any(c => c is not TextContent);
            if (hasNonTextContent)
            {
                yield return update;
            }
        }

        var response = allUpdates.ToAgentRunResponse();

        // Serialize the ACTUAL backend state (not the LLM's interpretation)
        var stateSnapshot = new AgentStateSnapshot
        {
            Boards = _state.Boards,
            ActiveBoardId = _state.ActiveBoardId,
            LastAction = _state.LastAction
        };

        byte[] stateBytes = JsonSerializer.SerializeToUtf8Bytes(
            stateSnapshot,
            _jsonSerializerOptions.GetTypeInfo(typeof(AgentStateSnapshot)));

        yield return new AgentRunResponseUpdate
        {
            Contents = [new DataContent(stateBytes, "application/json")]
        };

        // Filter out tool-related messages to avoid "tool_calls must be followed by tool messages" errors
        var nonToolMessages = response.Messages.Where(m =>
            m.Role != ChatRole.Tool &&
            !m.Contents.Any(c => c is FunctionCallContent || c is FunctionResultContent));

        var secondRunMessages = cleanMessages.Concat(nonToolMessages).Append(
            new ChatMessage(
                ChatRole.System,
                [new TextContent("Please provide a concise summary of the state changes in at most two sentences.")]));

        await foreach (var update in InnerAgent.RunStreamingAsync(secondRunMessages, thread, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }
    }

    /// <summary>
    /// Hydrates the backend state from the frontend state (frontend is source of truth).
    /// This ensures the backend always starts with the current frontend state on each request.
    /// </summary>
    private void HydrateStateFromFrontend(JsonElement frontendState)
    {
        try
        {
            var incomingState = JsonSerializer.Deserialize<AgentStateSnapshot>(
                frontendState.GetRawText(),
                _jsonSerializerOptions);

            if (incomingState != null)
            {
                _state.Boards.Clear();
                _state.Boards.AddRange(incomingState.Boards);
                _state.ActiveBoardId = incomingState.ActiveBoardId;
                _state.LastAction = incomingState.LastAction ?? string.Empty;

                Console.WriteLine($"🔄 Hydrated state from frontend: {_state.Boards.Count} boards, active: {_state.ActiveBoardId}");
            }
        }
        catch (JsonException ex)
        {
            Console.WriteLine($"⚠️ Failed to hydrate state from frontend: {ex.Message}");
            // Keep existing backend state if deserialization fails
        }
    }
}
