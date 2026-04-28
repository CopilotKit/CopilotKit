using System.ComponentModel;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

// =================
// Interrupt Agent Factory
// =================
//
// Adaptation note — the Microsoft Agent Framework (.NET) does NOT have a
// LangGraph-equivalent `interrupt()` primitive that can pause execution
// mid-tool and resume with a caller-supplied value. We simulate the same
// end-user experience via an approval-mode shim: the `schedule_meeting`
// tool is declared as a backend tool that describes what it needs, but the
// actual "picker" UI and the user decision live on the frontend via
// `useFrontendTool` with an async handler. The frontend-registered tool
// definition is forwarded to the backend through AG-UI's tool-catalog
// mechanism, so when the model calls `schedule_meeting` the request is
// handled on the client and resolves with the user's picked slot (or
// cancellation). Visually this matches the LangGraph demos — the backend
// mechanism differs.
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
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent CreateInterruptAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // Backend-declared `schedule_meeting` tool. This is a FALLBACK
        // implementation: if the frontend has not registered its own
        // `schedule_meeting` via `useFrontendTool`, this backend tool runs
        // and returns a generic "unscheduled" message. When the frontend
        // has the tool registered (the intended demo path), AG-UI forwards
        // the frontend tool definition and the client handles the call —
        // this backend tool acts only as a schema hint for the model when
        // the frontend tool isn't yet available.
        //
        // The parameters intentionally mirror the LangGraph reference's
        // `schedule_meeting(topic, attendee)` signature so the model's
        // behavior is identical across backends.
        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "InterruptAgent",
            description: @"You are a scheduling assistant. Whenever the user asks you to book a call
or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a short `topic`
describing the purpose and `attendee` describing who the meeting is with. After the tool
returns, confirm briefly whether the meeting was scheduled and at what time, or that the
user cancelled.",
            tools: [
                AIFunctionFactory.Create(
                    ScheduleMeeting,
                    options: new() { Name = "schedule_meeting", SerializerOptions = _jsonSerializerOptions }),
            ]);

        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions, _loggerFactory.CreateLogger<SharedStateAgent>());
    }

    // =================
    // Tools
    // =================

    [Description("Ask the user to pick a time slot for a call via an in-app picker. The frontend renders the picker and returns the user's choice or a cancellation.")]
    private string ScheduleMeeting(
        [Description("Short human-readable description of the call's purpose.")] string topic,
        [Description("Who the call is with (optional).")] string? attendee = null)
    {
        // This backend implementation runs only when the frontend has not
        // registered an override via `useFrontendTool`. The intended demo
        // path is frontend-handled; see the comment on the factory.
        _logger.LogInformation(
            "ScheduleMeeting (backend fallback) called with topic={Topic}, attendee={Attendee}",
            topic,
            attendee ?? "(none)");

        return JsonSerializer.Serialize(new
        {
            status = "pending_frontend_picker",
            topic,
            attendee,
            message = "A time picker will appear in the UI. Please choose a slot or cancel.",
        });
    }
}
