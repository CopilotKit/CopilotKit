using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by SalesAgentFactory")]
internal sealed class SharedStateAgent : DelegatingAIAgent
{
    // Cap on the total character length of buffered first-pass text updates.
    // A pathological first-pass response could otherwise balloon memory — we
    // hold onto every TextContent chunk in case we need to replay it after a
    // failed structured-output deserialize. At ~1 MB we stop buffering new
    // text and log a warning; deserialize-failure fallback will replay only
    // what we managed to buffer.
    internal const int MaxBufferedTextChars = 1_000_000;

    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly ILogger<SharedStateAgent> _logger;

    public SharedStateAgent(AIAgent innerAgent, JsonSerializerOptions jsonSerializerOptions, ILogger<SharedStateAgent>? logger = null)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(innerAgent);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        // The structured-output path round-trips JsonElement through
        // JsonSerializerOptions.GetTypeInfo(typeof(JsonElement)). If the caller
        // hands us a context-only resolver that can't resolve JsonElement, the
        // first real request would blow up mid-stream. Fail fast here instead.
        try
        {
            _ = jsonSerializerOptions.GetTypeInfo(typeof(JsonElement));
        }
        catch (Exception ex)
        {
            throw new ArgumentException(
                "JsonSerializerOptions must provide a type resolver that can handle JsonElement.",
                nameof(jsonSerializerOptions),
                ex);
        }

        _jsonSerializerOptions = jsonSerializerOptions;
        _logger = logger ?? NullLogger<SharedStateAgent>.Instance;
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

