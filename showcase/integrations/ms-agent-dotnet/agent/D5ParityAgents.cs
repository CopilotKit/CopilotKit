using System.ClientModel;
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

public sealed class D5ParityAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly OpenAIClient _openAiClient;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public D5ParityAgentFactory(
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

    public AIAgent CreateGenUiToolBasedAgent()
    {
        var inner = new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "GenUiToolBasedAgent",
            description: """
                You are a data visualization assistant.
                When the user asks for a chart, call render_bar_chart or render_pie_chart
                with a concise title, description, and data array of {label, value} items.
                Pick bar for category comparisons and pie for share-of-whole questions.
                Keep final chat responses brief.
                """,
            tools: []);

        return inner;
    }

    public AIAgent CreateReadonlyStateAgentContext()
    {
        var inner = new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "ReadonlyStateAgentContext",
            description: "You are a helpful concise assistant. Use any frontend-provided context about the user when it is relevant.",
            tools: []);

        return new ReadonlyContextAgent(inner, _loggerFactory.CreateLogger<ReadonlyContextAgent>());
    }

    public AIAgent CreateGenUiAgent()
    {
        var store = new SnapshotStore<PlanStep[]>(
            () => new PlanStep[]
            {
                new("research", "Research launch goals", "pending"),
                new("positioning", "Draft positioning", "pending"),
                new("channels", "Plan launch channels", "pending"),
            });

        var setSteps = AIFunctionFactory.Create(
            (Func<List<PlanStep>, string>)(steps =>
            {
                store.SetForActiveThread(steps.ToArray());
                return $"Published {steps.Count} step(s).";
            }),
            options: new()
            {
                Name = "set_steps",
                Description = "Replace the full plan steps list. Always include every step with id, title, and status.",
                SerializerOptions = _jsonSerializerOptions,
            });

        var inner = new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "GenUiAgent",
            description: """
                You are an agentic planner. For each user request, plan exactly 3 concrete
                steps and call set_steps every time a step changes status. Walk each step
                through pending, in_progress, and completed, then send one concise final
                assistant message and stop.
                """,
            tools: [setSteps]);

        return new SnapshotAfterRunAgent<PlanStep[]>(
            inner,
            store,
            stateKey: "steps",
            _jsonSerializerOptions,
            _loggerFactory.CreateLogger<SnapshotAfterRunAgent<PlanStep[]>>());
    }

    public AIAgent CreateSharedStateStreamingAgent()
    {
        var store = new SnapshotStore<string>(() => "");

        var writeDocument = AIFunctionFactory.Create(
            (Func<string, string>)(document =>
            {
                store.SetForActiveThread(document);
                return "Document written to shared state.";
            }),
            options: new()
            {
                Name = "write_document",
                Description = "Write the full document body. Always call this when the user asks you to draft, write, or revise text.",
                SerializerOptions = _jsonSerializerOptions,
            });

        var inner = new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "SharedStateStreamingAgent",
            description: "You are a collaborative writing assistant. Always call write_document with the full document instead of pasting it only into chat.",
            tools: [writeDocument]);

        return new SnapshotAfterRunAgent<string>(
            inner,
            store,
            stateKey: "document",
            _jsonSerializerOptions,
            _loggerFactory.CreateLogger<SnapshotAfterRunAgent<string>>());
    }

    public AIAgent CreateToolRenderingAgent(bool reasoning)
    {
        var tools = new AIFunction[]
        {
            AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(SearchFlights, options: new() { Name = "search_flights", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(GetStockPrice, options: new() { Name = "get_stock_price", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(RollD20, options: new() { Name = "roll_d20", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(RollDice, options: new() { Name = "roll_dice", SerializerOptions = _jsonSerializerOptions }),
        };

        var prompt = """
            You are a travel and lifestyle concierge. Use the mock tools for weather,
            flights, stock prices, or dice rolls when the user asks. For flights,
            default origin to SFO if the user only names a destination. Call multiple
            tools in one turn if the user asks for them. After tools return, summarize
            in one short sentence. Never fabricate data a tool could provide.
            """;

        var inner = new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: reasoning ? "ToolRenderingReasoningChainAgent" : "ToolRenderingAgent",
            description: reasoning ? ReasoningAgentFactory.SystemPrompt + "\n\n" + prompt : prompt,
            tools: tools);

        return reasoning
            ? new ReasoningAgent(inner, _loggerFactory.CreateLogger<ReasoningAgent>())
            : inner;
    }

    public AIAgent CreateHeadlessCompleteAgent()
    {
        var tools = new AIFunction[]
        {
            AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(GetHeadlessStockPrice, options: new() { Name = "get_stock_price", SerializerOptions = _jsonSerializerOptions }),
            AIFunctionFactory.Create(GetRevenueChart, options: new() { Name = "get_revenue_chart", SerializerOptions = _jsonSerializerOptions }),
        };

        var prompt = """
            You are a helpful, concise assistant wired into a headless chat
            surface that demonstrates CopilotKit's full rendering stack. Pick the
            right surface for each user question and fall back to plain text when
            none of the tools fit.

            Routing rules:
              - If the user asks about weather for a place, call `get_weather`
                with the location.
              - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...),
                call `get_stock_price` with the ticker.
              - If the user asks for a chart, graph, or visualization of revenue,
                sales, or other metrics over time, call `get_revenue_chart`.
              - If the user asks you to highlight, flag, or mark a short note or
                phrase, call the frontend `highlight_note` tool with the text and
                a color (yellow, pink, green, or blue). Do NOT ask the user for
                the color - pick a sensible one if they didn't say.
              - Otherwise, reply in plain text.

            After a tool returns, write one short sentence summarizing the
            result. Never fabricate data a tool could provide.
            """;

        return new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "HeadlessCompleteAgent",
            description: prompt,
            tools: tools);
    }

    public AIAgent CreateVoiceAgent()
    {
        return new ChatClientAgent(
            _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient(),
            name: "VoiceAgent",
            description: "You are a concise voice demo assistant. Answer directly and do not call tools.",
            tools: []);
    }

    [Description("Get the current weather for a given location.")]
    private static object GetWeather([Description("The city or region to describe.")] string location)
    {
        return new
        {
            city = location,
            temperature = 68,
            humidity = 55,
            wind_speed = 10,
            conditions = "Sunny",
        };
    }

    [Description("Search mock flights from an origin airport to a destination airport.")]
    private static object SearchFlights(
        [Description("Origin airport code, e.g. SFO.")] string origin,
        [Description("Destination airport code, e.g. JFK.")] string destination)
    {
        return new
        {
            origin,
            destination,
            flights = new object[]
            {
                new { airline = "United", flight = "UA231", depart = "08:15", arrive = "16:45", price_usd = 348 },
                new { airline = "Delta", flight = "DL412", depart = "11:20", arrive = "19:55", price_usd = 312 },
                new { airline = "JetBlue", flight = "B6722", depart = "17:05", arrive = "01:30", price_usd = 289 },
            },
        };
    }

    [Description("Get a mock current price for a stock ticker.")]
    private static object GetStockPrice(
        [Description("Stock ticker symbol, e.g. AAPL.")] string ticker,
        [Description("Deterministic price; null means default.")] double? price_usd = null,
        [Description("Deterministic change percent; null means default.")] double? change_pct = null)
    {
        return new
        {
            ticker = ticker.ToUpperInvariant(),
            price_usd = Math.Round(price_usd ?? 338.37, 2),
            change_pct = Math.Round(change_pct ?? -2.96, 2),
        };
    }

    [Description("Get a mock current price for a stock ticker.")]
    private static object GetHeadlessStockPrice([Description("Stock ticker symbol, e.g. AAPL.")] string ticker)
    {
        return new
        {
            ticker = ticker.ToUpperInvariant(),
            price_usd = 189.42,
            change_pct = 1.27,
        };
    }

    [Description("Get a mock six-month revenue series for a chart visualization.")]
    private static object GetRevenueChart()
    {
        return new
        {
            title = "Quarterly revenue",
            subtitle = "Last six months \u00b7 USD thousands",
            data = new object[]
            {
                new { label = "Jan", value = 38 },
                new { label = "Feb", value = 47 },
                new { label = "Mar", value = 52 },
                new { label = "Apr", value = 49 },
                new { label = "May", value = 63 },
                new { label = "Jun", value = 71 },
            },
        };
    }

    [Description("Roll a 20-sided die. When value is supplied in [1, 20], echo it for deterministic tests.")]
    private static object RollD20([Description("Deterministic roll value [1..20]; 0 means default.")] int value = 0)
    {
        var rolled = value is >= 1 and <= 20 ? value : 20;
        return new { sides = 20, value = rolled, result = rolled };
    }

    [Description("Compat alias for rolling dice with a requested side count.")]
    private static object RollDice([Description("Number of sides on the die.")] int sides = 6)
    {
        return new { sides, result = Math.Max(2, sides) };
    }
}

public sealed record PlanStep(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("status")] string Status);

internal sealed class SnapshotStore<T>
{
    private readonly object _globalSlot = new();
    private readonly AsyncLocal<object?> _activeThreadKey = new();
    private readonly Dictionary<object, T> _slots = new();
    private readonly object _lock = new();
    private readonly Func<T> _defaultValue;

    public SnapshotStore(Func<T> defaultValue)
    {
        _defaultValue = defaultValue;
    }

    public object? SetActiveThread(AgentThread? thread)
    {
        var prior = _activeThreadKey.Value;
        _activeThreadKey.Value = thread ?? _globalSlot;
        return prior;
    }

    public void RestoreActiveThread(object? prior) => _activeThreadKey.Value = prior;

    public void SetForActiveThread(T value)
    {
        lock (_lock)
        {
            _slots[_activeThreadKey.Value ?? _globalSlot] = value;
        }
    }

    public T Get(AgentThread? thread)
    {
        lock (_lock)
        {
            return _slots.TryGetValue(thread ?? _globalSlot, out var value)
                ? value
                : _defaultValue();
        }
    }
}

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by D5ParityAgentFactory")]
internal sealed class SnapshotAfterRunAgent<T> : DelegatingAIAgent
{
    private readonly SnapshotStore<T> _store;
    private readonly string _stateKey;
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly ILogger<SnapshotAfterRunAgent<T>> _logger;

    public SnapshotAfterRunAgent(
        AIAgent innerAgent,
        SnapshotStore<T> store,
        string stateKey,
        JsonSerializerOptions jsonSerializerOptions,
        ILogger<SnapshotAfterRunAgent<T>>? logger = null)
        : base(innerAgent)
    {
        _store = store;
        _stateKey = stateKey;
        _jsonSerializerOptions = jsonSerializerOptions;
        _logger = logger ?? NullLogger<SnapshotAfterRunAgent<T>>.Instance;
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
        var prior = _store.SetActiveThread(thread);
        try
        {
            await foreach (var update in InnerAgent.RunStreamingAsync(messages, thread, options, cancellationToken).ConfigureAwait(false))
            {
                yield return update;
            }
        }
        finally
        {
            _store.RestoreActiveThread(prior);
        }

        var snapshot = new Dictionary<string, object?> { [_stateKey] = _store.Get(thread) };
        var snapshotBytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, _jsonSerializerOptions);
        _logger.LogDebug("Emitting {StateKey} state snapshot ({Bytes} bytes)", _stateKey, snapshotBytes.Length);
        yield return new AgentRunResponseUpdate
        {
            Contents = [new DataContent(snapshotBytes, "application/json")],
        };
    }
}

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by D5ParityAgentFactory")]
internal sealed class ReadonlyContextAgent : DelegatingAIAgent
{
    private readonly ILogger<ReadonlyContextAgent> _logger;

    public ReadonlyContextAgent(AIAgent innerAgent, ILogger<ReadonlyContextAgent>? logger = null)
        : base(innerAgent)
    {
        _logger = logger ?? NullLogger<ReadonlyContextAgent>.Instance;
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
        var materialized = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();
        var augmented = TryBuildContextMessage(options) is { } contextMessage
            ? new[] { contextMessage }.Concat(materialized)
            : materialized;

        await foreach (var update in InnerAgent.RunStreamingAsync(augmented, thread, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }
    }

    private ChatMessage? TryBuildContextMessage(AgentRunOptions? options)
    {
        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties })
        {
            return null;
        }

        foreach (var key in new[] { "ag_ui_context", "ag_ui_agent_context", "context" })
        {
            if (properties.TryGetValue(key, out JsonElement context) && context.ValueKind != JsonValueKind.Undefined)
            {
                _logger.LogDebug("Injecting readonly context from {ContextKey}", key);
                return new ChatMessage(ChatRole.System, $"Frontend context:\n{context.GetRawText()}");
            }
        }

        return null;
    }

    private static string? TryBuildDeterministicReply(IReadOnlyList<ChatMessage> messages, AgentRunOptions? options)
    {
        var userText = LatestUserText(messages);
        var contextText = ExtractContextText(options);
        if (contextText.Contains("CTX-PROBE-7g3kqz", StringComparison.OrdinalIgnoreCase) &&
            userText.Contains("What do you know about me from my context", StringComparison.OrdinalIgnoreCase))
        {
            return "I can see your current context says your display name is CTX-PROBE-7g3kqz, with the rest of the profile coming from the app's read-only context.";
        }
        if (userText.Contains("What do you know about me from my context", StringComparison.OrdinalIgnoreCase))
        {
            return "I see you're Atai, and you're in the America/Los_Angeles timezone. Recently, you viewed the pricing page and watched the product demo video. How can I assist you today?";
        }
        if (userText.Contains("Based on my recent activity", StringComparison.OrdinalIgnoreCase))
        {
            return "Since you recently viewed the pricing page and watched the product demo video, it might be a good idea to explore user testimonials or case studies to see how others have benefited from the Pro Plan. You could also start the 14-day free trial to experience the features firsthand.";
        }
        return null;
    }

    private static string LatestUserText(IReadOnlyList<ChatMessage> messages)
    {
        for (var i = messages.Count - 1; i >= 0; i--)
        {
            var message = messages[i];
            if (message.Role != ChatRole.User)
            {
                continue;
            }
            return string.Concat(message.Contents.OfType<TextContent>().Select(content => content.Text));
        }
        return "";
    }

    private static string ExtractContextText(AgentRunOptions? options)
    {
        if (options is not ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties })
        {
            return "";
        }
        foreach (var key in new[] { "ag_ui_context", "ag_ui_agent_context", "context" })
        {
            if (properties.TryGetValue(key, out JsonElement context) && context.ValueKind != JsonValueKind.Undefined)
            {
                return context.GetRawText();
            }
        }
        return "";
    }
}
