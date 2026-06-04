// @region[supervisor-delegation-tools]
// @region[subagent-setup]
using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using OpenAI;
using System.ClientModel;

// SubagentsAgent — backs the /subagents demo.
//
// Mirrors langgraph-python/src/agents/subagents.py and
// google-adk/src/agents/subagents_agent.py:
//
//   * A supervisor ChatClientAgent exposes three tools — `research_agent`,
//     `writing_agent`, `critique_agent` — each of which delegates to a
//     specialised sub-agent.
//
//   * Each sub-agent is implemented as a single-shot secondary chat-client
//     call with its own system prompt. This is conceptually identical to
//     spawning a separate ChatClientAgent + Runner per delegation; we use a
//     single-shot call here to keep the demo wiring tight (and to mirror the
//     google-adk reference, which does the same with `genai.Client`).
//
//   * Every delegation is recorded in `state.delegations` — a list of
//     `Delegation { id, sub_agent, task, status, result }` records — and
//     emitted to the UI as a state-snapshot DataContent payload after the
//     supervisor's stream completes. (The snapshot also gets re-emitted on
//     each tool call so the UI's `running` -> `completed` transition is
//     visible mid-stream; see `EmitSnapshotAsync` below.)
[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by SubagentsAgentFactory")]
internal sealed class SubagentsAgent : DelegatingAIAgent
{
    private readonly ILogger<SubagentsAgent> _logger;
    private readonly SubagentsStore _store;

    public SubagentsAgent(
        AIAgent innerAgent,
        SubagentsStore store,
        ILogger<SubagentsAgent>? logger = null)
        : base(innerAgent)
    {
        ArgumentNullException.ThrowIfNull(innerAgent);
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        _logger = logger ?? NullLogger<SubagentsAgent>.Instance;
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
        var messageList = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();

        // Bind the tool's read/write target to the current thread so each
        // conversation appends to its own delegation list. The store
        // exposes a per-thread "active" handle that the static tool
        // function reads. We restore the previous value on exit so nested /
        // overlapping runs don't trample each other.
        var previous = (AgentThread?)_store.SetActiveThread(thread);
        try
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(messageList, thread, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;

                // Flush any state changes the tool made during this update
                // chunk. The inner ChatClientAgent doesn't emit DataContent
                // for tool calls, so the UI would otherwise only see the
                // final post-stream snapshot — losing the visible
                // running -> completed transition that makes the demo
                // compelling. We dedupe via SubagentsStore.TakeDirtyVersion
                // so we don't spam identical snapshots across token chunks.
                if (_store.TakeDirty(thread))
                {
                    var snapshot = _store.BuildSnapshot(thread);
                    var bytes = JsonSerializer.SerializeToUtf8Bytes(
                        snapshot,
                        SubagentsSerializerContext.Default.SubagentsSnapshot);
                    yield return new AgentRunResponseUpdate
                    {
                        Contents = [new DataContent(bytes, "application/json")],
                    };
                }
            }
        }
        finally
        {
            _store.SetActiveThread(previous);
        }

        // Final snapshot — guarantees at least one state event per turn
        // even if the supervisor produced no tool calls (so the UI sees a
        // stable empty `delegations` list rather than `undefined`).
        var finalSnapshot = _store.BuildSnapshot(thread);
        var finalBytes = JsonSerializer.SerializeToUtf8Bytes(
            finalSnapshot,
            SubagentsSerializerContext.Default.SubagentsSnapshot);
        yield return new AgentRunResponseUpdate
        {
            Contents = [new DataContent(finalBytes, "application/json")],
        };
    }
}

/// <summary>
/// Per-thread store of delegation entries. Reads/writes are synchronized via
/// a single lock — the demo workload is light and the lock is held only
/// across the read-modify-write of an in-memory list.
/// </summary>
internal sealed class SubagentsStore
{
    // Instance-scoped (not static) so multiple SubagentsStore instances —
    // e.g. test helpers, future multi-tenant wiring — don't share global
    // state with their per-instance `_slots` dict.
    private readonly object _globalSlot = new();
    private readonly AsyncLocal<object?> _activeThreadKey = new();

    private readonly Dictionary<object, ThreadSlot> _slots = new();
    private readonly object _lock = new();

    public object? SetActiveThread(AgentThread? thread)
    {
        var prior = _activeThreadKey.Value;
        _activeThreadKey.Value = thread ?? _globalSlot;
        return prior;
    }

