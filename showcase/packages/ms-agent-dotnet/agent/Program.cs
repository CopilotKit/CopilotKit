using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using System.ComponentModel;
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
// Agent Factory
// =================
public class SalesAgentFactory
{
    private readonly IConfiguration _configuration;
    private readonly SalesState _state;
    private readonly object _stateLock = new();
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly System.Text.Json.JsonSerializerOptions _jsonSerializerOptions;

    public SalesAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory, System.Text.Json.JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _state = new();
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
            When discussing deals or the pipeline, ALWAYS use the get_sales_todos tool to see the current state before mentioning, updating, or discussing deals with the user.",
            tools: [
                AIFunctionFactory.Create(GetSalesTodos, options: new() { Name = "get_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(ManageSalesTodos, options: new() { Name = "manage_sales_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(QueryData, options: new() { Name = "query_data", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions })
            ]);

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions);
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
        return System.Text.Json.JsonSerializer.Serialize(results);
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
internal sealed partial class SalesAgentSerializerContext : JsonSerializerContext;
