using System.ComponentModel;
using System.ClientModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;

// ============================================================================
// Beautiful Chat Agent
// ============================================================================
//
// Flagship showcase cell — simultaneously exercises A2UI (fixed + dynamic
// schema), Open Generative UI, and MCP Apps. The LangGraph reference lives at
// `showcase/integrations/langgraph-python/src/agents/beautiful_chat.py`; the tool
// set here is a near-verbatim port:
//
//  - `query_data` / `get_todos` / `manage_todos` — backend tools that power
//    the "Task Manager (Shared State)" and "Sales Dashboard" suggestion pills.
//  - `search_flights` — A2UI fixed-schema tool. Returns `a2ui_operations`
//    that create + populate a flight surface using the dashboard catalog.
//  - `generate_a2ui` — A2UI dynamic-schema tool. Secondary LLM call designs
//    a full dashboard UI on the fly.
//  - `get_weather` — generic tool kept for parity with the rest of the
//    showcase (rendered via `useDefaultRenderTool` on the frontend).
//
// OGUI + MCP are configured on the runtime side (see
// `src/app/api/copilotkit-beautiful-chat/route.ts`) — the agent itself
// doesn't need to know about them, which keeps this file focused on the
// tool surface the LLM actually calls.
//
// State: todos live in an in-memory store scoped to the factory instance.
// Matches the LangGraph reference's use of `Command(update=...)` — the
// frontend is the source of truth for edits, and the agent just mirrors the
// latest snapshot so tool-call roundtrips don't drop state.
// ============================================================================

internal sealed class BeautifulChatTodo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("title")]
    public string Title { get; set; } = "";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";

    [JsonPropertyName("emoji")]
    public string Emoji { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = "pending"; // "pending" | "completed"
}

internal sealed class BeautifulChatFlight
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("airline")]
    public string Airline { get; set; } = "";

    [JsonPropertyName("airlineLogo")]
    public string AirlineLogo { get; set; } = "";

    [JsonPropertyName("flightNumber")]
    public string FlightNumber { get; set; } = "";

    [JsonPropertyName("origin")]
    public string Origin { get; set; } = "";

    [JsonPropertyName("destination")]
    public string Destination { get; set; } = "";

    [JsonPropertyName("date")]
    public string Date { get; set; } = "";

    [JsonPropertyName("departureTime")]
    public string DepartureTime { get; set; } = "";

    [JsonPropertyName("arrivalTime")]
    public string ArrivalTime { get; set; } = "";

    [JsonPropertyName("duration")]
    public string Duration { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("statusIcon")]
    public string StatusIcon { get; set; } = "";

    [JsonPropertyName("price")]
    public string Price { get; set; } = "";
}

internal sealed class BeautifulChatAgentFactory
{
    private const string CatalogId = "copilotkit://app-dashboard-catalog";
    private const string FlightSurfaceId = "flight-search-results";

    // Sample financial data mirrors beautiful_chat_data/db.csv on the
    // LangGraph side. Kept inline so the .NET cell is self-contained — no
    // extra data files to ship alongside the binary.
    private static readonly object[] _sampleFinancialData = BuildSampleFinancialData();

    private readonly OpenAIClient _openAiClient;
    private readonly IConfiguration _configuration;
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly ILogger _logger;
    private readonly List<BeautifulChatTodo> _todos = new();
    private readonly object _todosLock = new();

    public BeautifulChatAgentFactory(
        IConfiguration configuration,
        OpenAIClient openAiClient,
        JsonSerializerOptions jsonSerializerOptions,
        ILogger<BeautifulChatAgentFactory> logger)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(openAiClient);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);
        ArgumentNullException.ThrowIfNull(logger);

        _configuration = configuration;
        _openAiClient = openAiClient;
        _jsonSerializerOptions = jsonSerializerOptions;
        _logger = logger;
    }

    public AIAgent Create()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "BeautifulChatAgent",
            description: @"You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:
- Flights: call search_flights to show flight cards with a pre-built schema. Return exactly 2 flights.
- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
  charts, tables, and cards. It handles rendering automatically.
- Charts (frontend components): call query_data first, then render with the
  pieChart or barChart frontend component.