    public string AppendRunning(string subAgent, string task)
    {
        var entry = new SubagentDelegation(
            Id: Guid.NewGuid().ToString("n")[..16],
            SubAgent: subAgent,
            Task: task,
            Status: "running",
            Result: "");
        lock (_lock)
        {
            var slot = GetOrCreateSlot(_activeThreadKey.Value ?? _globalSlot);
            slot.Delegations.Add(entry);
            slot.DirtyVersion++;
        }
        return entry.Id;
    }

    public void Update(string id, string status, string result)
    {
        lock (_lock)
        {
            var slot = GetOrCreateSlot(_activeThreadKey.Value ?? _globalSlot);
            for (var i = 0; i < slot.Delegations.Count; i++)
            {
                if (slot.Delegations[i].Id == id)
                {
                    slot.Delegations[i] = slot.Delegations[i] with
                    {
                        Status = status,
                        Result = result,
                    };
                    slot.DirtyVersion++;
                    return;
                }
            }
        }
    }

    public bool TakeDirty(AgentThread? thread)
    {
        lock (_lock)
        {
            var key = (object?)thread ?? _globalSlot;
            if (!_slots.TryGetValue(key, out var slot))
            {
                return false;
            }
            if (slot.DirtyVersion == slot.LastEmittedVersion)
            {
                return false;
            }
            slot.LastEmittedVersion = slot.DirtyVersion;
            return true;
        }
    }

    public SubagentsSnapshot BuildSnapshot(AgentThread? thread)
    {
        lock (_lock)
        {
            var key = (object?)thread ?? _globalSlot;
            if (!_slots.TryGetValue(key, out var slot))
            {
                return new SubagentsSnapshot(Array.Empty<SubagentDelegation>());
            }
            // Defensive copy — caller may serialize after the lock releases.
            return new SubagentsSnapshot(slot.Delegations.ToArray());
        }
    }

    private ThreadSlot GetOrCreateSlot(object key)
    {
        if (!_slots.TryGetValue(key, out var slot))
        {
            slot = new ThreadSlot();
            _slots[key] = slot;
        }
        return slot;
    }

    private sealed class ThreadSlot
    {
        public List<SubagentDelegation> Delegations { get; } = new();
        public long DirtyVersion { get; set; }
        public long LastEmittedVersion { get; set; }
    }
}

internal sealed record SubagentDelegation(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("sub_agent")] string SubAgent,
    [property: JsonPropertyName("task")] string Task,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("result")] string Result);

internal sealed record SubagentsSnapshot(
    [property: JsonPropertyName("delegations")] IReadOnlyList<SubagentDelegation> Delegations);

[JsonSerializable(typeof(SubagentsSnapshot))]
[JsonSerializable(typeof(SubagentDelegation))]
[JsonSerializable(typeof(IReadOnlyList<SubagentDelegation>))]
internal sealed partial class SubagentsSerializerContext : JsonSerializerContext;

