using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

// MCP Apps agent.
//
// This agent has no bespoke tools — the CopilotKit runtime is wired with
// `mcpApps: { servers: [...] }` (see `src/app/api/copilotkit-mcp-apps/route.ts`)
// pointing at a public MCP server (default: Excalidraw). The runtime
// auto-applies the MCP Apps middleware which exposes the remote MCP
// server's tools to this agent at request time and emits the activity
// events that CopilotKit's built-in `MCPAppsActivityRenderer` renders in
// the chat as a sandboxed iframe.
//
// Reference parity with:
// showcase/integrations/langgraph-python/src/agents/mcp_apps_agent.py
public sealed class McpAppsAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string SystemPrompt =
        "You draw simple diagrams in Excalidraw via the MCP tool.\n\n" +
        "SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize " +
        "for polish. Target: one tool call, done in seconds.\n\n" +
        "When the user asks for a diagram:\n" +
        "1. Call `create_view` ONCE with 3-5 elements total: shapes + arrows + " +
        "   an optional title text.\n" +
        "2. Use straightforward shapes (rectangle, ellipse, diamond) with plain " +
        "   `label` fields (`{\"text\": \"...\", \"fontSize\": 18}`) on them.\n" +
        "3. Connect with arrows. Endpoints can be element centers or simple " +
        "   coordinates — you don't need edge anchors / fixedPoint bindings.\n" +
        "4. Include ONE `cameraUpdate` at the END of the elements array that " +
        "   frames the whole diagram. Use an approved 4:3 size (600x450 or " +
        "   800x600). No opening camera needed.\n" +
        "5. Reply with ONE short sentence describing what you drew.\n\n" +
        "Every element needs a unique string `id` (e.g. \"b1\", \"a1\", \"title\"). " +
        "Standard sizes: rectangles 160x70, ellipses/diamonds 120x80, 40-80px " +
        "gap between shapes.\n\n" +
        "Do NOT:\n" +
        "- Call `read_me`. You already know the basic shape API.\n" +
        "- Make multiple `create_view` calls.\n" +
        "- Iterate or refine. Ship on the first shot.\n" +
        "- Add decorative colors / fills / zone backgrounds unless the user " +
        "  explicitly asks for them.\n" +
        "- Add labels on arrows unless crucial.\n\n" +
        "If the user asks for something specific (colors, more elements, " +
        "particular layout), follow their lead — but still in ONE call.";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;

    public McpAppsAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _logger = loggerFactory.CreateLogger<McpAppsAgentFactory>();

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
        var endpoint = endpointEnv ?? DefaultOpenAiEndpoint;

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent CreateMcpAppsAgent()
    {
        // gpt-4o-mini for speed — Excalidraw element emission is simple JSON
        // and we bias hard toward sub-30s generation.
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "McpAppsAgent",
            description: SystemPrompt,
            tools: []);
    }
}
