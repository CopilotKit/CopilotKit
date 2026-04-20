// Minimal Microsoft Agent Framework (.NET) backend for the Agentic Chat cell.
//
// Exposes one AG-UI agent at "/" with a single backend-rendered tool
// ("get_weather") plus free-form chat. Frontend-invoked tools like
// "change_background" are registered on the React side via useFrontendTool
// and appear in the tool catalog without the backend knowing about them.
//
// Auth: prefer OPENAI_API_KEY (OpenAI) and fall back to GitHubToken (Azure
// AI inference via github models). This lets the container run against the
// showcase-root .env which only sets OPENAI_API_KEY.

using System.ComponentModel;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.Extensions.AI;
using OpenAI;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddAGUI();

WebApplication app = builder.Build();

var openAiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
var githubToken = Environment.GetEnvironmentVariable("GitHubToken")
    ?? builder.Configuration["GitHubToken"];

string apiKey;
Uri? endpoint = null;
string model;

if (!string.IsNullOrEmpty(openAiKey))
{
    apiKey = openAiKey;
    model = Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4o-mini";
    var baseUrl = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
    if (!string.IsNullOrEmpty(baseUrl)) endpoint = new Uri(baseUrl);
}
else if (!string.IsNullOrEmpty(githubToken))
{
    apiKey = githubToken;
    model = Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4o-mini";
    endpoint = new Uri(Environment.GetEnvironmentVariable("OPENAI_BASE_URL")
        ?? "https://models.inference.ai.azure.com");
}
else
{
    throw new InvalidOperationException(
        "Set OPENAI_API_KEY (OpenAI) or GitHubToken (Azure AI inference) in the environment.");
}

var openAiClientOptions = new OpenAIClientOptions();
if (endpoint is not null) openAiClientOptions.Endpoint = endpoint;

var openAiClient = new OpenAIClient(
    new System.ClientModel.ApiKeyCredential(apiKey), openAiClientOptions);

var chatClient = openAiClient.GetChatClient(model).AsIChatClient();

WeatherInfo GetWeather([Description("The location to get the weather for")] string location)
    => new()
    {
        City = location,
        Temperature = 20,
        Conditions = "sunny",
        Humidity = 50,
        WindSpeed = 10,
        FeelsLike = 25,
    };

AIAgent agent = new ChatClientAgent(
    chatClient,
    name: "AgenticChatAgent",
    description: "A helpful assistant that can chat and report the weather.",
    tools: [AIFunctionFactory.Create((Func<string, WeatherInfo>)GetWeather, name: "get_weather")]);

app.MapAGUI("/", agent);
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

await app.RunAsync();

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
