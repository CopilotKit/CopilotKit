using System.ClientModel;
using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

// ============================================================================
// Sales Agent (root agentic-chat backend) — extracted from the Framework column
// ============================================================================
//
// In the Framework (`ms-agent-dotnet`) the `SalesAgentFactory` and ALL its
// Sales/Flight model types live INLINE in Program.cs. The Harness keeps
// Program.cs THIN, so the whole factory + its model types + the
// source-generated serializer context are extracted here. The only behavioral
// deltas from the Framework crib are the two systematic transformations the W0
// contract (§1) mandates for every ported feature backend:
//
//   1. The inner ChatClientAgent is built via `chatClient.AsHarnessAgent(...)`
//      (harness wrapper) instead of `new ChatClientAgent(...)`.
//   2. Credentials are NOT re-resolved here — the shared `OpenAIClient` is
//      injected from Program.cs (built once via ApiKeyResolver), dropping the
//      Framework's per-factory `configuration["GitHubToken"] ?? throw` block.
//
// The A2UI dynamic-schema tool (`generate_a2ui`) uses the harness 5-arg
// `A2uiSecondaryToolCaller.GetDesignToolArgumentsAsync` (extra ILogger) and the
// harness `BeautifulChatA2ui.{BuildA2uiResponseFromContent,StructuredError}`
// helpers (W0 contract §1 credential/A2UI delta + §6 FLAG #3), NOT a
// re-implemented framework copy.
//
// `CreateSalesAgent()` returns the inner harness agent wrapped in
// `SharedStateAgent` (owned by the state family slot) so the shared-state
// two-pass JSON-schema flow stays available for the sales-pipeline demos.
// ============================================================================

// =================
// State Management
// =================

// Stage of a deal in the sales pipeline. Modeled as an enum so callers and
// the LLM's structured output both get a closed set of legal values, rather
// than a free-form string that can drift. Serialized as the
// enum member name via JsonStringEnumConverter on the JsonSerializerOptions.
public enum SalesStage
{
    Prospect,
    Qualified,
    Proposal,
    Negotiation,
    ClosedWon,
    ClosedLost,
}

// Currency code for deal values. Small closed set covers the demo use cases.
// Previously `Value` was an `int` with no currency indication at all; we now
// carry currency + decimal amount together.
public enum Currency
{
    USD,
    EUR,
    GBP,
    JPY,
}

public record SalesTodo
{
    /// <summary>
    /// The stable identifier for this todo.
    /// </summary>
    /// <remarks>
    /// The empty string is a load-bearing sentinel meaning "no id yet;
    /// server should assign one". <see cref="SalesState.ReplaceTodos"/>
    /// backfills any todo with <c>Id == ""</c> by generating a fresh Guid
    /// (see that method's documentation). Callers that want to express
    /// "pending, please assign" should use <see cref="NewPending"/> rather
    /// than constructing with an arbitrary placeholder string.
    ///
    /// <see langword="required"/> is retained for compile-time presence so
    /// callers have to acknowledge the id contract, but runtime validation
    /// does NOT reject the empty-string sentinel — that would break the
    /// server-assigned-id path described above.
    /// </remarks>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>
    /// Factory for "pending" todos: creates a SalesTodo with a
    /// freshly-generated Guid-derived id so the empty-string sentinel never
    /// leaks into code that doesn't understand the backfill contract.
    /// </summary>
    public static SalesTodo NewPending(
        string title = "",
        SalesStage stage = SalesStage.Prospect,
        decimal value = 0m,
        Currency currency = Currency.USD,
        DateOnly? dueDate = null,
        string assignee = "") => new()
        {
            // 16 hex chars = 64 bits of entropy. 8 chars was ~32 bits and
            // has a non-trivial collision risk at tens of thousands of
            // todos; 16 pushes collision risk well past demo scale.
            Id = Guid.NewGuid().ToString("n")[..16],
            Title = title,
            Stage = stage,
            Value = value,
            Currency = currency,
            DueDate = dueDate,
            Assignee = assignee,
        };

    [JsonPropertyName("title")]
    public string Title { get; init; } = "";

    [JsonPropertyName("stage")]
    public SalesStage Stage { get; init; } = SalesStage.Prospect;

