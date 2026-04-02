using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;

DotNetEnv.Env.Load("../../.env");

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Add(DemoAgentSerializerContext.Default));
builder.Services.AddAGUI();

WebApplication app = builder.Build();

var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var agentFactory = new DemoAgentFactory(builder.Configuration, loggerFactory, jsonOptions.Value.SerializerOptions);
app.MapAGUI("/", agentFactory.CreateDemoAgent());

await app.RunAsync();

// =================
// State
// =================
public class Todo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("emoji")]
    public string Emoji { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = "pending";
}

public class TodosStateSnapshot
{
    [JsonPropertyName("todos")]
    public List<Todo> Todos { get; set; } = [];
}

public class WeatherInfo
{
    [JsonPropertyName("temperature")]
    public int Temperature { get; init; }

    [JsonPropertyName("conditions")]
    public string Conditions { get; init; } = string.Empty;

    [JsonPropertyName("humidity")]
    public int Humidity { get; init; }

    [JsonPropertyName("windSpeed")]
    public int WindSpeed { get; init; }

    [JsonPropertyName("feelsLike")]
    public int FeelsLike { get; init; }

    [JsonPropertyName("location")]
    public string Location { get; init; } = string.Empty;
}

// =================
// Agent Factory
// =================
public class DemoAgentFactory
{
    private readonly IConfiguration _configuration;
    private readonly List<Todo> _todos = [];
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public DemoAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _logger = loggerFactory.CreateLogger<DemoAgentFactory>();
        _jsonSerializerOptions = jsonSerializerOptions;

        var openAiApiKey = _configuration["OPENAI_API_KEY"]
            ?? throw new InvalidOperationException(
                "OPENAI_API_KEY not found in configuration. " +
                "Please set it in your .env file or environment.");

