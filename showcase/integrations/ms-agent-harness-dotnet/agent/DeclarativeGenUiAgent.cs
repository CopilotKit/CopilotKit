using System.ClientModel;
using System.ComponentModel;
using System.Net.Http;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;

/// <summary>
/// Factory for the Declarative Generative UI (A2UI — Dynamic Schema) agent.
///
/// Mirrors the LangGraph `src/agents/a2ui_dynamic.py` reference: the agent
/// owns a single `generate_a2ui` tool that delegates to a secondary LLM call
/// which produces an A2UI v0.9 component tree against the frontend catalog
/// (declared on the provider via `a2ui={{ catalog: myCatalog }}`). The
/// runtime's A2UI middleware serialises that catalog schema into the agent's
/// <c>copilotkit.context</c> so the secondary LLM knows which components are
/// available.
/// </summary>
public class DeclarativeGenUiAgent
{
    private const int HarnessMaxContextWindowTokens = 128_000;
    private const int HarnessMaxOutputTokens = 8_192;

    private const string Instructions = @"You are an assistant that helps the user visualise information with dynamic UI.
Whenever the user asks for a dashboard, chart, status report, or any rich visual output,
ALWAYS call the `generate_a2ui` tool with a short natural-language description of what
should be rendered. Keep any textual reply to one short sentence — the UI speaks for itself.";

    private readonly IConfiguration _configuration;
    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public DeclarativeGenUiAgent(
        IConfiguration configuration,
        OpenAIClient openAiClient,
        ILoggerFactory loggerFactory,
        JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(openAiClient);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _configuration = configuration;
        _openAiClient = openAiClient;
        _logger = loggerFactory.CreateLogger<DeclarativeGenUiAgent>();
        _jsonSerializerOptions = jsonSerializerOptions;
    }

    public AIAgent Create()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return chatClient.AsHarnessAgent(
            HarnessMaxContextWindowTokens,
            HarnessMaxOutputTokens,
            new HarnessAgentOptions
            {
                Name = "DeclarativeGenUiAgent",
                Description = "Declarative Generative UI (A2UI dynamic schema) powered by Microsoft Agent Harness over Microsoft Agent Framework.",
                ChatOptions = new ChatOptions
                {
                    Instructions = Instructions,
                    MaxOutputTokens = HarnessMaxOutputTokens,
                    Tools =
                    [
                        AIFunctionFactory.Create(GenerateA2ui, options: new() { Name = "generate_a2ui", SerializerOptions = _jsonSerializerOptions }),
                    ],
                },
            });
    }

    [Description("Generate dynamic A2UI components using a secondary LLM call")]
    private async Task<object> GenerateA2ui(
        [Description("Conversation context to generate UI from.")] string context = "",
        CancellationToken cancellationToken = default)
    {
        context ??= "";

        var errorId = Guid.NewGuid().ToString("n")[..16];
        var userContent = string.IsNullOrWhiteSpace(context)
            ? "KPI dashboard with 3-4 metrics, pie chart sales by region, bar chart quarterly revenue, status report."
            : context;
        _logger.LogInformation("DeclarativeGenUi: Generating A2UI (errorId={ErrorId}) for: {Request}", errorId, userContent);

        string? content;
        try
        {
            content = await A2uiSecondaryToolCaller.GetDesignToolArgumentsAsync(
                _configuration,
                "Generate a useful dashboard UI. Use catalogId='declarative-gen-ui-catalog'.",
                userContent,
                _logger,
                cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream transport failure", errorId);
            return BeautifulChatA2ui.StructuredError("upstream_unavailable", "The upstream AI service is currently unreachable. Please retry.", "Retry the request in a few seconds.", errorId);
        }
        catch (ClientResultException ex)
        {
            _logger.LogError(ex, "DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream returned error status {Status}", errorId, ex.Status);
            return BeautifulChatA2ui.StructuredError("upstream_error", "The upstream AI service returned an error.", "Try rephrasing the request or retrying later.", errorId);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): cancelled", errorId);
            throw;
        }

        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream returned no text content", errorId);
            return BeautifulChatA2ui.StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        return BeautifulChatA2ui.BuildA2uiResponseFromContent(content, errorId, _logger);
    }
}
