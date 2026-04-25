using System.ClientModel;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

/// <summary>
/// Factory for the byoc-json-render demo agent.
///
/// Emits a single JSON object shaped like `@json-render/react`'s flat spec
/// format (`{ root, elements }`) so the frontend can feed it directly into
/// `<Renderer />` against a Zod-validated catalog of three components —
/// MetricCard, BarChart, PieChart.
///
/// Mirrors `src/agents/byoc_json_render_agent.py` in the langgraph-python
/// showcase — same system prompt, same component catalog.
/// </summary>
public class ByocJsonRenderAgentFactory
{
    private const string SystemPrompt = @"You are a sales-dashboard UI generator for a BYOC json-render demo.

When the user asks for a UI, respond with **exactly one JSON object** and
nothing else — no prose, no markdown fences, no leading explanation. The
object must match this schema (the ""flat element map"" format consumed by
`@json-render/react`):

{
  ""root"": ""<id of the root element>"",
  ""elements"": {
    ""<id>"": {
      ""type"": ""<component name>"",
      ""props"": { ... component-specific props ... },
      ""children"": [ ""<id>"", ... ]
    },
    ...
  }
}

Available components (use each name verbatim as ""type""):

- MetricCard
  props: { ""label"": string, ""value"": string, ""trend"": string | null }
  Example trend strings: ""+12% vs last quarter"", ""-3% vs last month"", null.

- BarChart
  props: {
    ""title"": string,
    ""description"": string | null,
    ""data"": [ { ""label"": string, ""value"": number }, ... ]
  }

- PieChart
  props: {
    ""title"": string,
    ""description"": string | null,
    ""data"": [ { ""label"": string, ""value"": number }, ... ]
  }

Rules:

1. Output **only** valid JSON. No markdown code fences. No text outside
   the object.
2. Every id referenced in `root` or any `children` array must be a key
   in `elements`.
3. For a multi-component dashboard, use a root MetricCard and list the
   charts in its `children` array, OR pick any element as root and list
   the others as its children. Do not emit orphan elements.
4. Use realistic sales-domain values (revenue, pipeline, conversion,
   categories, months) — the demo is a sales dashboard.
5. `children` is optional but when present must be an array of strings.
6. Never invent component types outside the three listed above.

### Worked example — ""Show me the sales dashboard with metrics and a revenue chart""

{
  ""root"": ""revenue-metric"",
  ""elements"": {
    ""revenue-metric"": {
      ""type"": ""MetricCard"",
      ""props"": {
        ""label"": ""Revenue (Q3)"",
        ""value"": ""$1.24M"",
        ""trend"": ""+18% vs Q2""
      },
      ""children"": [""revenue-bar""]
    },
    ""revenue-bar"": {
      ""type"": ""BarChart"",
      ""props"": {
        ""title"": ""Monthly revenue"",
        ""description"": ""Revenue by month across Q3"",
        ""data"": [
          { ""label"": ""Jul"", ""value"": 380000 },
          { ""label"": ""Aug"", ""value"": 410000 },
          { ""label"": ""Sep"", ""value"": 450000 }
        ]
      }
    }
  }
}

### Worked example — ""Break down revenue by category as a pie chart""

{
  ""root"": ""category-pie"",
  ""elements"": {
    ""category-pie"": {
      ""type"": ""PieChart"",
      ""props"": {
        ""title"": ""Revenue by category"",
        ""description"": ""Share of total revenue by product category"",
        ""data"": [
          { ""label"": ""Enterprise"", ""value"": 540000 },
          { ""label"": ""SMB"", ""value"": 310000 },
          { ""label"": ""Self-serve"", ""value"": 220000 },
          { ""label"": ""Partner"", ""value"": 170000 }
        ]
      }
    }
  }
}

### Worked example — ""Show me monthly expenses as a bar chart""

{
  ""root"": ""expense-bar"",
  ""elements"": {
    ""expense-bar"": {
      ""type"": ""BarChart"",
      ""props"": {
        ""title"": ""Monthly expenses"",
        ""description"": ""Operating expenses by month"",
        ""data"": [
          { ""label"": ""Jul"", ""value"": 210000 },
          { ""label"": ""Aug"", ""value"": 225000 },
          { ""label"": ""Sep"", ""value"": 240000 }
        ]
      }
    }
  }
}

Respond with the JSON object only.";

    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;

    public ByocJsonRenderAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _logger = loggerFactory.CreateLogger<ByocJsonRenderAgentFactory>();

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpoint = Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? DefaultOpenAiEndpoint;
        _logger.LogInformation("ByocJsonRenderAgent using OpenAI endpoint: {Endpoint}", endpoint);

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

        // The frontend json-render-renderer.tsx buffers until the assistant
        // content parses as a complete JSON object, then renders. The agent
        // is steered to emit a single JSON object per reply by the
        // SystemPrompt above.
        return new ChatClientAgent(
            chatClient,
            name: "ByocJsonRenderAgent",
            description: SystemPrompt);
    }
}