        _openAiClient = new(openAiApiKey);
    }

    public AIAgent CreateDemoAgent()
    {
        var model = _configuration["OPENAI_MODEL"] ?? "gpt-4o";
        var chatClient = _openAiClient.GetChatClient(model).AsIChatClient();

        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "DemoAgent",
            description: @"You are a polished, professional demo assistant using CopilotKit and Microsoft Agent Framework.

Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

When demonstrating charts, always call the query_data tool to fetch data first.
When asked to manage todos, enable app mode first, then manage todos.",
            tools: [
                AIFunctionFactory.Create(GetTodos, options: new() { Name = "get_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(ManageTodos, options: new() { Name = "manage_todos", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(QueryData, options: new() { Name = "query_data", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GenerateForm, options: new() { Name = "generate_form", SerializerOptions = _jsonSerializerOptions }),
                AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions })
            ]);

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions);
    }

    [Description("Get the current list of todos.")]
    private List<Todo> GetTodos()
    {
        _logger.LogInformation("Getting todos: {Count} items", _todos.Count);
        return _todos;
    }

    [Description("Manage the current todos. Call this to add, update, or remove todos. Always pass the COMPLETE list.")]
    private string ManageTodos([Description("The complete list of todos")] List<Todo> todos)
    {
        _logger.LogInformation("Updating todos: {Count} items", todos.Count);
        foreach (var todo in todos)
        {
            if (string.IsNullOrEmpty(todo.Id))
                todo.Id = Guid.NewGuid().ToString();
        }
        _todos.Clear();
        _todos.AddRange(todos);
        return "Successfully updated todos";
    }

    [Description("Query the database, takes natural language. Always call before showing a chart or graph.")]
    private string QueryData([Description("Natural language query")] string query)
    {
        _logger.LogInformation("Querying data: {Query}", query);
        return """[{"date":"2026-01-05","category":"Revenue","subcategory":"Enterprise Subscriptions","amount":"45000","type":"income","notes":"3 new enterprise customers"},{"date":"2026-01-05","category":"Revenue","subcategory":"Pro Tier Upgrades","amount":"12000","type":"income","notes":"24 users upgraded"},{"date":"2026-01-10","category":"Expenses","subcategory":"Engineering Salaries","amount":"42000","type":"expense","notes":"7 engineers + 2 contractors"},{"date":"2026-01-10","category":"Expenses","subcategory":"Product Team","amount":"18000","type":"expense","notes":"PM and 2 designers"},{"date":"2026-01-12","category":"Expenses","subcategory":"AWS Infrastructure","amount":"8200","type":"expense","notes":"Increased compute"},{"date":"2026-01-15","category":"Expenses","subcategory":"Marketing - Paid Ads","amount":"12000","type":"expense","notes":"Google Ads and LinkedIn"},{"date":"2026-01-18","category":"Revenue","subcategory":"Consulting Services","amount":"8500","type":"income","notes":"Custom integration"},{"date":"2026-02-03","category":"Revenue","subcategory":"Enterprise Subscriptions","amount":"51000","type":"income","notes":"2 new customers + expansion"},{"date":"2026-02-14","category":"Revenue","subcategory":"Consulting Services","amount":"12000","type":"income","notes":"2 custom projects"},{"date":"2026-03-02","category":"Revenue","subcategory":"Enterprise Subscriptions","amount":"58000","type":"income","notes":"Fortune 500 customer"},{"date":"2026-03-02","category":"Revenue","subcategory":"Pro Tier Upgrades","amount":"19000","type":"income","notes":"42 upgrades"},{"date":"2026-03-14","category":"Revenue","subcategory":"Consulting Services","amount":"15500","type":"income","notes":"Fortune 500 onboarding"}]""";
    }

    [Description("Generates an event registration form for the user to sign up for an event.")]
    private JsonElement GenerateForm()
    {
        _logger.LogInformation("Generating event registration form");
        return JsonDocument.Parse("""[{"surfaceUpdate":{"surfaceId":"event-registration","components":[{"id":"root","component":{"Card":{"child":"main-column"}}},{"id":"main-column","component":{"Column":{"children":{"explicitList":["header","name-field","email-field","event-type-field","dietary-field","register-btn"]},"gap":"medium"}}},{"id":"header","component":{"Column":{"children":{"explicitList":["title","subtitle"]},"alignment":"center"}}},{"id":"title","component":{"Text":{"text":{"literalString":"Event Registration"},"usageHint":"h2"}}},{"id":"subtitle","component":{"Text":{"text":{"literalString":"Register for the upcoming CopilotKit Developer Summit"},"usageHint":"caption"}}},{"id":"name-field","component":{"TextField":{"value":{"path":"/name"},"placeholder":{"literalString":"Your full name"},"label":{"literalString":"Full Name"},"action":"updateName"}}},{"id":"email-field","component":{"TextField":{"value":{"path":"/email"},"placeholder":{"literalString":"you@example.com"},"label":{"literalString":"Email"},"action":"updateEmail"}}},{"id":"event-type-field","component":{"TextField":{"value":{"path":"/eventType"},"placeholder":{"literalString":"Workshop, Talk, or Both"},"label":{"literalString":"Session Type"},"action":"updateEventType"}}},{"id":"dietary-field","component":{"TextField":{"value":{"path":"/dietary"},"placeholder":{"literalString":"Any dietary restrictions?"},"label":{"literalString":"Dietary Restrictions"},"action":"updateDietary"}}},{"id":"register-btn-text","component":{"Text":{"text":{"literalString":"Register"}}}},{"id":"register-btn","component":{"Button":{"child":"register-btn-text","action":"register"}}}]}},{"beginRendering":{"surfaceId":"event-registration","root":"root"}}]""").RootElement;
    }

    [Description("Get the weather for a given location.")]
    private WeatherInfo GetWeather([Description("The location to get the weather for")] string location)
    {
        _logger.LogInformation("Getting weather for: {Location}", location);
        return new()
        {
            Temperature = 20,
            Conditions = "sunny",
            Humidity = 50,
            WindSpeed = 10,
            FeelsLike = 25,
            Location = location
        };
    }
}

public partial class Program { }

[JsonSerializable(typeof(TodosStateSnapshot))]
[JsonSerializable(typeof(WeatherInfo))]
[JsonSerializable(typeof(Todo))]
[JsonSerializable(typeof(List<Todo>))]
internal sealed partial class DemoAgentSerializerContext : JsonSerializerContext;
