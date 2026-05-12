using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

// In-Chat HITL (useHumanInTheLoop — ergonomic API) agent.
//
// The `book_call` tool is defined entirely on the frontend via the
// `useHumanInTheLoop` hook (see src/app/demos/hitl-in-chat/page.tsx).
// The .NET agent owns no tools — it just has a system prompt that nudges
// the model to call the frontend-provided tool when the user asks to book
// a call. The picker UI is rendered inline in the chat by the hook's
// `render` callback, and the user's choice is returned to the agent as the
// tool result.
//
// Reference parity with:
// showcase/integrations/langgraph-python/src/agents/hitl_in_chat_agent.py
public sealed class HitlInChatAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string SystemPrompt =
        "You help users book an onboarding call with the sales team. " +
        "When they ask to book a call, call the frontend-provided " +
        "`book_call` tool with a short topic and the user's name. " +
        "Keep any chat reply to one short sentence.";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;

    public HitlInChatAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _logger = loggerFactory.CreateLogger<HitlInChatAgentFactory>();

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
        var endpoint = endpointEnv ?? DefaultOpenAiEndpoint;

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            AimockHeaderPolicy.CreateOpenAIClientOptions(endpoint));
    }

    public AIAgent CreateHitlInChatAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "HitlInChatAgent",
            description: SystemPrompt,
            tools: []);
    }
}
