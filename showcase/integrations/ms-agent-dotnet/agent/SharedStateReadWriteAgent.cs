using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using OpenAI;
using System.ClientModel;

// SharedStateReadWriteAgent — backs the /shared-state-read-write demo.
//
// Mirrors langgraph-python/src/agents/shared_state_read_write.py and the
// google-adk shared_state_read_write_agent.py reference:
//
//   * UI -> agent (write):  the page owns a `preferences` object and writes it
//     to AG-UI shared state via `agent.setState({ preferences })`. We read it
//     out of `ChatClientAgentRunOptions.AdditionalProperties["ag_ui_state"]`
//     on every turn and prepend a system message describing the user's prefs
//     so the LLM adapts its tone, language, etc.
//
//   * agent -> UI (read):  the `set_notes` tool stores the FULL updated
//     notes list on the wrapping agent (per-thread keyed by AgentThread
//     reference). After the inner ChatClientAgent's stream completes we emit
//     a DataContent("application/json") payload carrying the snapshot
//     `{ preferences, notes }`, which the .NET AG-UI bridge surfaces to the
//     client as a state-snapshot event. The frontend's `useAgent` hook then
//     re-renders the notes card.
//
// Notes on shape parity with the Python references:
//   * Preferences shape is { name, tone: "formal"|"casual"|"playful",
//     language, interests: string[] }. Unrecognized values are tolerated and
//     forwarded into the system prompt verbatim — the agent does not throw.
//   * The tool always replaces the notes array with the full updated list
//     (not a diff). This matches the documented `set_notes` contract used by
//     all reference implementations.
[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by SharedStateReadWriteAgentFactory")]
internal sealed class SharedStateReadWriteAgent : DelegatingAIAgent
{
    private readonly ILogger<SharedStateReadWriteAgent> _logger;
    private readonly SharedStateReadWriteStore _store;

    public SharedStateReadWriteAgent(
        AIAgent innerAgent,
        SharedStateReadWriteStore store,
        ILogger<SharedStateReadWriteAgent>? logger = null)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(innerAgent);
        ArgumentNullException.ThrowIfNull(store);

        _store = store;
        _logger = logger ?? NullLogger<SharedStateReadWriteAgent>.Instance;
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

        // Materialize once so we can read state and forward to the inner agent
        // without re-enumerating a single-use iterator.
        var messageList = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();

        // Read inbound preferences out of AG-UI shared state and reconcile
        // them with the per-thread store so the `set_notes` tool sees an
        // up-to-date snapshot. Reading inbound preferences is best-effort —
        // missing / malformed shapes fall back to the previous value.
        var inboundPreferences = TryReadPreferences(options);
        var inboundNotes = TryReadNotes(options);
        _store.MergeFromInbound(thread, inboundPreferences, inboundNotes);

        var systemPrompt = BuildPreferencesSystemPrompt(_store.GetPreferences(thread));
        _logger.LogInformation(
            "SharedStateReadWriteAgent: injecting preferences system prompt ({Bytes} bytes)",
            systemPrompt.Length);

        var augmentedMessages = new List<ChatMessage>(messageList.Count + 1)
        {
            new(ChatRole.System, systemPrompt),
        };
        augmentedMessages.AddRange(messageList);

        // Bind the `set_notes` tool's write target to the current thread.
        // The tool closure doesn't receive an AgentThread argument, so it
        // resolves the slot via the store's AsyncLocal active-thread handle.
        // Without this, every notes write would land in the per-instance
        // global slot, causing notes to silently disappear from the UI and
        // leaking across concurrent threads.
        var prior = _store.SetActiveThread(thread);
        try
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(augmentedMessages, thread, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
        }
        finally
        {
            _store.RestoreActiveThread(prior);
        }

        // Emit the post-turn state snapshot so the UI's useAgent hook sees
        // tool-driven mutations to `notes` as well as the canonical copy of
        // `preferences`. Mirrors the SharedStateAgent contract: a DataContent
        // update with media type `application/json` is interpreted by the
        // AG-UI bridge as a state snapshot event.
        var snapshot = _store.BuildSnapshot(thread);
        var snapshotBytes = JsonSerializer.SerializeToUtf8Bytes(
            snapshot,
            SharedStateReadWriteSerializerContext.Default.SharedStateReadWriteSnapshot);
        yield return new AgentRunResponseUpdate
        {
            Contents = [new DataContent(snapshotBytes, "application/json")],
        };
    }

    /// <summary>
    /// Builds the per-turn preferences system prompt prepended ahead of the
    /// caller's message list. Public for unit tests.
    /// </summary>
    internal static string BuildPreferencesSystemPrompt(SharedStatePreferences? prefs)
    {
        if (prefs is null || prefs.IsEmpty)
        {
            return SystemPromptBase;
        }

        var lines = new List<string> { SystemPromptBase, "", "[shared-state-read-write] preferences:" };
        if (!string.IsNullOrWhiteSpace(prefs.Name))
        {
            lines.Add($"- Name: {prefs.Name}");
        }
        if (!string.IsNullOrWhiteSpace(prefs.Tone))
        {
            lines.Add($"- Preferred tone: {prefs.Tone}");
        }
        if (!string.IsNullOrWhiteSpace(prefs.Language))
        {
            lines.Add($"- Preferred language: {prefs.Language}");
        }
        if (prefs.Interests.Count > 0)
        {
            lines.Add($"- Interests: {string.Join(", ", prefs.Interests)}");
        }
        lines.Add("Tailor every response to these preferences. Address the user by name when appropriate.");
        return string.Join("\n", lines);
    }

    private const string SystemPromptBase =
        "You are a helpful, concise assistant. The user's preferences are " +
        "supplied via shared state and added as a system message at the start " +
        "of every turn — always respect them. When the user asks you to " +
        "remember something, or you observe something worth surfacing in the " +
        "UI's notes panel, call `set_notes` with the FULL updated list of " +
        "short notes (existing notes + new). Keep each note short.";

    private static SharedStatePreferences? TryReadPreferences(AgentRunOptions? options)
    {
        if (!TryGetAgUiState(options, out var state))
        {
            return null;
        }
        if (!state.TryGetProperty("preferences", out var prefs) || prefs.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        return SharedStatePreferences.FromJson(prefs);
    }

    private static IReadOnlyList<string>? TryReadNotes(AgentRunOptions? options)
    {
        if (!TryGetAgUiState(options, out var state))
        {
            return null;
        }
        if (!state.TryGetProperty("notes", out var notes) || notes.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        var list = new List<string>(notes.GetArrayLength());
        foreach (var n in notes.EnumerateArray())
        {
            if (n.ValueKind == JsonValueKind.String)
            {
                var s = n.GetString();
                if (!string.IsNullOrEmpty(s))
                {
                    list.Add(s);
                }
            }
        }
        return list;
    }

    internal static bool TryGetAgUiState(AgentRunOptions? options, out JsonElement state)
    {
        if (options is ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } props } &&
            props.TryGetValue("ag_ui_state", out JsonElement element) &&
            element.ValueKind == JsonValueKind.Object)
        {
            state = element;
            return true;
        }
        state = default;
        return false;
    }
}