/// <summary>
/// Factory that builds the supervisor agent + the three sub-agent tools.
/// Mounted in Program.cs at `/subagents`.
/// </summary>
public sealed class SubagentsAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string SubAgentModel = "gpt-4o-mini";

    // Each sub-agent is a single-shot ChatClient call (built per-delegation
    // in DelegateAsync) with its own system prompt. They don't share memory
    // or tools with the supervisor — the supervisor only sees their return
    // value as a tool result.
    private const string ResearchSystemPrompt =
        "You are a research sub-agent. Given a topic, produce a concise " +
        "bulleted list of 3-5 key facts. No preamble, no closing.";
    private const string WritingSystemPrompt =
        "You are a writing sub-agent. Given a brief and optional source facts, " +
        "produce a polished 1-paragraph draft. Be clear and concrete. No preamble.";
    private const string CritiqueSystemPrompt =
        "You are an editorial critique sub-agent. Given a draft, give 2-3 crisp, " +
        "actionable critiques. No preamble.";
    // @endregion[subagent-setup]

    private const string SupervisorPrompt =
        "You are a supervisor agent that coordinates three specialized " +
        "sub-agents to produce high-quality deliverables.\n\n" +
        "Available sub-agents (call them as tools):\n" +
        "  - research_agent: gathers facts on a topic.\n" +
        "  - writing_agent: turns facts + a brief into a polished draft.\n" +
        "  - critique_agent: reviews a draft and suggests improvements.\n\n" +
        "For most non-trivial user requests, delegate in sequence: research -> " +
        "write -> critique. Pass relevant facts/draft through the `task` argument " +
        "of each tool. Each tool returns a JSON object shaped " +
        "{status: 'completed' | 'failed', result?: string, error?: string}. " +
        "If a sub-agent fails, surface the failure briefly to the user (don't " +
        "fabricate a result) and decide whether to retry. Keep your own " +
        "messages short — explain the plan once, delegate, then return a " +
        "concise summary once done. The UI shows the user a live log of " +
        "every sub-agent delegation, including the in-flight 'running' state.";

    private readonly OpenAIClient _openAiClient;
    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger _logger;
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly SubagentsStore _store = new();

    public SubagentsAgentFactory(
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<SubagentsAgentFactory>();
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

        // Each sub-agent is exposed to the supervisor LLM as an AIFunction
        // tool. When the supervisor invokes one, DelegateAsync runs a fresh
        // ChatClient call with that sub-agent's system prompt, appends a
        // Delegation entry to shared state, and returns the sub-agent's
        // output to the supervisor as a tool result.
        var research = AIFunctionFactory.Create(
            (Func<string, CancellationToken, Task<string>>)((task, ct) =>
                DelegateAsync("research_agent", ResearchSystemPrompt, task, ct)),
            options: new()
            {
                Name = "research_agent",
                Description = "Delegate a research task to the research sub-agent. Returns JSON {status, result?, error?}.",
                SerializerOptions = _jsonSerializerOptions,
            });
        var writing = AIFunctionFactory.Create(
            (Func<string, CancellationToken, Task<string>>)((task, ct) =>
                DelegateAsync("writing_agent", WritingSystemPrompt, task, ct)),
            options: new()
            {
                Name = "writing_agent",
                Description = "Delegate a drafting task to the writing sub-agent. Returns JSON {status, result?, error?}.",
                SerializerOptions = _jsonSerializerOptions,
            });
        var critique = AIFunctionFactory.Create(
            (Func<string, CancellationToken, Task<string>>)((task, ct) =>
                DelegateAsync("critique_agent", CritiqueSystemPrompt, task, ct)),
            options: new()
            {
                Name = "critique_agent",
                Description = "Delegate a critique task to the critique sub-agent. Returns JSON {status, result?, error?}.",
                SerializerOptions = _jsonSerializerOptions,
            });
        // @endregion[supervisor-delegation-tools]

        var inner = new ChatClientAgent(
            chatClient,
            name: "SubagentsSupervisor",
            description: SupervisorPrompt,
            tools: [research, writing, critique]);

        return new SubagentsAgent(inner, _store, _loggerFactory.CreateLogger<SubagentsAgent>());
    }

    /// <summary>
    /// Common delegation flow — append a "running" entry, invoke a single-
    /// shot secondary chat-client call, then update the entry to
    /// "completed" / "failed". Returns a JSON string the supervisor LLM
    /// reads as the tool result, mirroring the dict shape used by the
    /// google-adk reference.
    /// </summary>
    private async Task<string> DelegateAsync(
        string subAgent,
        string systemPrompt,
        string task,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(task);
        var entryId = _store.AppendRunning(subAgent, task);
        _logger.LogInformation("subagent: starting {SubAgent} (entryId={EntryId}) task={TaskLength} chars", subAgent, entryId, task.Length);

        try
        {
            var secondary = _openAiClient.GetChatClient(SubAgentModel).AsIChatClient();
            var messages = new List<ChatMessage>
            {
                new(ChatRole.System, systemPrompt),
                new(ChatRole.User, task),
            };
            var response = await secondary.GetResponseAsync(messages, cancellationToken: cancellationToken).ConfigureAwait(false);
            var text = response.Text?.Trim() ?? "";
            if (string.IsNullOrEmpty(text))
            {
                _logger.LogWarning("subagent: {SubAgent} returned no text content", subAgent);
                _store.Update(entryId, "failed", "sub-agent returned empty text");
                return JsonSerializer.Serialize(new { status = "failed", error = "sub-agent returned empty text" });
            }

            _store.Update(entryId, "completed", text);
            return JsonSerializer.Serialize(new { status = "completed", result = text });
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "subagent: {SubAgent} transport failure", subAgent);
            var msg = $"sub-agent call failed: {ex.GetType().Name} (see server logs)";
            _store.Update(entryId, "failed", msg);
            return JsonSerializer.Serialize(new { status = "failed", error = msg });
        }
        catch (ClientResultException ex)
        {
            _logger.LogError(ex, "subagent: {SubAgent} upstream returned status {Status}", subAgent, ex.Status);
            var msg = $"sub-agent call failed: upstream returned error status {ex.Status}";
            _store.Update(entryId, "failed", msg);
            return JsonSerializer.Serialize(new { status = "failed", error = msg });
        }
        catch (OperationCanceledException)
        {
            _store.Update(entryId, "failed", "sub-agent call cancelled");
            throw;
        }
    }
}
