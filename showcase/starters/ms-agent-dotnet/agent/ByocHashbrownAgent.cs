using System.ClientModel;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

/// <summary>
/// Factory for the byoc-hashbrown demo agent.
///
/// This agent emits a hashbrown-shaped JSON envelope that the
/// frontend renderer (`src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx`)
/// progressively parses via `@hashbrownai/react`'s `useJsonParser` + `useUiKit`.
///
/// Wire format: `@hashbrownai/react`'s `useJsonParser(content, kit.schema)`
/// expects a JSON object matching `kit.schema` -- NOT the `&lt;ui&gt;...&lt;/ui&gt;`
/// XML-style examples shown inside `useUiKit({ examples })`. Those XML
/// examples are the hashbrown prompt DSL only used when hashbrown drives
/// the LLM directly; because this demo drives via the Microsoft Agent
/// Framework, the agent must emit the schema wire format instead:
///
///   { "ui": [ { "metric": { "props": { "label": "...", "value": "..." } } }, ... ] }
///
/// Every node is a single-key object `{tagName: {props: {...}}}`.
/// `pieChart` and `barChart` receive `data` as a JSON-encoded string.
/// </summary>
public class ByocHashbrownAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private const string SystemPrompt = @"You are a sales analytics assistant that replies by emitting a single JSON
object consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single JSON object of the form:

{
  ""ui"": [
    { <componentName>: { ""props"": { ... } } },
    ...
  ]
}

Do NOT wrap the response in code fences. Do NOT include any preface or
explanation outside the JSON object. The response MUST be valid JSON.

Available components and their prop schemas:

- ""metric"": { ""props"": { ""label"": string, ""value"": string } }
    A KPI card. `value` is a pre-formatted string like ""$1.2M"" or ""248"".

- ""pieChart"": { ""props"": { ""title"": string, ""data"": string } }
    A donut chart. `data` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments, e.g.
    ""data"": ""[{\""label\"":\""Enterprise\"",\""value\"":600000}]"".

- ""barChart"": { ""props"": { ""title"": string, ""data"": string } }
    A vertical bar chart. `data` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- ""dealCard"": { ""props"": { ""title"": string, ""stage"": string, ""value"": number } }
    A single sales deal. `stage` MUST be one of: ""prospect"", ""qualified"",
    ""proposal"", ""negotiation"", ""closed-won"", ""closed-lost"". `value` is a
    raw number (no currency symbol or comma).

- ""Markdown"": { ""props"": { ""children"": string } }
    Short explanatory text. Use for section headings and brief summaries.
    Standard markdown is supported in `children`.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use ""Markdown"" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- `data` props on charts MUST be a JSON STRING — escape inner quotes.

Example response (sales dashboard):
{""ui"":[{""Markdown"":{""props"":{""children"":""## Q4 Sales Summary""}}},{""metric"":{""props"":{""label"":""Total Revenue"",""value"":""$1.2M""}}},{""metric"":{""props"":{""label"":""New Customers"",""value"":""248""}}},{""pieChart"":{""props"":{""title"":""Revenue by Segment"",""data"":""[{\""label\"":\""Enterprise\"",\""value\"":600000},{\""label\"":\""SMB\"",\""value\"":400000},{\""label\"":\""Startup\"",\""value\"":200000}]""}}},{""barChart"":{""props"":{""title"":""Monthly Revenue"",""data"":""[{\""label\"":\""Oct\"",\""value\"":350000},{\""label\"":\""Nov\"",\""value\"":400000},{\""label\"":\""Dec\"",\""value\"":450000}]""}}}]}";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;

    public ByocHashbrownAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _logger = loggerFactory.CreateLogger<ByocHashbrownAgentFactory>();

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpoint = Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? DefaultOpenAiEndpoint;
        _logger.LogInformation("ByocHashbrownAgent using OpenAI endpoint: {Endpoint}", endpoint);

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent CreateAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // `description` on ChatClientAgent is passed to the chat client as the
        // system-instruction equivalent, so it steers the model to emit a
        // single <ui>...</ui> envelope for every response.
        return new ChatClientAgent(
            chatClient,
            name: "ByocHashbrownAgent",
            description: SystemPrompt);
    }
}