/// <summary>
/// Per-thread store that holds the canonical copy of `preferences` + `notes`.
/// Reads/writes are synchronized via a single lock; the workload is tiny
/// (one user typing in a UI) so a heavier RW-lock is not warranted.
/// </summary>
internal sealed class SharedStateReadWriteStore
{
    private readonly object _globalSlot = new();
    private readonly AsyncLocal<object?> _activeThreadKey = new();
    private readonly Dictionary<object, ThreadSlot> _slots = new();
    private readonly object _lock = new();

    /// <summary>
    /// Bind the current async-flow's "active" thread so tool closures that
    /// don't receive an <see cref="AgentThread"/> argument can still write
    /// into the same per-thread slot the wrapping agent reads from. Returns
    /// the previous value so callers can restore it after the run completes.
    /// </summary>
    public object? SetActiveThread(AgentThread? thread)
    {
        var prior = _activeThreadKey.Value;
        _activeThreadKey.Value = thread ?? _globalSlot;
        return prior;
    }

    /// <summary>
    /// Restore a previously captured active-thread handle.
    /// </summary>
    public void RestoreActiveThread(object? prior)
    {
        _activeThreadKey.Value = prior;
    }

    public SharedStatePreferences? GetPreferences(AgentThread? thread)
    {
        lock (_lock)
        {
            return _slots.TryGetValue(KeyFor(thread), out var slot) ? slot.Preferences : null;
        }
    }

