using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Add(SalesAgentSerializerContext.Default));
builder.Services.AddAGUI();

WebApplication app = builder.Build();

// Create the agent factory and map the AG-UI agent endpoint
var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var agentFactory = new SalesAgentFactory(builder.Configuration, loggerFactory, jsonOptions.Value.SerializerOptions);
app.MapAGUI("/", agentFactory.CreateSalesAgent());
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

await app.RunAsync();

// =================
// State Management
// =================
public record SalesTodo
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    [JsonPropertyName("title")]
    public string Title { get; init; } = "";

    [JsonPropertyName("stage")]
    public string Stage { get; init; } = "prospect";

    [JsonPropertyName("value")]
    public int Value { get; init; }

    [JsonPropertyName("dueDate")]
    public string DueDate { get; init; } = "";

    [JsonPropertyName("assignee")]
    public string Assignee { get; init; } = "";

    [JsonPropertyName("completed")]
    public bool Completed { get; init; }
}

public class SalesState
{
    public List<SalesTodo> Todos { get; set; } = [];
}

// =================
// Flight Data
// =================
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

    [JsonPropertyName("status")]
    public string Status { get; init; } = "";

    [JsonPropertyName("statusColor")]
    public string StatusColor { get; init; } = "";

    [JsonPropertyName("price")]
    public string Price { get; init; } = "";

    [JsonPropertyName("currency")]
    public string Currency { get; init; } = "";
}

// =================
// Agent Factory
// =================
public class SalesAgentFactory
{
    private readonly IConfiguration _configuration;
    private readonly SalesState _state;
    private readonly object _stateLock = new();
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

        _openAiClient = new(
            new System.ClientModel.ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? "https://models.inference.ai.azure.com")
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

    // =================
    // Tools
    // =================

    [Description("Get the current sales pipeline")]
    private List<SalesTodo> GetSalesTodos()
    {
        lock (_stateLock)
        {
            _logger.LogInformation("Getting sales todos: {Count} items", _state.Todos.Count);
            return _state.Todos.ToList();
        }
    }

    [Description("Update the sales pipeline")]
    private string ManageSalesTodos([Description("The updated list of sales todos")] List<SalesTodo> todos)
    {
        _logger.LogInformation("Updating sales todos: {Count} items", todos.Count);
        lock (_stateLock)
        {
            _state.Todos = todos.Select(t => t with
            {
                Id = string.IsNullOrEmpty(t.Id) ? Guid.NewGuid().ToString()[..8] : t.Id
            }).ToList();
        }
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
                     Status = "On Time", StatusColor = "green", Price = "$342", Currency = "USD" },
            new() { Airline = "Delta Air Lines", AirlineLogo = "DL", FlightNumber = "DL 1087",
                     Origin = origin, Destination = destination, Date = "2026-05-15",
                     DepartureTime = "10:30", ArrivalTime = "19:15", Duration = "5h 45m",
                     Status = "On Time", StatusColor = "green", Price = "$289", Currency = "USD" },
            new() { Airline = "JetBlue Airways", AirlineLogo = "B6", FlightNumber = "B6 524",
                     Origin = origin, Destination = destination, Date = "2026-05-15",
                     DepartureTime = "14:15", ArrivalTime = "22:50", Duration = "5h 35m",
                     Status = "On Time", StatusColor = "green", Price = "$315", Currency = "USD" }
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
    private string GenerateA2ui([Description("The user's request describing what UI to generate")] string userRequest)
    {
        _logger.LogInformation("Generating A2UI for: {Request}", userRequest);

        try
        {
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
                new(ChatRole.User, userRequest)
            };

            var result = secondaryChatClient.GetResponseAsync(messages).GetAwaiter().GetResult();
            var content = result.Text;

            var args = JsonDocument.Parse(content).RootElement;
            var surfaceId = args.TryGetProperty("surfaceId", out var sid) ? sid.GetString() ?? "dynamic-surface" : "dynamic-surface";
            var catalogId = args.TryGetProperty("catalogId", out var cid) ? cid.GetString() ?? "copilotkit://app-dashboard-catalog" : "copilotkit://app-dashboard-catalog";

            var ops = new List<object>
            {
                new { type = "create_surface", surfaceId, catalogId },
                new { type = "update_components", surfaceId,
                      components = JsonSerializer.Deserialize<object[]>(args.GetProperty("components").GetRawText()) }
            };

            if (args.TryGetProperty("data", out var dataElement) && dataElement.ValueKind != JsonValueKind.Null)
            {
                ops.Add(new { type = "update_data_model", surfaceId,
                             data = JsonSerializer.Deserialize<object>(dataElement.GetRawText()) });
            }

            return JsonSerializer.Serialize(new { a2ui_operations = ops });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate A2UI");
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }
}

// =================
// Data Models
// =================

public class SalesStateSnapshot
{
    [JsonPropertyName("todos")]
    public List<SalesTodo> Todos { get; set; } = [];
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
[JsonSerializable(typeof(WeatherInfo))]
[JsonSerializable(typeof(FlightInfo))]
[JsonSerializable(typeof(List<FlightInfo>))]
internal sealed partial class SalesAgentSerializerContext : JsonSerializerContext;