- Todos: enable app mode first (call enableAppMode), then manage todos.
- A2UI actions: when you see a log_a2ui_event result (e.g. ""view_details""),
  respond with a brief confirmation. The UI already updated on the frontend.",
            tools: [
                AIFunctionFactory.Create(QueryData, options: new() { Name = "query_data", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GetTodos, options: new() { Name = "get_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(ManageTodos, options: new() { Name = "manage_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(SearchFlights, options: new() { Name = "search_flights", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GenerateA2ui, options: new() { Name = "generate_a2ui", SerializerOptions = _jsonSerializerOptions })
            ]);

        return new BeautifulChatStateSnapshotAgent(chatClientAgent, this, _jsonSerializerOptions, _logger);
    }

    // ─── Tools ──────────────────────────────────────────────────────

    [Description("Query the database, takes natural language. Always call before showing a chart or graph.")]
    private object QueryData([Description("The natural-language query to run")] string query)
    {
        _logger.LogInformation("[beautiful-chat] query_data: {Query}", query);
        return _sampleFinancialData;
    }

    [Description("Get the current todos.")]
    private List<BeautifulChatTodo> GetTodos()
    {
        return GetTodosSnapshot();
    }

    internal List<BeautifulChatTodo> GetTodosSnapshot()
    {
        lock (_todosLock)
        {
            // Return a defensive copy so callers can't mutate our backing list.
            return _todos.Select(t => new BeautifulChatTodo
            {
                Id = t.Id,
                Title = t.Title,
                Description = t.Description,
                Emoji = t.Emoji,
                Status = t.Status,
            }).ToList();
        }
    }

    [Description("Manage the current todos. Provide the full desired list of todos; any missing ids are assigned a fresh uuid.")]
    private string ManageTodos([Description("The updated list of todos")] List<BeautifulChatTodo> todos)
    {
        ArgumentNullException.ThrowIfNull(todos);

        lock (_todosLock)
        {
            _todos.Clear();
            foreach (var todo in todos)
            {
                if (string.IsNullOrEmpty(todo.Id))
                {
                    todo.Id = Guid.NewGuid().ToString();
                }
                _todos.Add(todo);
            }
        }

        _logger.LogInformation("[beautiful-chat] manage_todos: {Count} items", todos.Count);
        return "Successfully updated todos";
    }

    [Description("Get the weather for a given location. Ensure location is fully spelled out.")]
    private WeatherInfo GetWeather([Description("The location to get the weather for")] string location)
    {
        _logger.LogInformation("[beautiful-chat] get_weather: {Location}", location);
        return new WeatherInfo
        {
            City = location,
            Temperature = 20,
            Conditions = "sunny",
            Humidity = 50,
            WindSpeed = 10,
            FeelsLike = 25,
        };
    }

    [Description(@"Search for flights and display the results as rich cards. Return exactly 2 flights.
Each flight must have: id, airline (e.g. ""United Airlines""),
airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128),
flightNumber, origin, destination,
date (short readable format like ""Tue, Mar 18""),
departureTime, arrivalTime, duration (e.g. ""4h 25m""),
status (e.g. ""On Time"" or ""Delayed""),
statusIcon (colored dot: ""https://placehold.co/12/22c55e/22c55e.png"" for On Time,
""https://placehold.co/12/eab308/eab308.png"" for Delayed),
price (e.g. ""$289"").")]
    private object SearchFlights([Description("The list of flights to render")] List<BeautifulChatFlight> flights)
    {
        ArgumentNullException.ThrowIfNull(flights);
        _logger.LogInformation("[beautiful-chat] search_flights: {Count}", flights.Count);

        // Flat literal-children layout — mirrors the LangGraph reference's
        // `_build_flight_components`. We avoid the structural-children
        // template form (Row.children = { componentId, path }) because the
        // GenericBinder only expands templates correctly for components
        // whose schema declares STRUCTURAL children — sibling demos work
        // because their schemas use literal-string-array children. Inlining
        // the values per-flight sidesteps the template path entirely and
        // renders identically.
        var components = new List<object>();
        var flightCardIds = new List<string>();
        for (int i = 0; i < flights.Count; i++)
        {
            var flight = flights[i];
            var cardId = $"flight-card-{i}";
            flightCardIds.Add(cardId);
            components.Add(new
            {
                id = cardId,
                component = "FlightCard",
                airline = flight.Airline,
                airlineLogo = flight.AirlineLogo,
                flightNumber = flight.FlightNumber,
                origin = flight.Origin,
                destination = flight.Destination,
                date = flight.Date,
                departureTime = flight.DepartureTime,
                arrivalTime = flight.ArrivalTime,
                duration = flight.Duration,
                status = flight.Status,
                price = flight.Price,
            });
        }
        var root = new
        {
            id = "root",
            component = "Row",
            children = flightCardIds,
            gap = 16,
        };
        var allComponents = new List<object> { root };
        allComponents.AddRange(components);

        var operations = new object[]
        {
            new { version = "v0.9", createSurface = new { surfaceId = FlightSurfaceId, catalogId = CatalogId } },
            new { version = "v0.9", updateComponents = new { surfaceId = FlightSurfaceId, components = allComponents } },
        };

        return new { a2ui_operations = operations };
    }

    [Description("Generate dynamic A2UI components based on the conversation. A secondary LLM designs the UI schema and data.")]
    private async Task<object> GenerateA2ui(
        [Description("Conversation context to generate UI from.")] string context = "",
        CancellationToken cancellationToken = default)
    {
        context ??= "";

        var errorId = Guid.NewGuid().ToString("n")[..16];
        var userContent = string.IsNullOrWhiteSpace(context)
            ? "Show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales."
            : context;
        _logger.LogInformation("[beautiful-chat] generate_a2ui (errorId={ErrorId}) for: {Request}", errorId, userContent);

        string? content;
        try
        {
            content = await A2uiSecondaryToolCaller.GetDesignToolArgumentsAsync(
                _configuration,
                "Generate a useful A2UI dashboard.",
                userContent,
                cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "[beautiful-chat] generate_a2ui (errorId={ErrorId}): transport failure", errorId);
            return SalesAgentFactory.StructuredError("upstream_unavailable", "The upstream AI service is currently unreachable. Please retry.", "Retry the request in a few seconds.", errorId);
        }
        catch (ClientResultException ex)
        {
            _logger.LogError(ex, "[beautiful-chat] generate_a2ui (errorId={ErrorId}): upstream returned error status {Status}", errorId, ex.Status);
            return SalesAgentFactory.StructuredError("upstream_error", "The upstream AI service returned an error.", "Try rephrasing the request or retrying later.", errorId);
        }
        catch (OperationCanceledException)
        {
            throw;
        }

        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("[beautiful-chat] generate_a2ui (errorId={ErrorId}): empty response", errorId);
            return new { error = "empty_llm_output", errorId };
        }

        // Reuse the SalesAgentFactory's A2UI response builder so the JSON
        // massaging is shared across both demos and we get the same structured
        // error taxonomy for free.
        return SalesAgentFactory.BuildA2uiResponseFromContent(content, errorId, _logger);
    }

    // ─── Sample data (inline port of beautiful_chat_data/db.csv) ───

    private static object[] BuildSampleFinancialData()
    {
        // Representative slice of the Python demo's db.csv. We keep it small
        // but varied so charts look alive — not a 1:1 row-count port.
        return new object[]
        {
            new { date = "2026-01-05", category = "Revenue", subcategory = "Enterprise Subscriptions", amount = 28000, type = "income" },
            new { date = "2026-01-05", category = "Revenue", subcategory = "Pro Tier Upgrades", amount = 18000, type = "income" },
            new { date = "2026-01-08", category = "Revenue", subcategory = "API Usage Overages", amount = 9500, type = "income" },
            new { date = "2026-01-10", category = "Expenses", subcategory = "Engineering Salaries", amount = 42000, type = "expense" },
            new { date = "2026-01-10", category = "Expenses", subcategory = "Product Team", amount = 18000, type = "expense" },
            new { date = "2026-01-12", category = "Expenses", subcategory = "AWS Infrastructure", amount = 8200, type = "expense" },
            new { date = "2026-01-15", category = "Expenses", subcategory = "Marketing - Paid Ads", amount = 12000, type = "expense" },
            new { date = "2026-01-18", category = "Revenue", subcategory = "Consulting Services", amount = 14500, type = "income" },
            new { date = "2026-01-20", category = "Expenses", subcategory = "Customer Success", amount = 15000, type = "expense" },
            new { date = "2026-01-22", category = "Expenses", subcategory = "AI Model Costs", amount = 4200, type = "expense" },
            new { date = "2026-01-25", category = "Revenue", subcategory = "Marketplace Sales", amount = 12800, type = "income" },
            new { date = "2026-02-03", category = "Revenue", subcategory = "Enterprise Subscriptions", amount = 31000, type = "income" },
            new { date = "2026-02-03", category = "Revenue", subcategory = "Pro Tier Upgrades", amount = 22500, type = "income" },
            new { date = "2026-02-10", category = "Expenses", subcategory = "Engineering Salaries", amount = 44000, type = "expense" },
            new { date = "2026-02-15", category = "Revenue", subcategory = "Consulting Services", amount = 17200, type = "income" },
            new { date = "2026-03-05", category = "Revenue", subcategory = "Enterprise Subscriptions", amount = 35500, type = "income" },
            new { date = "2026-03-10", category = "Expenses", subcategory = "Engineering Salaries", amount = 46000, type = "expense" },
            new { date = "2026-03-15", category = "Revenue", subcategory = "Marketplace Sales", amount = 15800, type = "income" },
        };
    }
}

internal sealed class BeautifulChatStateSnapshotAgent : DelegatingAIAgent
{
    private readonly BeautifulChatAgentFactory _factory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly ILogger _logger;

    public BeautifulChatStateSnapshotAgent(
        AIAgent innerAgent,
        BeautifulChatAgentFactory factory,
        JsonSerializerOptions jsonSerializerOptions,
        ILogger logger)
        : base(innerAgent)
    {
        _factory = factory;
        _jsonSerializerOptions = jsonSerializerOptions;
        _logger = logger;
    }

    public override Task<AgentRunResponse> RunAsync(
        IEnumerable<ChatMessage> messages,
        AgentThread? thread = null,
        AgentRunOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        return RunStreamingAsync(messages, thread, options, cancellationToken).ToAgentRunResponseAsync(cancellationToken);
    }

    public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentThread? thread = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var update in InnerAgent.RunStreamingAsync(messages, thread, options, cancellationToken).ConfigureAwait(false))
        {
            yield return update;
        }

        var snapshot = new Dictionary<string, object?> { ["todos"] = _factory.GetTodosSnapshot() };
        var snapshotBytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, _jsonSerializerOptions);
        _logger.LogDebug("[beautiful-chat] emitting todos state snapshot ({Bytes} bytes)", snapshotBytes.Length);
        yield return new AgentRunResponseUpdate
        {
            Contents = [new DataContent(snapshotBytes, "application/json")],
        };
    }
}