    // Deal value as a decimal (money) with explicit currency. Previously an
    // `int` with no sign or currency semantics. The init accessor validates
    // non-negative — negative deal values are not a legal business state in
    // this demo.
    [JsonPropertyName("value")]
    public decimal Value
    {
        get => _value;
        init
        {
            if (value < 0m)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    value,
                    "SalesTodo.Value must be non-negative.");
            }
            _value = value;
        }
    }
    private readonly decimal _value;

    [JsonPropertyName("currency")]
    public Currency Currency { get; init; } = Currency.USD;

    // Nullable DateOnly — previously a free-form string that accepted any
    // input. System.Text.Json serializes DateOnly as ISO-8601 "YYYY-MM-DD".
    [JsonPropertyName("dueDate")]
    public DateOnly? DueDate { get; init; }

    [JsonPropertyName("assignee")]
    public string Assignee { get; init; } = "";

    /// <summary>
    /// Whether this deal is finished (won or lost). Derived from
    /// <see cref="Stage"/> so that the pair cannot disagree: a Prospect deal
    /// cannot be "completed", and a ClosedWon/ClosedLost deal cannot be
    /// "incomplete". Previously <c>Completed</c> was an independent bool and
    /// contradictions like <c>{Stage=ClosedWon, Completed=false}</c> were
    /// representable.
    /// </summary>
    [JsonPropertyName("completed")]
    public bool Completed => Stage is SalesStage.ClosedWon or SalesStage.ClosedLost;
}

// SalesState is the server-side in-memory store, SalesStateSnapshot is the
// wire-format JSON Schema sent to the model. Previously both carried near-
// identical List<SalesTodo>. We consolidate: SalesState holds a
// read-only list behind an encapsulated replacement API, and
// SalesStateSnapshot is a minimal record that wraps the same list for
// serialization.
public sealed class SalesState
{
    private IReadOnlyList<SalesTodo> _todos = Array.Empty<SalesTodo>();

    /// <summary>
    /// Current published todo list. Reads are lock-free: reference reads of
    /// a field are atomic on .NET, and the single writer
    /// (<see cref="ReplaceTodos"/>) publishes a new fully-materialized list
    /// by a single reference assignment. We use <see cref="Volatile.Read{T}"/>
    /// to prevent the JIT from hoisting the read past a synchronization
    /// boundary on the reader side.
    /// </summary>
    public IReadOnlyList<SalesTodo> Todos => Volatile.Read(ref _todos);

    /// <summary>
    /// Atomically replaces the todo list, backfilling any todo whose
    /// <see cref="SalesTodo.Id"/> is empty (or null) with a freshly-generated
    /// Guid-derived id. This is the explicit contract for callers that want
    /// server-assigned ids: pass a SalesTodo with <c>Id = ""</c> and this
    /// method generates a stable id for it. Non-empty ids are preserved as-is.
    /// </summary>
    /// <remarks>
    /// Generated ids are 16 hex chars (64 bits of entropy), derived from a
    /// fresh <see cref="Guid"/>. The write is a single reference assignment
    /// via <see cref="Volatile.Write{T}"/>, which is atomic and visible to
    /// readers without a lock.
    /// </remarks>
    public void ReplaceTodos(IEnumerable<SalesTodo> todos)
    {
        ArgumentNullException.ThrowIfNull(todos);
        var materialized = todos.Select(t => t with
        {
            // 16 hex chars = 64 bits. Previously 8 (32 bits) had a non-
            // trivial collision probability at tens of thousands of todos.
            Id = string.IsNullOrEmpty(t.Id) ? Guid.NewGuid().ToString("n")[..16] : t.Id,
        }).ToArray();

        Volatile.Write(ref _todos, materialized);
    }
}

// =================
// Flight Data
// =================

// Flight operational status. StatusColor was previously a separate string
// field that could disagree with Status; we now derive color
// from this enum deterministically in FlightInfo.StatusColor.
public enum FlightStatus
{
    OnTime,
    Delayed,
    Cancelled,
    Boarding,
}

public record FlightInfo
{
    [JsonPropertyName("airline")]
    public string Airline { get; init; } = "";

    [JsonPropertyName("airlineLogo")]
    public string AirlineLogo { get; init; } = "";

    [JsonPropertyName("flightNumber")]
    public string FlightNumber { get; init; } = "";

    [JsonPropertyName("origin")]
    public string Origin { get; init; } = "";

    [JsonPropertyName("destination")]
    public string Destination { get; init; } = "";

    [JsonPropertyName("date")]
    public string Date { get; init; } = "";

    [JsonPropertyName("departureTime")]
    public string DepartureTime { get; init; } = "";

    [JsonPropertyName("arrivalTime")]
    public string ArrivalTime { get; init; } = "";

    [JsonPropertyName("duration")]
    public string Duration { get; init; } = "";