    public IReadOnlyList<string> GetNotes(AgentThread? thread)
    {
        lock (_lock)
        {
            return _slots.TryGetValue(KeyFor(thread), out var slot) ? slot.Notes : Array.Empty<string>();
        }
    }

    public void SetNotes(AgentThread? thread, IEnumerable<string> notes)
    {
        ArgumentNullException.ThrowIfNull(notes);
        var materialized = notes.Where(n => !string.IsNullOrWhiteSpace(n)).ToArray();
        lock (_lock)
        {
            var key = KeyFor(thread);
            if (!_slots.TryGetValue(key, out var slot))
            {
                slot = new ThreadSlot();
                _slots[key] = slot;
            }
            slot.Notes = materialized;
        }
    }

    /// <summary>
    /// Variant of <see cref="SetNotes(AgentThread?, IEnumerable{string})"/>
    /// that targets the current async-flow's active thread (set via
    /// <see cref="SetActiveThread"/>). Used by the `set_notes` tool closure
    /// in <see cref="SharedStateReadWriteAgentFactory"/>, which doesn't
    /// receive the active <see cref="AgentThread"/> as an argument.
    /// </summary>
    public void SetNotesForActiveThread(IEnumerable<string> notes)
    {
        ArgumentNullException.ThrowIfNull(notes);
        var materialized = notes.Where(n => !string.IsNullOrWhiteSpace(n)).ToArray();
        lock (_lock)
        {
            var key = _activeThreadKey.Value ?? _globalSlot;
            if (!_slots.TryGetValue(key, out var slot))
            {
                slot = new ThreadSlot();
                _slots[key] = slot;
            }
            slot.Notes = materialized;
        }
    }

    public void MergeFromInbound(AgentThread? thread, SharedStatePreferences? prefs, IReadOnlyList<string>? notes)
    {
        lock (_lock)
        {
            var key = KeyFor(thread);
            if (!_slots.TryGetValue(key, out var slot))
            {
                slot = new ThreadSlot();
                _slots[key] = slot;
            }
            // Inbound preferences always win — the UI is the source of truth
            // for preferences in this demo. Inbound `notes` is best-effort:
            // we only adopt it on first observation so the tool's writes
            // aren't clobbered by a stale snapshot the runtime is replaying.
            if (prefs is not null)
            {
                slot.Preferences = prefs;
            }
            if (notes is not null && !slot.NotesObserved)
            {
                slot.Notes = notes.ToArray();
                slot.NotesObserved = true;
            }
        }
    }

    public SharedStateReadWriteSnapshot BuildSnapshot(AgentThread? thread)
    {
        lock (_lock)
        {
            if (!_slots.TryGetValue(KeyFor(thread), out var slot))
            {
                return new SharedStateReadWriteSnapshot(
                    SharedStatePreferences.Empty,
                    Array.Empty<string>());
            }
            return new SharedStateReadWriteSnapshot(
                slot.Preferences ?? SharedStatePreferences.Empty,
                slot.Notes);
        }
    }

    // Use the AgentThread reference identity as the key so each conversation
    // gets its own slot. Falls back to a single per-instance global slot when
    // the AG-UI bridge invokes the agent without a thread (e.g. some smoke
    // tests). Note: `_globalSlot` is an instance field, not static, so two
    // store instances do not share their global-fallback slot.
    private object KeyFor(AgentThread? thread) => thread ?? _globalSlot;

    private sealed class ThreadSlot
    {
        public SharedStatePreferences? Preferences { get; set; }
        public IReadOnlyList<string> Notes { get; set; } = Array.Empty<string>();
        public bool NotesObserved { get; set; }
    }
}

