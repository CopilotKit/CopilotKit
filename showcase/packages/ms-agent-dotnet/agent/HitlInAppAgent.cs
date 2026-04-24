using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

// In-App HITL (frontend-tool + popup modal) agent.
//
// The agent is a support-ops copilot. Any action that materially affects
// a customer MUST be confirmed by the operator via the frontend-provided
// `request_user_approval` tool (registered via `useFrontendTool` on the
// page). The tool handler opens a modal OUTSIDE the chat surface and
// returns `{ approved: boolean, reason?: string }` back to the agent.
//
// This agent owns NO server-side tools — the approval tool lives on the
// frontend. The system prompt tells the model to invoke it whenever a
// customer-affecting action is requested.
//
// Reference parity with:
// showcase/packages/langgraph-python/src/agents/hitl_in_app.py
public sealed class HitlInAppAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string SystemPrompt =
        "You are a support operations copilot working alongside a human operator " +
        "inside an internal support console. The operator can see a list of open " +
        "support tickets on the left side of their screen and is chatting with " +
        "you on the right.\n\n" +
        "Whenever the operator asks you to take an action that affects a " +
        "customer — for example: issuing a refund, updating a customer's plan, " +
        "cancelling a subscription, escalating a ticket, or sending an apology " +
        "credit — you MUST first call the frontend-provided " +
        "`request_user_approval` tool to obtain the operator's explicit consent.\n\n" +
        "How to use `request_user_approval`:\n" +
        "- `message`: a short, plain-English summary of the exact action you " +
        "  are about to take, including concrete numbers (e.g. '$50 refund to " +
        "  customer #12345').\n" +
        "- `context`: optional extra context the operator might want to review " +
        "  (the ticket ID, the policy rule you're applying, etc.). Keep it to " +
        "  one or two short sentences.\n\n" +
        "The tool returns an object of the shape " +
        "`{\"approved\": boolean, \"reason\": string | null}`.\n" +
        "- If `approved` is `true`: confirm in one short sentence that you are " +
        "  processing the action. You do not actually need to call any other " +
        "  tool — this is a demo. Just acknowledge.\n" +
        "- If `approved` is `false`: acknowledge the rejection in one short " +
        "  sentence and, if `reason` is non-empty, reflect the operator's " +
        "  reason back to them. Do NOT retry the action.\n\n" +
        "Keep all chat replies to one or two short sentences. Never make up " +
        "customer data — always use whatever the operator told you in the " +
        "prompt.";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;

    public HitlInAppAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        _logger = loggerFactory.CreateLogger<HitlInAppAgentFactory>();

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

    public AIAgent CreateHitlInAppAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "HitlInAppAgent",
            description: SystemPrompt,
            tools: []);
    }
}
