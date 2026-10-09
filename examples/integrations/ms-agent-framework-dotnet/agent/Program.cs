using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI;
using OpenAI.Chat;
using System.ComponentModel;
using System.Text.Json.Serialization;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Add(ProverbsAgentSerializerContext.Default));
builder.Services.AddAGUIServer();

WebApplication app = builder.Build();

// Create the agent factory and map the AG-UI agent endpoint
var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var agentFactory = new ProverbsAgentFactory(builder.Configuration, loggerFactory, jsonOptions.Value.SerializerOptions);

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapAGUIServer("/", agentFactory.CreateProverbsAgent());

await app.RunAsync();

// =================
// State Management
// =================
public class ProverbsState
{
    public List<string> Proverbs { get; set; } = [];
}

// =================
// Agent Factory
// =================
public class ProverbsAgentFactory
{
    private readonly IConfiguration _configuration;
    private readonly ProverbsState _state;
    private readonly OpenAIClient _openAiClient;
    private readonly string _model;
    private readonly ILogger _logger;
    private readonly System.Text.Json.JsonSerializerOptions _jsonSerializerOptions;

    public ProverbsAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory, System.Text.Json.JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _state = new();
        _logger = loggerFactory.CreateLogger<ProverbsAgentFactory>();
        _jsonSerializerOptions = jsonSerializerOptions;

        // COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") picks the
        // provider and model; unset, the agent uses gpt-5-mini on OpenAI. Like
        // OPENAI_API_KEY it is read from configuration (user-secrets or an
        // environment variable). Anthropic and Google are reached through their
        // OpenAI-compatible Chat Completions endpoints, so the OpenAI client
        // serves all three. An OpenAI-compatible provider is
        // openai:<its model id> plus OPENAI_BASE_URL.
        var agentModel = _configuration["COPILOTKIT_AGENT_MODEL"];
        var (provider, model) = ParseAgentModel(
            string.IsNullOrWhiteSpace(agentModel) ? "openai:gpt-5-mini" : agentModel);
        _model = model;

        var apiKeyName = provider switch
        {
            "anthropic" => "ANTHROPIC_API_KEY",
            "google" => "GOOGLE_API_KEY",
            _ => "OPENAI_API_KEY",
        };
        var apiKey = _configuration[apiKeyName]
            ?? throw new InvalidOperationException(
                $"{apiKeyName} not found in configuration. " +
                $"Set it with: dotnet user-secrets set {apiKeyName} \"<your-api-key>\"");

        var openAiBaseUrl = _configuration["OPENAI_BASE_URL"];
        Uri? endpoint = provider switch
        {
            "anthropic" => new Uri("https://api.anthropic.com/v1/"),
            "google" => new Uri("https://generativelanguage.googleapis.com/v1beta/openai/"),
            _ => string.IsNullOrWhiteSpace(openAiBaseUrl) ? null : new Uri(openAiBaseUrl),
        };
        _openAiClient = endpoint is null
            ? new OpenAIClient(apiKey)
            : new OpenAIClient(
                new System.ClientModel.ApiKeyCredential(apiKey),
                new OpenAIClientOptions { Endpoint = endpoint });
    }

    /// <summary>
    /// Parses <c>&lt;provider&gt;:&lt;model&gt;</c> (or <c>&lt;provider&gt;/&lt;model&gt;</c>).
    /// Providers: openai, anthropic, google (gemini and google-gemini are aliases
    /// of google). The model id after the first ':' or '/' is kept unchanged.
    /// </summary>
    internal static (string Provider, string Model) ParseAgentModel(string value)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value.Trim(), "^([A-Za-z0-9-]+)[:/](.+)$");
        var provider = !match.Success ? null : match.Groups[1].Value.ToLowerInvariant() switch
        {
            "openai" => "openai",
            "anthropic" => "anthropic",
            "google" or "gemini" or "google-gemini" => "google",
            _ => null,
        };
        if (provider is null)
        {
            throw new InvalidOperationException(
                $"COPILOTKIT_AGENT_MODEL=\"{value}\" is not <provider>:<model> with provider openai, anthropic or google");
        }
        return (provider, match.Groups[2].Value);
    }

    public AIAgent CreateProverbsAgent()
    {
        var chatClientAgent = _openAiClient.GetChatClient(_model).AsAIAgent(
            new ChatClientAgentOptions
            {
                Name = "ProverbsAgent",
                Description = "A helpful assistant that helps manage and discuss proverbs.",
                ChatOptions = new ChatOptions
                {
                    Instructions = @"You have tools available to add, set, or retrieve proverbs from the list.
                    When discussing proverbs, ALWAYS use the get_proverbs tool to see the current list before mentioning, updating, or discussing proverbs with the user.",
                    Tools = [
                        AIFunctionFactory.Create(GetProverbs, options: new() { Name = "get_proverbs", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(AddProverbs, options: new() { Name = "add_proverbs", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(SetProverbs, options: new() { Name = "set_proverbs", SerializerOptions = _jsonSerializerOptions }),
                        AIFunctionFactory.Create(GetWeather, options: new() { Name = "get_weather", SerializerOptions = _jsonSerializerOptions })
                    ]
                }
            });

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions);
    }

    // =================
    // Tools
    // =================

    [Description("Get the current list of proverbs.")]
    private List<string> GetProverbs()
    {
        _logger.LogInformation("📖 Getting proverbs: {Proverbs}", string.Join(", ", _state.Proverbs));
        return _state.Proverbs;
    }

    [Description("Add new proverbs to the list.")]
    private void AddProverbs([Description("The proverbs to add")] List<string> proverbs)
    {
        _logger.LogInformation("➕ Adding proverbs: {Proverbs}", string.Join(", ", proverbs));
        _state.Proverbs.AddRange(proverbs);
    }

    [Description("Replace the entire list of proverbs.")]
    private void SetProverbs([Description("The new list of proverbs")] List<string> proverbs)
    {
        _logger.LogInformation("📝 Setting proverbs: {Proverbs}", string.Join(", ", proverbs));
        _state.Proverbs = [.. proverbs];
    }

    [Description("Get the weather for a given location. Ensure location is fully spelled out.")]
    private WeatherInfo GetWeather([Description("The location to get the weather for")] string location)
    {
        _logger.LogInformation("🌤️  Getting weather for: {Location}", location);
        return new()
        {
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

public class ProverbsStateSnapshot
{
    [JsonPropertyName("proverbs")]
    public List<string> Proverbs { get; set; } = [];
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

    [JsonPropertyName("feelsLike")]
    public int FeelsLike { get; init; }
}

public partial class Program { }

// =================
// Serializer Context
// =================
[JsonSerializable(typeof(ProverbsStateSnapshot))]
[JsonSerializable(typeof(WeatherInfo))]
internal sealed partial class ProverbsAgentSerializerContext : JsonSerializerContext;
