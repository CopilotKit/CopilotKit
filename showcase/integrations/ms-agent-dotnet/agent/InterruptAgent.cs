// @region[backend-interrupt-tool]
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

// =================
// Interrupt Agent Factory
// =================
//
// Adaptation note: the Microsoft Agent Framework (.NET) does not have a
// LangGraph-equivalent `interrupt()` primitive that can pause execution
// mid-tool and resume with a caller-supplied value. The scheduling demos
// use a frontend-provided `schedule_meeting` tool; AG-UI forwards that tool
// definition to the model, then the client renders the picker and resolves
// the tool call with the user's selected slot.
//
// This factory reuses the existing SharedStateAgent pattern for
// consistency with the rest of the showcase, even though state-sync isn't
// the primary concern for interrupt demos. The agent's system prompt
// instructs it to always call `schedule_meeting` whenever the user asks
// to book a call or schedule a meeting.
public sealed class InterruptAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly IConfiguration _configuration;
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public InterruptAgentFactory(IConfiguration configuration, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        _configuration = configuration;
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<InterruptAgentFactory>();
        _jsonSerializerOptions = jsonSerializerOptions;

        var githubToken = _configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
        var endpoint = endpointEnv ?? DefaultOpenAiEndpoint;
        _logger.LogInformation(
            "InterruptAgentFactory using OpenAI endpoint: {Endpoint} (from OPENAI_BASE_URL: {HasEnv})",
            endpoint,
            !string.IsNullOrEmpty(endpointEnv));

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            AimockHeaderPolicy.CreateOpenAIClientOptions(endpoint));
    }

    // @region[backend-tool-call]
    public AIAgent CreateInterruptAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // No backend fallback tool is registered. If the frontend tool is
        // missing, the demo should fail visibly instead of bypassing the
        // picker with a server-side response.
        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "InterruptAgent",
            description: @"You are a scheduling assistant. Whenever the user asks you to book a call
or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a short `topic`
describing the purpose and `attendee` describing who the meeting is with. After the tool
returns, confirm briefly whether the meeting was scheduled and at what time, or that the
user cancelled.",
            tools: []);

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions, _loggerFactory.CreateLogger<SharedStateAgent>());
    }
    // @endregion[backend-tool-call]

}
// @endregion[backend-interrupt-tool]