        // Materialize the input messages exactly once. The original method body
        // enumerated `messages` twice: once at firstRunMessages (line ~90) and
        // again at secondRunMessages (line ~160). A caller passing a single-use
        // iterator (e.g. a `yield return`-based generator) would silently yield
        // nothing on the second pass, and the "concise summary" request would
        // run without any user context. Materialize up-front to be safe.
        var messageList = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();

        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } chatRunOptions ||
            !properties.TryGetValue("ag_ui_state", out JsonElement state) ||
            !StateContainsSalesData(state))
        {
            // Either there's no AG-UI state attached, or the attached state has no
            // sales data to synchronize. Either way, skip the structured-output
            // two-pass flow (which forces ResponseFormat=json) and run the agent
            // normally so text replies stream through. Forcing JSON output on a
            // plain chat prompt like "hello" produces an unparseable sales snapshot
            // and yields nothing to the client — that was the L3 smoke failure.
            await foreach (var update in InnerAgent.RunStreamingAsync(messageList, thread, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
            yield break;
        }

        var firstRunOptions = new ChatClientAgentRunOptions
        {
            ChatOptions = chatRunOptions.ChatOptions.Clone(),
            AllowBackgroundResponses = chatRunOptions.AllowBackgroundResponses,
            ContinuationToken = chatRunOptions.ContinuationToken,
            ChatClientFactory = chatRunOptions.ChatClientFactory,
        };

        // Configure JSON schema response format for structured state output
        firstRunOptions.ChatOptions.ResponseFormat = ChatResponseFormat.ForJsonSchema<SalesStateSnapshot>(
            schemaName: "SalesStateSnapshot",
            schemaDescription: "A response containing the current sales pipeline state");

        ChatMessage stateUpdateMessage = new(
            ChatRole.System,
            [
                new TextContent("Here is the current state in JSON format:"),
                new TextContent(state.GetRawText()),
                new TextContent("The new state is:")
            ]);

        var firstRunMessages = messageList.Append(stateUpdateMessage);

        var allUpdates = new List<AgentRunResponseUpdate>();
        var bufferedTextUpdates = new List<AgentRunResponseUpdate>();
        var bufferedTextCharCount = 0;
        var bufferCapWarned = false;
        await foreach (var update in InnerAgent.RunStreamingAsync(firstRunMessages, thread, firstRunOptions, cancellationToken).ConfigureAwait(false))
        {
            allUpdates.Add(update);

            // Policy for mixed-content updates: if an update carries BOTH text
            // and non-text content, we yield the whole update inline (including
            // the text portion) — this ensures tool-call data is never delayed
            // behind a structured-output decision. On deserialize-success we do
            // NOT re-buffer the text, and on deserialize-failure we replay only
            // the text-only updates in `bufferedTextUpdates`. This means a text
            // fragment carried alongside non-text content is emitted exactly
            // once — no duplication on either path.
            bool hasNonTextContent = update.Contents.Any(c => c is not TextContent);
            if (hasNonTextContent)
            {
                yield return update;
            }
            else if (update.Contents.Any(c => c is TextContent))
            {
                // Cap memory usage of the buffered replay. Once we exceed the
                // cap we stop retaining new text-only updates; deserialize
                // fallback will replay only what we managed to buffer. We log
                // exactly once to avoid spam.
                var incomingChars = update.Contents.OfType<TextContent>().Sum(tc => tc.Text?.Length ?? 0);
                if (bufferedTextCharCount + incomingChars <= MaxBufferedTextChars)
                {
                    bufferedTextUpdates.Add(update);
                    bufferedTextCharCount += incomingChars;
                }
                else if (!bufferCapWarned)
                {
                    bufferCapWarned = true;
                    _logger.LogWarning(
                        "SharedStateAgent: buffered text updates exceeded {Cap} chars; dropping subsequent text updates for deserialize-failure fallback.",
                        MaxBufferedTextChars);
                }
            }
        }

        var response = allUpdates.ToAgentRunResponse();

        if (response.TryDeserialize(_jsonSerializerOptions, out JsonElement stateSnapshot))
        {
            // StateContainsSalesData is applied symmetrically as a predicate but
            // serves different purposes on the inbound vs outbound sides:
            //   - Inbound (top of method): don't FORCE the two-pass JSON-schema
            //     flow when caller state is trivial (empty/no todos). Running a
            //     non-sales prompt like "hello" with ResponseFormat=json yields
            //     garbage.
            //   - Outbound (here): don't EMIT a trivial snapshot that would
            //     stomp rich client state with `{todos: []}`. If the model
            //     returned nothing meaningful, preserve whatever the client
            //     already has locally.
            // Same predicate, different action per direction.
            if (StateContainsSalesData(stateSnapshot))
            {
                byte[] stateBytes = JsonSerializer.SerializeToUtf8Bytes(
                    stateSnapshot,
                    _jsonSerializerOptions.GetTypeInfo(typeof(JsonElement)));
                yield return new AgentRunResponseUpdate
                {
                    Contents = [new DataContent(stateBytes, "application/json")]
                };
            }
            else
            {
                _logger.LogDebug(
                    "SharedStateAgent: deserialized state snapshot had no sales data; skipping DataContent emit.");
            }
        }
        else
        {
            // Deserialization failed. Rather than silently dropping everything
            // the model said during the first pass, replay the buffered text
            // updates so the user still sees a response.
            _logger.LogWarning(
                "SharedStateAgent: failed to deserialize structured state snapshot from first-pass response; falling back to buffered text updates ({Count} buffered).",
                bufferedTextUpdates.Count);

            foreach (var textUpdate in bufferedTextUpdates)
            {
                yield return textUpdate;
            }
            yield break;
        }

        // Second-pass options asymmetry: the first pass uses firstRunOptions
        // (a clone of the caller's ChatClientAgentRunOptions with ResponseFormat
        // overridden to a JSON schema) to force structured output. The second
        // pass deliberately passes the original `options` parameter (which may
        // be null) through to the inner agent — this lets it fall back to the
        // inner agent's default chat behavior for the follow-up summary and
        // avoids any lingering JSON-schema response format.
        var secondRunMessages = messageList.Concat(response.Messages).Append(
            new ChatMessage(
                ChatRole.System,
                [new TextContent("Please provide a concise summary of the state changes in at most two sentences.")]));

        await foreach (var update in InnerAgent.RunStreamingAsync(secondRunMessages, thread, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }
    }

    // The state-snapshot two-pass flow is only meaningful when the shared state
    // actually carries sales data (i.e. the shared-state / sales-pipeline demos:
    // shared-state-read, shared-state-write). For generic demos like agentic-chat
    // the state payload is an empty object and we must not force JSON-schema
    // output on the model.
    //
    // Shape check: we require `todos` to be a non-empty array AND each element
    // to be a JSON object (the expected SalesTodo shape). This rejects malformed
    // payloads like {"todos":[1,2,3]} or {"todos":[null]} that would otherwise
    // slip through and confuse downstream rendering. We intentionally do NOT
    // require specific property keys on each element — the model is free to
    // emit partial todos during streaming, and strict key validation would
    // over-reject valid interim shapes.
    internal static bool StateContainsSalesData(JsonElement state)
    {
        if (state.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!state.TryGetProperty("todos", out var todos))
        {
            return false;
        }

        if (todos.ValueKind != JsonValueKind.Array || todos.GetArrayLength() == 0)
        {
            return false;
        }

        foreach (var todo in todos.EnumerateArray())
        {
            if (todo.ValueKind != JsonValueKind.Object)
            {
                return false;
            }
        }

        return true;
    }
}