    // Status as enum. Previously `Status` and `StatusColor` were
    // independent free-form strings that could disagree (e.g. "On Time" with
    // color "red"). Now StatusColor is derived from Status and the pair is
    // guaranteed consistent.
    [JsonPropertyName("status")]
    public FlightStatus Status { get; init; } = FlightStatus.OnTime;

    [JsonPropertyName("statusColor")]
    public string StatusColor => Status switch
    {
        FlightStatus.OnTime => "green",
        FlightStatus.Delayed => "yellow",
        FlightStatus.Cancelled => "red",
        FlightStatus.Boarding => "blue",
        _ => "gray",
    };

    // Price as decimal (money) + separate Currency enum. The
    // old shape carried both a display string like "$342" AND a currency
    // code "USD" — redundant and easy to get out of sync.
    [JsonPropertyName("price")]
    public decimal Price { get; init; }

    [JsonPropertyName("currency")]
    public Currency Currency { get; init; } = Currency.USD;
}

// =================
// Agent Factory
// =================
public class SalesAgentFactory
{
    private const int HarnessMaxContextWindowTokens = 128_000;
    private const int HarnessMaxOutputTokens = 8_192;

    private const string SalesAgentInstructions = @"A helpful assistant that helps manage a sales pipeline.
            You have tools available to get, update, and query sales data.
            You can search for flights and generate dynamic UI.
            When discussing deals or the pipeline, ALWAYS use the get_sales_todos tool to see the current state before mentioning, updating, or discussing deals with the user.";

    private readonly IConfiguration _configuration;
    private readonly SalesState _state;
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    // Ctor matches W0's Program.cs call-site exactly:
    //   new SalesAgentFactory(builder.Configuration, openAiClient, jsonOptions, loggerFactory)
    // The shared OpenAIClient is injected (W0 contract §1 credential SSOT) —
    // no per-factory GitHubToken resolution here.
    public SalesAgentFactory(
        IConfiguration configuration,
        OpenAIClient openAiClient,
        JsonSerializerOptions jsonSerializerOptions,
        ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(openAiClient);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _configuration = configuration;
        _state = new();
        _openAiClient = openAiClient;
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<SalesAgentFactory>();
        _jsonSerializerOptions = jsonSerializerOptions;
    }