/// <summary>
/// Strongly-typed mirror of the `preferences` object the UI writes into
/// shared state. Tolerates partial / unknown shapes; missing keys fall back
/// to <see cref="Empty"/>.
/// </summary>
internal sealed record SharedStatePreferences(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("tone")] string Tone,
    [property: JsonPropertyName("language")] string Language,
    [property: JsonPropertyName("interests")] IReadOnlyList<string> Interests)
{
    public static SharedStatePreferences Empty { get; } = new(
        Name: "",
        Tone: "casual",
        Language: "English",
        Interests: Array.Empty<string>());

    [JsonIgnore]
    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(Name) &&
        string.IsNullOrWhiteSpace(Tone) &&
        string.IsNullOrWhiteSpace(Language) &&
        Interests.Count == 0;

    public static SharedStatePreferences FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }
        var name = element.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
            ? n.GetString() ?? ""
            : "";
        var tone = element.TryGetProperty("tone", out var t) && t.ValueKind == JsonValueKind.String
            ? t.GetString() ?? ""
            : "";
        var language = element.TryGetProperty("language", out var l) && l.ValueKind == JsonValueKind.String
            ? l.GetString() ?? ""
            : "";
        var interests = new List<string>();
        if (element.TryGetProperty("interests", out var i) && i.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in i.EnumerateArray())
            {
                if (entry.ValueKind == JsonValueKind.String)
                {
                    var s = entry.GetString();
                    if (!string.IsNullOrEmpty(s))
                    {
                        interests.Add(s);
                    }
                }
            }
        }
        return new SharedStatePreferences(name, tone, language, interests);
    }
}

internal sealed record SharedStateReadWriteSnapshot(
    [property: JsonPropertyName("preferences")] SharedStatePreferences Preferences,
    [property: JsonPropertyName("notes")] IReadOnlyList<string> Notes);

[JsonSerializable(typeof(SharedStateReadWriteSnapshot))]
[JsonSerializable(typeof(SharedStatePreferences))]
[JsonSerializable(typeof(string[]))]
internal sealed partial class SharedStateReadWriteSerializerContext : JsonSerializerContext;

/// <summary>
/// Factory that owns the per-process state store and the OpenAI client for
/// the shared-state-read-write demo. Mounted in Program.cs at
/// `/shared-state-read-write` and routed by the Next.js
/// `src/app/api/copilotkit/route.ts`.
/// </summary>
public sealed class SharedStateReadWriteAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly OpenAIClient _openAiClient;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly SharedStateReadWriteStore _store = new();

    public SharedStateReadWriteAgentFactory(
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _loggerFactory = loggerFactory;
        _jsonSerializerOptions = jsonSerializerOptions;

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpoint = Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? DefaultOpenAiEndpoint;
        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            AimockHeaderPolicy.CreateOpenAIClientOptions(endpoint));
    }

    public AIAgent CreateAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // The tool closes over `_store`; this is intentional — each tool
        // invocation must update the same per-thread slot the wrapping
        // agent reads from when emitting the post-turn snapshot. The closure
        // doesn't receive the active AgentThread as an argument, so we route
        // the write through the store's AsyncLocal active-thread handle,
        // which `SharedStateReadWriteAgent.RunStreamingAsync` binds for the
        // duration of the inner agent's run. Without this, writes would
        // land in the per-instance global slot and never reach the
        // per-thread slot the snapshot is read from.
        var setNotes = AIFunctionFactory.Create(
            (Func<List<string>, string>)(notes =>
            {
                ArgumentNullException.ThrowIfNull(notes);
                _store.SetNotesForActiveThread(notes);
                return $"ok: {notes.Count} notes";
            }),
            options: new()
            {
                Name = "set_notes",
                Description = "Replace the notes list with the FULL updated list (existing notes + new). Pass plain short note strings.",
                SerializerOptions = _jsonSerializerOptions,
            });

        var inner = new ChatClientAgent(
            chatClient,
            name: "SharedStateReadWriteAgent",
            description: "You read user preferences from shared state and write notes back via the set_notes tool.",
            tools: [setNotes]);

        return new SharedStateReadWriteAgent(
            inner,
            _store,
            _loggerFactory.CreateLogger<SharedStateReadWriteAgent>());
    }
}
