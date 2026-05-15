using System.ComponentModel;
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
    private readonly JsonSerializerOptions _jsonSerializerOptions;
    private readonly ILogger _logger;
    private readonly List<BeautifulChatTodo> _todos = new();
    private readonly object _todosLock = new();

    public BeautifulChatAgentFactory(
        OpenAIClient openAiClient,
        JsonSerializerOptions jsonSerializerOptions,
        ILogger<BeautifulChatAgentFactory> logger)
    {
        ArgumentNullException.ThrowIfNull(openAiClient);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);
        ArgumentNullException.ThrowIfNull(logger);

        _openAiClient = openAiClient;
        _jsonSerializerOptions = jsonSerializerOptions;
        _logger = logger;
    }

    public AIAgent Create()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
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
    private string SearchFlights([Description("The list of flights to render")] List<BeautifulChatFlight> flights)
    {
        ArgumentNullException.ThrowIfNull(flights);
        _logger.LogInformation("[beautiful-chat] search_flights: {Count}", flights.Count);

        // Fixed-schema flight card layout — mirrors the LangGraph reference's
        // `flight_schema.json`. The root Row binds one child template
        // (`flight-card`) across the `/flights` data-model path so a single
        // schema renders any number of flights.
        var flightSchema = new object[]
        {
            new
            {
                id = "root",
                component = "Row",
                children = new { componentId = "flight-card", path = "/flights" },
                gap = 16,
            },
            new
            {
                id = "flight-card",
                component = "FlightCard",
                airline = new { path = "airline" },
                airlineLogo = new { path = "airlineLogo" },
                flightNumber = new { path = "flightNumber" },
                origin = new { path = "origin" },
                destination = new { path = "destination" },
                date = new { path = "date" },
                departureTime = new { path = "departureTime" },
                arrivalTime = new { path = "arrivalTime" },
                duration = new { path = "duration" },
                status = new { path = "status" },
                price = new { path = "price" },
                action = new
                {
                    @event = new
                    {
                        name = "book_flight",
                        context = new
                        {
                            flightNumber = new { path = "flightNumber" },
                            origin = new { path = "origin" },
                            destination = new { path = "destination" },
                            price = new { path = "price" },
                        },
                    },
                },
            },
        };

        var operations = new object[]
        {
            new { type = "create_surface", surfaceId = FlightSurfaceId, catalogId = CatalogId },
            new { type = "update_components", surfaceId = FlightSurfaceId, components = flightSchema },
            new { type = "update_data_model", surfaceId = FlightSurfaceId, data = new { flights } },
        };

        return JsonSerializer.Serialize(new { a2ui_operations = operations });
    }

    [Description("Generate dynamic A2UI components based on the conversation. A secondary LLM designs the UI schema and data.")]
    private async Task<string> GenerateA2ui(
        [Description("A description of what UI to generate")] string userRequest,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userRequest);

        var errorId = Guid.NewGuid().ToString("n")[..16];
        _logger.LogInformation("[beautiful-chat] generate_a2ui (errorId={ErrorId}) for: {Request}", errorId, userRequest);

        var secondaryChatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // The LangGraph reference passes the serialized catalog + component
        // schemas as system context. Without the MS Agent Framework's
        // equivalent of `runtime.state["copilotkit"]["context"]`, we embed a
        // condensed catalog description here so the secondary LLM knows
        // which components to emit.
        var systemPrompt = @"You are a UI generator. Generate A2UI v0.9 components for the user's request.
Respond with ONLY a JSON object (no markdown, no explanation) with this shape:
{
  ""surfaceId"": ""dynamic-surface"",
  ""catalogId"": ""copilotkit://app-dashboard-catalog"",
  ""components"": [<A2UI v0.9 components>],
  ""data"": {<optional initial data>}
}
The root component must have id ""root"".
Available components (from the dashboard catalog):
- Title { text, level? }
- Row / Column { gap?, children[] }
- DashboardCard { title, subtitle?, child? }
- Metric { label, value, trend?, trendValue? }
- PieChart { data[{label, value, color?}], innerRadius? }
- BarChart { data[{label, value}], color? }
- Badge { text, variant? }
- DataTable { columns[], rows[] }
- Button { child, variant?, action? }
- FlightCard (fixed-schema only; do not emit from dynamic generator)";

        var messages = new List<ChatMessage>
        {
            new(ChatRole.System, systemPrompt),
            new(ChatRole.User, userRequest),
        };

        string? content;
        try
        {
            var result = await secondaryChatClient.GetResponseAsync(messages, cancellationToken: cancellationToken).ConfigureAwait(false);
            content = result.Text;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "[beautiful-chat] generate_a2ui (errorId={ErrorId}): transport failure", errorId);
            return JsonSerializer.Serialize(new { error = "upstream_unavailable", errorId });
        }
        catch (OperationCanceledException)
        {
            throw;
        }

        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("[beautiful-chat] generate_a2ui (errorId={ErrorId}): empty response", errorId);
            return JsonSerializer.Serialize(new { error = "empty_llm_output", errorId });
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
