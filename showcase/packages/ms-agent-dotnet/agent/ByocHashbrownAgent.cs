using System.ClientModel;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

/// <summary>
/// Factory for the byoc-hashbrown demo agent.
///
/// This agent emits a hashbrown-shaped `<ui>...</ui>` envelope that the
/// frontend renderer (`src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx`)
/// progressively parses via `@hashbrownai/react`'s `useJsonParser` + `useUiKit`.
///
/// Mirrors `src/agents/byoc_hashbrown_agent.py` in the langgraph-python
/// showcase — same system prompt, same component catalog.
/// </summary>
public class ByocHashbrownAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private const string SystemPrompt = @"You are a sales analytics assistant that replies by emitting a structured UI
markup consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single <ui>...</ui> root containing ONLY the following
components. Do NOT wrap the response in code fences. Do NOT include any
preface or explanation outside the <ui> root.

Available components:

- <Markdown children=""..."" />
    Short explanatory text. Use for section headings and brief summaries.

- <metric label=""..."" value=""..."" trend=""..."" />
    A KPI card. `label` and `value` are required. `trend` is a short
    string like ""+12% vs Q3"" or ""-4% MoM"" — include it when you have a
    meaningful comparison, omit it otherwise.

- <pieChart title=""..."" data='[{""label"":""..."",""value"":N},...]' />
    A donut chart. `data` is a JSON string of {label, value} objects with
    at least 3 segments. Omit the attribute if you have no values.

- <barChart title=""..."" data='[{""label"":""..."",""value"":N},...]' />
    A vertical bar chart. `data` is a JSON string of {label, value} objects
    with at least 3 bars, typically time-ordered.

- <dealCard title=""..."" stage=""..."" value=""NUMBER"" assignee=""..."" dueDate=""..."" />
    A single sales deal. `stage` must be one of: prospect, qualified,
    proposal, negotiation, closed-won, closed-lost. `value` is a dollar
    amount with no symbol or comma (e.g. value=""250000"").

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use <Markdown> children for short headings or linking sentences between
  visual components. Do not emit long prose.
- Do not emit components that are not listed above.

Example (sales dashboard):
<ui>
  <Markdown children=""## Q4 Sales Summary"" />
  <metric label=""Total Revenue"" value=""$1.2M"" trend=""+12% vs Q3"" />
  <metric label=""New Customers"" value=""248"" trend=""+18% QoQ"" />
  <pieChart title=""Revenue by Segment"" data='[{""label"":""Enterprise"",""value"":600000},{""label"":""SMB"",""value"":400000},{""label"":""Startup"",""value"":200000}]' />
  <barChart title=""Monthly Revenue"" data='[{""label"":""Oct"",""value"":350000},{""label"":""Nov"",""value"":400000},{""label"":""Dec"",""value"":450000}]' />
</ui>";

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
