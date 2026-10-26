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
    private readonly Func<Func<IChatClient, IChatClient>, IChatClient> _buildAnswerClient;

    // The builder must decorate the raw provider before composing any configured
    // executors. It transfers ownership on return and cleans partial builds on failure.
    public SharedStateAgent(AIAgent innerAgent, JsonSerializerOptions jsonSerializerOptions,
        Func<Func<IChatClient, IChatClient>, IChatClient> buildAnswerClient)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(buildAnswerClient);
        _jsonSerializerOptions = jsonSerializerOptions;
        _buildAnswerClient = buildAnswerClient;
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
        // AIAgent snapshots request messages before forwarding the original enumerable.
        // Reuse that snapshot so a single-use conversation is not enumerated again.
        var runContext = CurrentRunContext;
        var requestMessages = runContext is not null && ReferenceEquals(runContext.Agent, this)
            ? runContext.RequestMessages
            : messages.ToList();

        if (options is not ChatClientAgentRunOptions { ChatOptions: { } chatOptions } chatRunOptions ||
            !chatOptions.TryGetRunAgentInput(out RunAgentInput? input) ||
            input.State is not { } state ||
            !IsProverbsState(state))
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(requestMessages, session, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
            yield break;
        }

        var firstRunChatOptions = chatRunOptions.ChatOptions.Clone();
        var firstRunOptions = new ChatClientAgentRunOptions(firstRunChatOptions)
        {
            ChatClientFactory = chatRunOptions.ChatClientFactory,
            AdditionalProperties = chatRunOptions.AdditionalProperties?.Clone(),
        };
        var selectedHistory = SelectPhaseHistoryProvider(chatRunOptions, session);
        var stateHistory = selectedHistory is null ? null : new PhaseHistoryProvider(selectedHistory, requestMessages, deferCompletion: true);
        if (stateHistory is not null)
        {
            SetPhaseHistoryProvider(firstRunOptions, stateHistory);
        }

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

        var firstRunMessages = requestMessages.Append(stateUpdateMessage);

        var allUpdates = new List<AgentResponseUpdate>();
        // Text from the first run is withheld, because on the happy path it IS
        // the JSON state snapshot and must not be shown to the user. The updates
        // are kept so they can still be delivered if the first run turns
        // out not to be a state snapshot at all (see below).
        var withheldTextUpdates = new List<AgentResponseUpdate>();
        await foreach (var update in InnerAgent.RunStreamingAsync(firstRunMessages, session, firstRunOptions, cancellationToken).ConfigureAwait(false))
        {
            allUpdates.Add(update);

            // Forward non-text content (tool calls, etc.) immediately, while
            // keeping mixed-update text in the ordered fallback buffer.
            bool hasNonTextContent = update.Contents.Any(c => c is not TextContent);
            if (hasNonTextContent && update.Contents.Any(c => c is TextContent))
            {
                withheldTextUpdates.Add(ProjectUpdate(update, textOnly: true));
                yield return ProjectUpdate(update, textOnly: false);
            }
            else if (hasNonTextContent)
            {
                yield return update;
            }
            else
            {
                withheldTextUpdates.Add(update);
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

        if (stateSnapshot is not { } parsedStateSnapshot || !IsProverbsState(parsedStateSnapshot))
        {
            if (stateHistory is not null)
            {
                await stateHistory.CommitFallbackAsync(cancellationToken).ConfigureAwait(false);
            }
            // The model did not return a valid proverbs snapshot — a plain
            // conversational turn, a refusal, or a provider that
            // does not honour the JSON-schema response format. Deliver that answer
            // instead of dropping it: swallowing it here ends the run with no
            // assistant message at all while still reporting success, which is
            // indistinguishable to the user from the agent being broken.
            foreach (var update in withheldTextUpdates)
            {
                yield return update;
            }

            yield break;
        }

        stateHistory?.Discard();

        // The wrapper owns only proverbs. Preserve the caller's other state fields
        // rather than replacing the entire state with the schema-limited response.
        using var stateStream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stateStream))
        {
            writer.WriteStartObject();
            foreach (var property in state.EnumerateObject())
            {
                if (!property.NameEquals("proverbs"))
                {
                    property.WriteTo(writer);
                }
            }
            writer.WritePropertyName("proverbs");
            parsedStateSnapshot.GetProperty("proverbs").WriteTo(writer);
            writer.WriteEndObject();
        }
        byte[] stateBytes = stateStream.ToArray();
        yield return new AgentResponseUpdate
        {
            Contents = [new DataContent(stateBytes, "application/json")]
        };

        // Keep tool context, but replace the schema-limited text with the exact
        // merged state just published. These private copies leave streamed content
        // untouched; the phase history provider stores only the logical turn.
        var answerContextMessages = response.Messages.Select(message =>
        {
            var clone = message.Clone();
            clone.Contents = clone.Contents.Where(content => content is not TextContent).ToList();
            return clone;
        }).Where(message => message.Contents.Count > 0);
        var secondRunMessages = requestMessages.Concat(answerContextMessages)
            .Append(new ChatMessage(ChatRole.Assistant, System.Text.Encoding.UTF8.GetString(stateBytes))).Append(
            new ChatMessage(
                ChatRole.System,
                [new TextContent("Answer the user's original request using the conversation and the resulting proverbs state above. Mention state changes only when relevant to that request. Do not display the state snapshot JSON.")]));

        IChatClient? ownedAnswerPipeline = null;
        try
        {
            var answerOptions = CreateAnswerOptions(chatRunOptions, client => ownedAnswerPipeline = client);
            if (selectedHistory is not null)
            {
                SetPhaseHistoryProvider(answerOptions, new PhaseHistoryProvider(selectedHistory, requestMessages, deferCompletion: false));
            }
            await foreach (var update in InnerAgent.RunStreamingAsync(secondRunMessages, session, answerOptions, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
        }
        finally
        {
            // The SDK iterator has unwound before its request-local pipeline is released.
            ownedAnswerPipeline?.Dispose();
        }
    }

    private ChatHistoryProvider? SelectPhaseHistoryProvider(ChatClientAgentRunOptions options, AgentSession? session)
    {
        // Only normal framework-managed history is covered here. Other agents,
        // service conversations and independently persisting context providers
        // retain their existing invocation behavior.
        if (InnerAgent is not ChatClientAgent agent || agent.AIContextProviders is { Count: > 0 } ||
            agent.GetService(typeof(ChatClientAgentOptions)) is ChatClientAgentOptions { RequirePerServiceCallChatHistoryPersistence: true } ||
            !string.IsNullOrWhiteSpace(options.ChatOptions?.ConversationId) ||
            (session is not null && (session is not ChatClientAgentSession chatSession || !string.IsNullOrWhiteSpace(chatSession.ConversationId))))
        {
            return null;
        }

        var defaults = agent.GetService(typeof(ChatOptions)) as ChatOptions;
        if (!string.IsNullOrWhiteSpace(defaults?.ConversationId))
        {
            return null;
        }

        // Mirror the SDK's raw-key precedence before asking for a typed value:
        // an invalid higher-precedence value must still mask a lower one.
        var properties = defaults?.AdditionalProperties?.Clone() ?? new AdditionalPropertiesDictionary();
        if (options.ChatOptions?.AdditionalProperties is { } chatProperties)
        {
            foreach (var entry in chatProperties) properties[entry.Key] = entry.Value;
        }
        if (options.AdditionalProperties is { } runProperties)
        {
            foreach (var entry in runProperties) properties[entry.Key] = entry.Value;
        }
        return properties.TryGetValue(out ChatHistoryProvider? provider) ? provider : agent.ChatHistoryProvider;
    }

    private static void SetPhaseHistoryProvider(ChatClientAgentRunOptions options, ChatHistoryProvider provider)
    {
        options.AdditionalProperties ??= [];
        options.AdditionalProperties[typeof(ChatHistoryProvider).FullName!] = provider;
    }

    private sealed class PhaseHistoryProvider(ChatHistoryProvider selectedProvider, IEnumerable<ChatMessage> requestMessages, bool deferCompletion) : ChatHistoryProvider
    {
        private readonly ChatHistoryProvider _selectedProvider = selectedProvider;
        private readonly IEnumerable<ChatMessage> _requestMessages = requestMessages;
        private readonly bool _deferCompletion = deferCompletion;
        private InvokedContext? _pendingCompletion;

        public override IReadOnlyList<string> StateKeys => _selectedProvider.StateKeys;

        protected override ValueTask<IEnumerable<ChatMessage>> InvokingCoreAsync(InvokingContext context, CancellationToken cancellationToken = default) =>
            _selectedProvider.InvokingAsync(context, cancellationToken);

        protected override ValueTask InvokedCoreAsync(InvokedContext context, CancellationToken cancellationToken = default)
        {
            if (_deferCompletion && context.InvokeException is null)
            {
                // Retain only this completed phase until snapshot validation.
                _pendingCompletion = context;
                return default;
            }
            return ForwardCompletionAsync(context, cancellationToken);
        }

        public void Discard() => _pendingCompletion = null;

        public ValueTask CommitFallbackAsync(CancellationToken cancellationToken)
        {
            var context = _pendingCompletion;
            _pendingCompletion = null;
            if (context is null) return default;

            // A rejected snapshot is the actual logical response. Preserve all
            // SDK messages, including tool calls/results and other non-text content.
            return ForwardCompletionAsync(context, cancellationToken);
        }

        private ValueTask ForwardCompletionAsync(InvokedContext context, CancellationToken cancellationToken, IEnumerable<ChatMessage>? responseMessages = null)
        {
#pragma warning disable MAAI001 // The pinned SDK exposes the successful history completion constructor as experimental.
            var logicalContext = context.InvokeException is { } exception
                ? new InvokedContext(context.Agent, context.Session, _requestMessages, exception)
                : new InvokedContext(context.Agent, context.Session, _requestMessages, responseMessages ?? context.ResponseMessages!);
#pragma warning restore MAAI001
            return _selectedProvider.InvokedAsync(logicalContext, cancellationToken);
        }
    }

    private ChatClientAgentRunOptions CreateAnswerOptions(ChatClientAgentRunOptions original, Action<IChatClient> takeOwnership)
    {
        var answerOptions = (ChatClientAgentRunOptions)original.Clone();
        answerOptions.ChatOptions!.ToolMode = ChatToolMode.None;
        var originalFactory = answerOptions.ChatClientFactory;
        bool answerClientCreated = false;
        answerOptions.ChatClientFactory = client =>
        {
            if (answerClientCreated) throw new InvalidOperationException("The answer pipeline was already constructed for this run.");
            answerClientCreated = true;
            // Retain visible declaration shadows for provider compatibility only.
            // Execution safety comes from the provider boundary below every invoker.
            var additionalTools = client.GetService<FunctionInvokingChatClient>()?.AdditionalTools?.ToList();
            var configuredAnswerClient = _buildAnswerClient(provider => new ConfigureOptionsChatClient(
                new AnswerToolCallBoundaryChatClient(new NonOwningChatClient(provider)), chatOptions =>
            {
                var declarations = chatOptions.Tools?
                    .Select(tool => tool is AIFunction function ? function.AsDeclarationOnly() : tool)
                    .ToList() ?? [];
                if (additionalTools is not null)
                {
                    foreach (var tool in additionalTools)
                    {
                        if (!declarations.Any(existing => existing is AIFunctionDeclaration &&
                            string.Equals(existing.Name, tool.Name, StringComparison.Ordinal)))
                        {
                            declarations.Add(tool is AIFunction function ? function.AsDeclarationOnly() : tool);
                        }
                    }
                }
                chatOptions.ToolMode = ChatToolMode.None;
                chatOptions.Tools = declarations;
            })) ?? throw new InvalidOperationException("The answer pipeline builder returned null.");
            takeOwnership(configuredAnswerClient);
            // Caller wrappers cannot dispose the owned pipeline before the iterator unwinds.
            var boundary = new AnswerToolCallBoundaryChatClient(new NonOwningChatClient(configuredAnswerClient));
            return originalFactory is null ? boundary : originalFactory(boundary)
                ?? throw new InvalidOperationException("The caller chat client factory returned null.");
        };
        return answerOptions;
    }

    private sealed class AnswerToolCallBoundaryChatClient(IChatClient innerClient) : IChatClient
    {
        public async Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            var response = await innerClient.GetResponseAsync(messages, options, cancellationToken).ConfigureAwait(false);
            foreach (var message in response.Messages)
            {
                MakeInformational(message.Contents);
            }
            return response;
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await foreach (var update in innerClient.GetStreamingResponseAsync(messages, options, cancellationToken).ConfigureAwait(false))
            {
                MakeInformational(update.Contents);
                yield return update;
            }
        }

        public object? GetService(Type serviceType, object? serviceKey = null) =>
            serviceKey is null && serviceType.IsInstanceOfType(this)
                ? this : innerClient.GetService(serviceType, serviceKey);

        public void Dispose() => innerClient.Dispose();

        private static void MakeInformational(IEnumerable<AIContent> contents)
        {
            foreach (var call in contents.OfType<FunctionCallContent>())
            {
                call.InformationalOnly = true;
            }
        }
    }

    private sealed class NonOwningChatClient(IChatClient innerClient) : DelegatingChatClient(innerClient)
    {
        protected override void Dispose(bool disposing) { }
    }

    private static AgentResponseUpdate ProjectUpdate(AgentResponseUpdate update, bool textOnly) =>
        new()
        {
            Contents = update.Contents.Where(c => (c is TextContent) == textOnly).ToList(),
            AdditionalProperties = update.AdditionalProperties,
            AuthorName = update.AuthorName,
            Role = update.Role,
            RawRepresentation = update.RawRepresentation,
            AgentId = update.AgentId,
            ResponseId = update.ResponseId,
            MessageId = update.MessageId,
            CreatedAt = update.CreatedAt,
            ContinuationToken = update.ContinuationToken,
            FinishReason = update.FinishReason,
        };

    private static bool IsProverbsState(JsonElement state) =>
        state.ValueKind == JsonValueKind.Object &&
        state.TryGetProperty("proverbs", out var proverbs) &&
        proverbs.ValueKind == JsonValueKind.Array &&
        proverbs.EnumerateArray().All(proverb => proverb.ValueKind == JsonValueKind.String);
}
