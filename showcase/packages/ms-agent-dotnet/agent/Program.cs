using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using System.ClientModel;
using System.ComponentModel;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Add(SalesAgentSerializerContext.Default);
    // Serialize our enum types (SalesStage, Currency, FlightStatus) as their
    // member name strings rather than numeric ordinals. This keeps the wire
    // format human-readable and stable across enum re-ordering.
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.AddAGUI();

WebApplication app = builder.Build();

// Create the agent factory and map the AG-UI agent endpoint
var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var agentFactory = new SalesAgentFactory(builder.Configuration, loggerFactory, jsonOptions.Value.SerializerOptions);
app.MapAGUI("/", agentFactory.CreateSalesAgent());

// Open-Ended Generative UI (minimal). The factory builds a ChatClientAgent
// with an LLM-shaping system prompt; the agent exposes NO backend tools —
// the `generateSandboxedUi` frontend tool is auto-registered by the
// CopilotKit runtime's OGUI middleware and merged in via the normal AG-UI
// flow. See OpenGenUiAgent.cs for details.
var openGenUiFactory = new OpenGenUiAgentFactory(builder.Configuration);
app.MapAGUI("/open-gen-ui", openGenUiFactory.CreateAgent());

// Open-Ended Generative UI (advanced). Same OGUI pipeline, but the
// agent-authored iframe can invoke frontend-registered sandbox functions
// via `Websandbox.connection.remote.<name>(args)`. The sandbox functions
// themselves live on the frontend (see
// `src/app/demos/open-gen-ui-advanced/sandbox-functions.ts`) and are
// wired by the CopilotKit provider; this agent's only job is to know the
// calling contract and emit HTML/JS that uses it.
var openGenUiAdvancedFactory = new OpenGenUiAdvancedAgentFactory(builder.Configuration);
app.MapAGUI("/open-gen-ui-advanced", openGenUiAdvancedFactory.CreateAgent());

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