    public AIAgent CreateSalesAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var harnessAgent = chatClient.AsHarnessAgent(
            HarnessMaxContextWindowTokens,
            HarnessMaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = "SalesAgent",
                Description = "Sales pipeline assistant powered by Microsoft Agent Harness over Microsoft Agent Framework.",
                ChatOptions = new ChatOptions
                {
                    Instructions = SalesAgentInstructions,
                    MaxOutputTokens = HarnessMaxOutputTokens,
                    Tools =
                    [
                        AIFunctionFactory.Create(GetSalesTodos, options: new() { Name = "get_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(ManageSalesTodos, options: new() { Name = "manage_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(QueryData, options: new() { Name = "query_data", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(SearchFlights, options: new() { Name = "search_flights", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(GenerateA2ui, options: new() { Name = "generate_a2ui", SerializerOptions = _jsonSerializerOptions }),
                    ],
                },
            });

        return new SharedStateAgent(harnessAgent, _jsonSerializerOptions, _loggerFactory.CreateLogger<SharedStateAgent>());
    }

    // Factory method for the Multimodal demo's vision-capable chat client.
    // Reuses the shared OpenAIClient so we don't re-resolve credentials for
    // each mount. Returns an IChatClient (NOT an agent) — the multimodal
    // endpoint consumes attachments natively and does not need the harness
    // agent wrapper. Referenced by W0's Program.cs MapPost("/multimodal", ...).
    public IChatClient CreateMultimodalChatClient() =>
        _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

    // Factory method for the Agent Config demo. Wraps a neutral harness agent
    // (no tools) in AgentConfigAgent so the tone/expertise/responseLength
    // directives read from AG-UI shared state steer the inner model per-turn.
    public AIAgent CreateAgentConfigAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();
        var inner = chatClient.AsHarnessAgent(
            HarnessMaxContextWindowTokens,
            HarnessMaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = "AgentConfigInner",
                Description = "Agent Config demo powered by Microsoft Agent Harness over Microsoft Agent Framework.",
                ChatOptions = new ChatOptions
                {
                    Instructions = "You are a helpful assistant. Follow the tone, expertise, and response-length directives in the system message for each turn.",
                    MaxOutputTokens = HarnessMaxOutputTokens,
                },
            });
        return new AgentConfigAgent(inner, _loggerFactory.CreateLogger<AgentConfigAgent>());
    }

    // Factory method for the Reasoning demo. Delegates to the static
    // ReasoningAgentFactory.Create(...) which builds a reasoning-capable
    // harness agent and wraps it in the ReasoningAgent DelegatingAIAgent.
    public AIAgent CreateReasoningAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();
        return ReasoningAgentFactory.Create(chatClient, _loggerFactory);
    }

    // =================
    // Tools
    // =================

    [Description("Get the current sales pipeline")]
    private List<SalesTodo> GetSalesTodos()
    {
        var todos = _state.Todos;
        _logger.LogInformation("Getting sales todos: {Count} items", todos.Count);
        // Return a snapshot list copy — callers (AIFunctionFactory) serialize
        // this and we don't want concurrent ReplaceTodos mutating mid-serialize.
        return todos.ToList();
    }

    [Description("Update the sales pipeline")]
    private string ManageSalesTodos([Description("The updated list of sales todos")] List<SalesTodo> todos)
    {
        ArgumentNullException.ThrowIfNull(todos);
        _logger.LogInformation("Updating sales todos: {Count} items", todos.Count);
        _state.ReplaceTodos(todos);
        return "Pipeline updated";
    }

    [Description("Query financial data for charts")]
    private string QueryData([Description("The query to run")] string query)
    {
        _logger.LogInformation("Querying data: {Query}", query);
        var categories = new[] { "Engineering", "Marketing", "Sales", "Support", "Design" };
        var random = new Random();
        var results = categories.Select(c => new { category = c, value = random.Next(10000, 100000), quarter = "Q1 2026" });
        return JsonSerializer.Serialize(results);
    }

    [Description("Get the weather for a given location. Ensure location is fully spelled out.")]
    private WeatherInfo GetWeather([Description("The location to get the weather for")] string location)
    {
        _logger.LogInformation("Getting weather for: {Location}", location);
        return new()
        {
            City = location,
            Temperature = 20,
            Conditions = "sunny",
            Humidity = 50,
            WindSpeed = 10,
            FeelsLike = 25
        };
    }

    [Description("Search for available flights between two cities. Returns flight data with A2UI rendering.")]
    private object SearchFlights(
        [Description("Origin airport code or city")] string origin,
        [Description("Destination airport code or city")] string destination)
    {
        _logger.LogInformation("Searching flights from {Origin} to {Destination}", origin, destination);

        var flights = new List<FlightInfo>
        {
            new() { Airline = "United Airlines", AirlineLogo = "UA", FlightNumber = "UA 2451",
                     Origin = origin, Destination = destination, Date = "2026-05-15",
                     DepartureTime = "08:00", ArrivalTime = "16:35", Duration = "5h 35m",
                     Status = FlightStatus.OnTime, Price = 342m, Currency = Currency.USD },
            new() { Airline = "Delta Air Lines", AirlineLogo = "DL", FlightNumber = "DL 1087",
                     Origin = origin, Destination = destination, Date = "2026-05-15",
                     DepartureTime = "10:30", ArrivalTime = "19:15", Duration = "5h 45m",
                     Status = FlightStatus.OnTime, Price = 289m, Currency = Currency.USD },
            new() { Airline = "JetBlue Airways", AirlineLogo = "B6", FlightNumber = "B6 524",
                     Origin = origin, Destination = destination, Date = "2026-05-15",
                     DepartureTime = "14:15", ArrivalTime = "22:50", Duration = "5h 35m",
                     Status = FlightStatus.OnTime, Price = 315m, Currency = Currency.USD },
        };

        var flightSchema = new object[]
        {
            new { id = "root", component = "Row",
                  children = new { componentId = "flight-card", path = "/flights" }, gap = 16 },
            new { id = "flight-card", component = "FlightCard",
                  airline = new { path = "airline" }, airlineLogo = new { path = "airlineLogo" },
                  flightNumber = new { path = "flightNumber" }, origin = new { path = "origin" },
                  destination = new { path = "destination" }, date = new { path = "date" },
                  departureTime = new { path = "departureTime" }, arrivalTime = new { path = "arrivalTime" },
                  duration = new { path = "duration" }, status = new { path = "status" },
                  price = new { path = "price" },
                  action = new { @event = new { name = "book_flight",
                      context = new { flightNumber = new { path = "flightNumber" },
                          origin = new { path = "origin" }, destination = new { path = "destination" },
                          price = new { path = "price" } } } } }
        };

        var operations = new object[]
        {
            new { version = "v0.9", createSurface = new { surfaceId = "flight-search-results",
                  catalogId = "copilotkit://app-dashboard-catalog" } },
            new { version = "v0.9", updateComponents = new { surfaceId = "flight-search-results",
                  components = flightSchema } },
            new { version = "v0.9", updateDataModel = new { surfaceId = "flight-search-results",
                  path = "/", value = new { flights } } }
        };

        return new { a2ui_operations = operations };
    }

    [Description("Generate dynamic A2UI components using a secondary LLM call")]
    private async Task<object> GenerateA2ui(
        [Description("Conversation context to generate UI from.")] string context = "",
        CancellationToken cancellationToken = default)
    {
        context ??= "";

        // Correlation id so server logs can be tied to the structured error
        // we return to the caller / LLM. 16 hex chars = 64 bits of entropy.
        var errorId = Guid.NewGuid().ToString("n")[..16];
        var userContent = string.IsNullOrWhiteSpace(context)
            ? "Show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales."
            : context;
        _logger.LogInformation("Generating A2UI (errorId={ErrorId}) for: {Request}", errorId, userContent);

        string? content;
        try
        {
            // Harness 5-arg signature (extra ILogger) — W0 contract §1 / §6 FLAG #3.
            content = await A2uiSecondaryToolCaller.GetDesignToolArgumentsAsync(
                _configuration,
                "Generate a useful A2UI dashboard.",
                userContent,
                _logger,
                cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): transport failure", errorId);
            return BeautifulChatA2ui.StructuredError("upstream_unavailable", "The upstream AI service is currently unreachable. Please retry.", "Retry the request in a few seconds.", errorId);
        }
        catch (ClientResultException ex)
        {
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): upstream returned error status {Status}", errorId, ex.Status);
            return BeautifulChatA2ui.StructuredError("upstream_error", "The upstream AI service returned an error.", "Try rephrasing the request or retrying later.", errorId);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("GenerateA2ui (errorId={ErrorId}): cancelled", errorId);
            throw;
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): upstream returned malformed JSON", errorId);
            return BeautifulChatA2ui.StructuredError("upstream_malformed", "The AI service returned an invalid response.", "Try rephrasing the request or retrying.", errorId);
        }
        catch (KeyNotFoundException ex)
        {
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): upstream JSON missing required field", errorId);
            return BeautifulChatA2ui.StructuredError("upstream_malformed", "The AI service returned an unexpected response shape.", "Try rephrasing the request or retrying.", errorId);
        }
        // Deliberately no catch (Exception ex): configuration errors like
        // ApiKeyResolver's InvalidOperationException must propagate so a
        // misconfigured deployment fails fast at the operator layer.

        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("GenerateA2ui (errorId={ErrorId}): empty response", errorId);
            return BeautifulChatA2ui.StructuredError(
                "empty_llm_output",
                "The AI service returned an empty response.",
                "Try rephrasing the request or retrying.",
                errorId);
        }

        // Reuse the harness A2UI response builder so the JSON massaging is
        // shared across demos with the same structured error taxonomy.
        return BeautifulChatA2ui.BuildA2uiResponseFromContent(content, errorId, _logger);
    }
}

