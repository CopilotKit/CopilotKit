// @region[backend-interrupt-tool]
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

// =================
// Interrupt Agent Factory  (NOT-SUPPORTED — wired for column parity)
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
//
// gen-ui-interrupt and interrupt-headless both route to the single
// /interrupt-adapted backend mounted in Program.cs. Both are marked
// not_supported in manifest.yaml (skipped-incapable) pending a
// @copilotkit/react-core resume-path fix — the route stays wired so the
// harness column is 1:1 with the Framework column.
//
// Harness column: the inner ChatClientAgent is built through the
// `chatClient.AsHarnessAgent(...)` wrapper (Microsoft Agent Harness over
// Microsoft Agent Framework) and the credential comes from the single shared
// `OpenAIClient` threaded in from Program.cs (built via the harness
// ApiKeyResolver) — no per-feature GitHubToken dance. See the W0 contract §1.
// The SharedStateAgent wrapper round-trips JsonElement through
// JsonSerializerOptions.GetTypeInfo(typeof(JsonElement)), so the app's shared
// JsonSerializerOptions (which retains ASP.NET's DefaultJsonTypeInfoResolver in
// its TypeInfoResolverChain alongside the source-generated contexts) is threaded
// in from Program.cs — matching the Framework column. A bare
// `new JsonSerializerOptions(JsonSerializerDefaults.Web)` has NO TypeInfoResolver
// and makes SharedStateAgent's ctor fail fast at startup.
public sealed class InterruptAgentFactory
{
    private const int HarnessMaxContextWindowTokens = 128_000;
    private const int HarnessMaxOutputTokens = 8_192;

    private const string SystemPrompt = @"You are a scheduling assistant. Whenever the user asks you to book a call
or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a short `topic`
describing the purpose and `attendee` describing who the meeting is with. After the tool
returns, confirm briefly whether the meeting was scheduled and at what time, or that the
user cancelled.";

    private readonly IConfiguration _configuration;
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly ILoggerFactory _loggerFactory;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public InterruptAgentFactory(IConfiguration configuration, OpenAIClient openAiClient, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(openAiClient);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _configuration = configuration;
        _openAiClient = openAiClient;
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<InterruptAgentFactory>();

        // The SharedStateAgent wrapper round-trips JsonElement through
        // JsonSerializerOptions.GetTypeInfo(typeof(JsonElement)) and emits a
        // SalesStateSnapshot JSON schema. Use the app's shared serializer options
        // (resolver-equipped: DefaultJsonTypeInfoResolver + source-gen contexts)
        // threaded from Program.cs so the JsonElement round-trip resolves.
        _jsonSerializerOptions = jsonSerializerOptions;
    }

    // @region[backend-tool-call]
    public AIAgent CreateInterruptAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // No backend fallback tool is registered. If the frontend tool is
        // missing, the demo should fail visibly instead of bypassing the
        // picker with a server-side response.
        var harnessAgent = chatClient.AsHarnessAgent(
            HarnessMaxContextWindowTokens,
            HarnessMaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = "InterruptAgent",
                Description = "Interrupt scheduling assistant (NOT-SUPPORTED) powered by Microsoft Agent Harness over Microsoft Agent Framework.",
                ChatOptions = new ChatOptions
                {
                    Instructions = SystemPrompt,
                    MaxOutputTokens = HarnessMaxOutputTokens,
                    Tools = [],
                },
            });

        return new SharedStateAgent(harnessAgent, _jsonSerializerOptions, _loggerFactory.CreateLogger<SharedStateAgent>());
    }
    // @endregion[backend-tool-call]
}
// @endregion[backend-interrupt-tool]