await app.RunAsync();

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
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly IConfiguration _configuration;
    private readonly SalesState _state;
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public SalesAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _state = new();
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<SalesAgentFactory>();
        _jsonSerializerOptions = jsonSerializerOptions;

        // Get the GitHub token from configuration
        var githubToken = _configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        // Log the resolved OpenAI endpoint at startup so operators can tell
        // whether we're hitting a custom OPENAI_BASE_URL or falling back to the
        // GitHub Models / Azure default. Previously the fallback was silent.
        var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
        var endpoint = endpointEnv ?? DefaultOpenAiEndpoint;
        if (string.IsNullOrEmpty(endpointEnv))
        {
            _logger.LogInformation(
                "OPENAI_BASE_URL not set; using default OpenAI endpoint: {Endpoint}", endpoint);
        }
        else
        {
            _logger.LogInformation("Using OpenAI endpoint from OPENAI_BASE_URL: {Endpoint}", endpoint);
        }

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent CreateSalesAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "SalesAgent",
            description: @"A helpful assistant that helps manage a sales pipeline.
            You have tools available to get, update, and query sales data.
            You can search for flights and generate dynamic UI.
            When discussing deals or the pipeline, ALWAYS use the get_sales_todos tool to see the current state before mentioning, updating, or discussing deals with the user.",
            tools: [
                AIFunctionFactory.Create(GetSalesTodos, options: new() { Name = "get_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(ManageSalesTodos, options: new() { Name = "manage_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(QueryData, options: new() { Name = "query_data", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(SearchFlights, options: new() { Name = "search_flights", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GenerateA2ui, options: new() { Name = "generate_a2ui", SerializerOptions = _jsonSerializerOptions })
            ]);

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions, _loggerFactory.CreateLogger<SharedStateAgent>());
    }

    // Factory method for the Multimodal demo's vision-capable agent. Reuses
    // the shared OpenAIClient so we don't re-resolve credentials for each
    // mount. No tools — the chat model consumes attachments natively.
    public AIAgent CreateMultimodalAgent() => MultimodalAgentFactory.Create(_openAiClient);

    // Factory method for the Beautiful Chat flagship demo. Holds its own
    // per-factory tool surface + in-memory todo store so it doesn't
    // interfere with the sales pipeline state owned by the main agent.
    public AIAgent CreateBeautifulChatAgent()
    {
        var factory = new BeautifulChatAgentFactory(
            _openAiClient,
            _jsonSerializerOptions,
            _loggerFactory.CreateLogger<BeautifulChatAgentFactory>());
        return factory.Create();
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
    private string SearchFlights(
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
            new { type = "create_surface", surfaceId = "flight-search-results",
                  catalogId = "copilotkit://app-dashboard-catalog" },
            new { type = "update_components", surfaceId = "flight-search-results",
                  components = flightSchema },
            new { type = "update_data_model", surfaceId = "flight-search-results",
                  data = new { flights } }
        };

        return JsonSerializer.Serialize(new { a2ui_operations = operations });
    }

    [Description("Generate dynamic A2UI components using a secondary LLM call")]
    private async Task<string> GenerateA2ui(
        [Description("The user's request describing what UI to generate")] string userRequest,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userRequest);

        // Correlation id so server logs can be tied to the structured error
        // we return to the caller / LLM. Callers can quote this in bug
        // reports without leaking stack traces or internal paths. 16 hex
        // chars = 64 bits of entropy — matches ``SalesTodo.NewPending``'s
        // ``Id`` field for the same rationale; 8 chars (~32 bits) has a
        // non-trivial collision risk at operational scale and we want
        // errorIds to uniquely correlate log lines even across busy
        // deployments.
        var errorId = Guid.NewGuid().ToString("n")[..16];
        _logger.LogInformation("Generating A2UI (errorId={ErrorId}) for: {Request}", errorId, userRequest);

        var secondaryChatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var systemPrompt = @"You are a UI generator. Given a user request, generate A2UI v0.9 components.
You MUST respond with ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  ""surfaceId"": ""dynamic-surface"",
  ""catalogId"": ""copilotkit://app-dashboard-catalog"",
  ""components"": [<A2UI v0.9 component array>],
  ""data"": {<optional initial data>}
}
The root component must have id ""root"".
Available components: Row, Column, Text, Card, Button, Badge, Table, Chart.";

        var messages = new List<ChatMessage>
        {
            new(ChatRole.System, systemPrompt),
            new(ChatRole.User, userRequest),
        };

        // The outbound LLM call is awaited directly rather than blocked via
        // .GetAwaiter().GetResult(), which would tie up a thread-pool thread
        // for the full network round-trip.
        //
        // Exception handling is deliberately narrow: we catch only the
        // expected failure modes (transport, upstream non-success, malformed
        // JSON, shape mismatch, cancellation). Programmer errors like
        // NullReferenceException or resource-exhaustion errors like
        // OutOfMemoryException propagate unchanged so they surface in logs
        // rather than being silently remapped to "upstream error". The
        // user-facing structured error we return does NOT include
        // ex.Message verbatim — we log the full exception server-side with
        // the correlation id so operators can correlate without exposing
        // provider internals to the caller.
        string? content;
        try
        {
            var result = await secondaryChatClient.GetResponseAsync(messages, cancellationToken: cancellationToken).ConfigureAwait(false);
            content = result.Text;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): upstream transport failure", errorId);
            return StructuredError("upstream_unavailable", "The upstream AI service is currently unreachable. Please retry.", "Retry the request in a few seconds.", errorId);
        }
        catch (ClientResultException ex)
        {
            // Thrown by OpenAI / Microsoft.Extensions.AI when the upstream
            // responds with a non-success status (rate limit, bad request,
            // auth failure, etc.). We know the status but do not surface it
            // verbatim to the model — avoids leaking provider internals.
            _logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): upstream returned error status {Status}", errorId, ex.Status);
            return StructuredError("upstream_error", "The upstream AI service returned an error.", "Try rephrasing the request or retrying later.", errorId);
        }
        catch (OperationCanceledException)
        {
            // Cancellation is a normal control-flow signal. Log at Information
            // level with the correlation id so operators can tie the log entry
            // to any client-side retry, but don't treat it as an error. Rethrow
            // to preserve ambient cancellation semantics for the caller.
            _logger.LogInformation("GenerateA2ui (errorId={ErrorId}): cancelled", errorId);
            throw;
        }

        // result.Text can legitimately return null (upstream returned no text
        // content — e.g. model refused, empty completion, content filter).
        // BuildA2uiResponseFromContent requires non-null input; catching the
        // null here returns a structured error instead of letting an NRE
        // escape uncaught and break the structured-error contract.
        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("GenerateA2ui (errorId={ErrorId}): upstream returned no text content", errorId);
            return StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        return BuildA2uiResponseFromContent(content, errorId, _logger);
    }

    /// <summary>
    /// Parses an LLM-produced string into an A2UI operations payload, or a
    /// structured error if the content is malformed, null, or empty. Exposed
    /// as <c>internal static</c> so unit tests can exercise each error branch
    /// (empty_llm_output, JsonException, shape mismatch, ArgumentException)
    /// directly without standing up an OpenAI client.
    /// </summary>
    /// <remarks>
    /// Null/empty content is reported as a structured <c>empty_llm_output</c>
    /// error rather than thrown as an NRE. This matches the contract of the
    /// <see cref="GenerateA2ui"/> caller (which guards null at the call site)
    /// and ensures the helper itself is robust to defensive / test callers
    /// that pass through whatever the upstream produced.
    /// </remarks>
    internal static string BuildA2uiResponseFromContent(string? content, string errorId, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(errorId);
        ArgumentNullException.ThrowIfNull(logger);

        if (string.IsNullOrEmpty(content))
        {
            logger.LogError("GenerateA2ui (errorId={ErrorId}): content was null or empty", errorId);
            return StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        // JsonDocument.Parse can throw JsonException on malformed input.
        // This is isolated from the parse-the-shape errors below so we can
        // return a precise remediation message for each failure mode.
        JsonDocument? jsonDoc;
        try
        {
            jsonDoc = JsonDocument.Parse(content);
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): LLM returned malformed JSON", errorId);
            return StructuredError("malformed_llm_output", "The UI generator produced output that wasn't valid JSON.", "Ask the user to rephrase their request — the model sometimes adds explanatory text around the JSON.", errorId);
        }

        using (jsonDoc)
        {
            try
            {
                var args = jsonDoc.RootElement;

                if (args.ValueKind != JsonValueKind.Object)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output was JSON but not an object (kind={Kind})", errorId, args.ValueKind);
                    return StructuredError("malformed_llm_output", "The UI generator output was JSON but not the expected object shape.", "Retry or adjust the prompt.", errorId);
                }

                var surfaceId = args.TryGetProperty("surfaceId", out var sid) ? sid.GetString() ?? "dynamic-surface" : "dynamic-surface";
                var catalogId = args.TryGetProperty("catalogId", out var cid) ? cid.GetString() ?? "copilotkit://app-dashboard-catalog" : "copilotkit://app-dashboard-catalog";

                if (!args.TryGetProperty("components", out var componentsElement) || componentsElement.ValueKind != JsonValueKind.Array)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output missing 'components' array", errorId);
                    return StructuredError("malformed_llm_output", "The UI generator output didn't include a components array.", "Retry the request.", errorId);
                }

                var ops = new List<object>
                {
                    new { type = "create_surface", surfaceId, catalogId },
                    new
                    {
                        type = "update_components",
                        surfaceId,
                        components = JsonSerializer.Deserialize<object[]>(componentsElement.GetRawText()),
                    },
                };

                if (args.TryGetProperty("data", out var dataElement) && dataElement.ValueKind != JsonValueKind.Null)
                {
                    ops.Add(new
                    {
                        type = "update_data_model",
                        surfaceId,
                        data = JsonSerializer.Deserialize<object>(dataElement.GetRawText()),
                    });
                }

                return JsonSerializer.Serialize(new { a2ui_operations = ops });
            }
            catch (JsonException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): shape deserialization failed", errorId);
                return StructuredError("malformed_llm_output", "The UI generator output didn't match the expected structure.", "Retry the request.", errorId);
            }
            catch (ArgumentException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): argument validation failed", errorId);
                return StructuredError("invalid_argument", "One of the arguments was invalid.", "Check the request shape and retry.", errorId);
            }
        }
    }

    // Structured error payload returned to the LLM/caller. We deliberately
    // keep this short and categorical — no raw exception messages, no paths,
    // no internal identifiers beyond the correlation id.
    internal static string StructuredError(string category, string message, string remediation, string errorId) =>
        JsonSerializer.Serialize(new
        {
            error = category,
            message,
            remediation,
            errorId,
        });
}

// =================
// Data Models
// =================

// SalesStateSnapshot is the wire-format shape: what the model emits via
// JSON Schema and what we serialize as DataContent on the outbound side.
// Previously this was a separate mutable class that duplicated SalesState.
// To avoid the previous duplication, this is an immutable record wrapping the same list type as
// SalesState exposes, with explicit JsonPropertyName so the schema name
// doesn't drift from PascalCase to camelCase under default policies.
public sealed record SalesStateSnapshot(
    [property: JsonPropertyName("todos")] IReadOnlyList<SalesTodo> Todos)
{
    public SalesStateSnapshot() : this(Array.Empty<SalesTodo>()) { }
}

public class WeatherInfo
{
    [JsonPropertyName("temperature")]
    public int Temperature { get; init; }

    [JsonPropertyName("conditions")]
    public string Conditions { get; init; } = string.Empty;

    [JsonPropertyName("humidity")]
    public int Humidity { get; init; }

    [JsonPropertyName("wind_speed")]
    public int WindSpeed { get; init; }

    [JsonPropertyName("feels_like")]
    public int FeelsLike { get; init; }

    [JsonPropertyName("city")]
    public string City { get; init; } = "";
}

public partial class Program { }

// =================
// Serializer Context
// =================
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