// =================
// Data Models
// =================

// SalesStateSnapshot is the wire-format shape: what the model emits via
// JSON Schema and what we serialize as DataContent on the outbound side
// (used by SharedStateAgent's two-pass structured-output flow). Immutable
// record wrapping the same list type SalesState exposes, with explicit
// JsonPropertyName so the schema name doesn't drift under default policies.
public sealed record SalesStateSnapshot(
    [property: JsonPropertyName("todos")] IReadOnlyList<SalesTodo> Todos)
{
    public SalesStateSnapshot() : this(Array.Empty<SalesTodo>()) { }
}

// =================
// Serializer Context
// =================
// Referenced by W0's Program.cs:
//   options.SerializerOptions.TypeInfoResolverChain.Add(SalesAgentSerializerContext.Default);
// NOTE: WeatherInfo is declared in Program.cs (do NOT re-declare); it is
// registered here so the source-generated context can resolve the sales
// agent's get_weather tool I/O through the fast path.
[JsonSerializable(typeof(SalesStateSnapshot))]
[JsonSerializable(typeof(SalesTodo))]
[JsonSerializable(typeof(List<SalesTodo>))]
[JsonSerializable(typeof(IReadOnlyList<SalesTodo>))]
[JsonSerializable(typeof(SalesStage))]
[JsonSerializable(typeof(Currency))]
[JsonSerializable(typeof(WeatherInfo))]
[JsonSerializable(typeof(FlightInfo))]
[JsonSerializable(typeof(List<FlightInfo>))]
[JsonSerializable(typeof(FlightStatus))]
[JsonSerializable(typeof(DateOnly))]
internal sealed partial class SalesAgentSerializerContext : JsonSerializerContext;
