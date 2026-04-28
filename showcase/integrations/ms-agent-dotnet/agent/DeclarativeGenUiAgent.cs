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
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public DeclarativeGenUiAgent(IConfiguration configuration, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _logger = loggerFactory.CreateLogger<DeclarativeGenUiAgent>();
        _jsonSerializerOptions = jsonSerializerOptions;

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

    public AIAgent Create()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "DeclarativeGenUiAgent",
            description: @"You are an assistant that helps the user visualise information with dynamic UI.
Whenever the user asks for a dashboard, chart, status report, or any rich visual output,
ALWAYS call the `generate_a2ui` tool with a short natural-language description of what
should be rendered. Keep any textual reply to one short sentence — the UI speaks for itself.",
            tools: [
                AIFunctionFactory.Create(GenerateA2ui, options: new() { Name = "generate_a2ui", SerializerOptions = _jsonSerializerOptions })
            ]);
    }

    [Description("Generate dynamic A2UI components using a secondary LLM call")]
    private async Task<string> GenerateA2ui(
        [Description("The user's request describing what UI to generate")] string userRequest,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userRequest);

        var errorId = Guid.NewGuid().ToString("n")[..16];
        _logger.LogInformation("DeclarativeGenUi: Generating A2UI (errorId={ErrorId}) for: {Request}", errorId, userRequest);

        var secondaryChatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        var systemPrompt = @"You are a UI generator. Given a user request, generate A2UI v0.9 components.
You MUST respond with ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  ""surfaceId"": ""dynamic-surface"",
  ""catalogId"": ""declarative-gen-ui-catalog"",
  ""components"": [<A2UI v0.9 component array>],
  ""data"": {<optional initial data>}
}
The root component must have id ""root"".
Available components: Row, Column, Text, Card, Button, Badge, Table, Chart, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, BarChart.";

        var messages = new List<ChatMessage>
        {
            new(ChatRole.System, systemPrompt),
            new(ChatRole.User, userRequest),
        };

        string? content;
        try
        {
            var result = await secondaryChatClient.GetResponseAsync(messages, cancellationToken: cancellationToken).ConfigureAwait(false);
            content = result.Text;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream transport failure", errorId);
            return SalesAgentFactory.StructuredError("upstream_unavailable", "The upstream AI service is currently unreachable. Please retry.", "Retry the request in a few seconds.", errorId);
        }
        catch (ClientResultException ex)
        {
            _logger.LogError(ex, "DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream returned error status {Status}", errorId, ex.Status);
            return SalesAgentFactory.StructuredError("upstream_error", "The upstream AI service returned an error.", "Try rephrasing the request or retrying later.", errorId);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): cancelled", errorId);
            throw;
        }

        if (string.IsNullOrEmpty(content))
        {
            _logger.LogError("DeclarativeGenUi GenerateA2ui (errorId={ErrorId}): upstream returned no text content", errorId);
            return SalesAgentFactory.StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        return SalesAgentFactory.BuildA2uiResponseFromContent(content, errorId, _logger);
    }
}
