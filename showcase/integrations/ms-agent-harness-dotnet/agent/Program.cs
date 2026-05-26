using System.ClientModel;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using OpenAI;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Add(BeautifulChatSerializerContext.Default);
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.AddAGUI();

var app = builder.Build();

// Forward D5/aimock x-* headers from incoming AG-UI requests to outgoing
// OpenAI calls until the .NET SDK owns this propagation centrally.
app.UseMiddleware<AimockHeaderMiddleware>();

var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
var openAiClient = CreateOpenAiClient(builder.Configuration, loggerFactory.CreateLogger("Program"));

var beautifulChatFactory = new BeautifulChatAgentFactory(
    builder.Configuration,
    openAiClient,
    jsonOptions.Value.SerializerOptions,
    loggerFactory.CreateLogger<BeautifulChatAgentFactory>());

app.MapAGUI("/beautiful-chat", beautifulChatFactory.Create());
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

await app.RunAsync();

static OpenAIClient CreateOpenAiClient(IConfiguration configuration, ILogger logger)
{
    var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
    var endpoint = endpointEnv ?? ApiKeyResolver.DefaultOpenAiEndpoint;
    if (string.IsNullOrEmpty(endpointEnv))
    {
        logger.LogInformation("OPENAI_BASE_URL not set; using default OpenAI endpoint: {Endpoint}", endpoint);
    }
    else
    {
        logger.LogInformation("Using OpenAI endpoint from OPENAI_BASE_URL: {Endpoint}", endpoint);
    }

    var apiKey = ApiKeyResolver.ResolveApiKey(configuration, logger);

    return new OpenAIClient(
        new ApiKeyCredential(apiKey),
        AimockHeaderPolicy.CreateOpenAIClientOptions(endpoint));
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
    public string City { get; init; } = string.Empty;
}

public partial class Program { }

[JsonSerializable(typeof(WeatherInfo))]
[JsonSerializable(typeof(BeautifulChatTodo))]
[JsonSerializable(typeof(List<BeautifulChatTodo>))]
[JsonSerializable(typeof(BeautifulChatFlight))]
[JsonSerializable(typeof(List<BeautifulChatFlight>))]
internal partial class BeautifulChatSerializerContext : JsonSerializerContext
{
}
