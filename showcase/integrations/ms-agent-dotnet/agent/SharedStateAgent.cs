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
        catch (InvalidOperationException ex)
        {
            // Thrown when the attached TypeInfoResolver is incapable of
            // producing metadata for JsonElement (e.g. a locked context-only
            // resolver). Narrow the catch deliberately: programmer errors
            // like NullReferenceException or environment failures like
            // TypeLoadException/FileNotFoundException are NOT misattributed to
            // "resolver can't handle JsonElement" — they bubble up unchanged.
            throw new ArgumentException(
                "JsonSerializerOptions must provide a type resolver that can handle JsonElement.",
                nameof(jsonSerializerOptions),
                ex);
        }
        catch (NotSupportedException ex)
        {
            // Thrown when the resolver explicitly refuses to handle the type.
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

    /// <summary>
    /// Streams updates from the inner agent, optionally wrapped in a
    /// two-pass JSON-schema state-sync flow when the caller's AG-UI state
    /// carries sales data. On the success path the emitted stream contains
    /// a <see cref="DataContent"/> update carrying the JSON state snapshot
    /// (application/json). On the deserialize-failure fallback path the
    /// stream contains ONLY the buffered text updates from the first pass —
    /// no <see cref="DataContent"/> is emitted, and no user-facing notice is
    /// injected. Consumers that need to detect the fallback (e.g. to surface
    /// "[state sync unavailable]" in the UI) should observe the absence of
    /// any <see cref="DataContent"/> update in the emitted stream.
    /// </summary>
    public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentThread? thread = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);

        // Materialize the input messages exactly once. The original method body
        // enumerated `messages` twice: once to build `firstRunMessages` on the
        // structured-output pass (gated by `ShouldForceStructuredOutput`) and
        // again to build `secondRunMessages` on the summary pass (gated by
        // `ShouldEmitStateSnapshot`). A caller passing a single-use iterator
        // (e.g. a `yield return`-based generator) would silently yield nothing
        // on the second pass, and the "concise summary" request would run
        // without any user context. Materialize up-front to be safe.
        var messageList = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();

        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } chatRunOptions ||
            !properties.TryGetValue("ag_ui_state", out JsonElement state) ||
            !ShouldForceStructuredOutput(state))
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
        // Total chars we dropped after hitting the cap. Logged as a final
        // summary on stream completion so operators can see the true drop
        // volume — not just "we hit the cap" (the one-shot warning) but
        // "we dropped N additional chars after that".
        var droppedAfterCapChars = 0;
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
                // exactly once on first drop to avoid spam, and emit a final
                // summary with the total dropped chars below.
                var incomingChars = update.Contents.OfType<TextContent>().Sum(tc => tc.Text?.Length ?? 0);
                if (bufferedTextCharCount + incomingChars <= MaxBufferedTextChars)
                {
                    bufferedTextUpdates.Add(update);
                    bufferedTextCharCount += incomingChars;
                }
                else
                {
                    droppedAfterCapChars += incomingChars;
                    if (!bufferCapWarned)
                    {
                        bufferCapWarned = true;
                        _logger.LogWarning(
                            "SharedStateAgent: buffered text updates exceeded {Cap} chars; dropping subsequent text updates for deserialize-failure fallback.",
                            MaxBufferedTextChars);
                    }
                }
            }
        }

        // Final summary for the buffer cap. Emitted only when the cap was
        // actually hit, so quiet streams don't produce noisy logs. Reports
        // buffered chars vs. dropped chars so operators can size the cap
        // against real traffic rather than guess.
        if (bufferCapWarned)
        {
            _logger.LogWarning(
                "SharedStateAgent: first-pass stream complete. Buffered {Buffered} chars (cap {Cap}); dropped {Dropped} additional chars after cap was hit.",
                bufferedTextCharCount,
                MaxBufferedTextChars,
                droppedAfterCapChars);
        }

        var response = allUpdates.ToAgentRunResponse();

        if (response.TryDeserialize(_jsonSerializerOptions, out JsonElement stateSnapshot))
        {
            if (ShouldEmitStateSnapshot(stateSnapshot))
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

    /// <summary>
    /// Inbound predicate: should we FORCE the two-pass JSON-schema flow for
    /// this request? We only do so when the caller's shared state already
    /// carries sales data; otherwise a plain chat prompt like "hello" would
    /// be forced into <c>ResponseFormat=json</c> and yield unparseable garbage.
    /// </summary>
    /// <remarks>
    /// Currently delegates to <see cref="StateContainsSalesData"/>; the
    /// inbound and outbound decisions happen to share the same predicate
    /// today but are conceptually distinct (see
    /// <see cref="ShouldEmitStateSnapshot"/>). Keeping them as separate named
    /// helpers documents the intent and lets the two policies diverge later
    /// without re-auditing every call site.
    /// </remarks>
    internal static bool ShouldForceStructuredOutput(JsonElement state)
        => StateContainsSalesData(state);

    /// <summary>
    /// Outbound predicate: should we EMIT a <c>DataContent</c> state snapshot
    /// to the client? A trivial snapshot (empty/no todos) would stomp rich
    /// client state with <c>{todos: []}</c>; we only emit when the model
    /// actually produced meaningful sales data.
    /// </summary>
    /// <remarks>
    /// Currently delegates to <see cref="StateContainsSalesData"/>; see
    /// <see cref="ShouldForceStructuredOutput"/> for why the two policies
    /// are named separately despite sharing an implementation today.
    /// </remarks>
    internal static bool ShouldEmitStateSnapshot(JsonElement stateSnapshot)
        => StateContainsSalesData(stateSnapshot);

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
