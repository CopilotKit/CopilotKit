using System.ClientModel;
using System.Net.Http;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using OpenAI;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    // Beautiful-chat types (shipped) + the full-column Sales/Flight/parity types
    // ported by the family slots. Both source-generated contexts are chained so
    // every feature agent's tool I/O serializes through the fast path.
    options.SerializerOptions.TypeInfoResolverChain.Add(BeautifulChatSerializerContext.Default);
    options.SerializerOptions.TypeInfoResolverChain.Add(SalesAgentSerializerContext.Default);
    // Serialize enum types as their member-name strings rather than numeric
    // ordinals (matches the Framework column's wire format).
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.AddAGUI();
// STOPGAP: IHttpContextAccessor lets AimockHeaderPolicy read the current
// request's forwarded x-* headers (stashed on HttpContext.Items by
// AimockHeaderMiddleware) at outbound-LLM-call time. HttpContext flows across
// the AG-UI SSE-pump ExecutionContext boundary, unlike a middleware-set
// AsyncLocal. TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation.
builder.Services.AddHttpContextAccessor();

var app = builder.Build();

// STOPGAP: seed the static accessor the outbound header-forwarding policy reads
// (the policy is created without DI, mirroring CvDiag.Logger).
AimockHeaderPolicy.HttpContextAccessor = app.Services.GetRequiredService<IHttpContextAccessor>();

// Forward D5/aimock x-* headers from incoming AG-UI requests to outgoing
// OpenAI calls until the .NET SDK owns this propagation centrally.
app.UseMiddleware<AimockHeaderMiddleware>();

// CVDIAG: backend flap-observability emitter (plan unit L1-F; spec §3). OFF by
// default (CVDIAG_BACKEND_EMITTER=on to arm). Seed the static singleton the
// outbound LLM policy reads (created without DI), then register the
// request-pipeline instrumentation AFTER AimockHeaderMiddleware so the forwarded
// x-* correlation headers are already captured for this request.
CvdiagBackend.Instance = new CvdiagBackend();
app.UseMiddleware<CvdiagInstrumentationMiddleware>();

var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
// CVDIAG: seed the static logger used by AimockHeaderPolicy (created without DI)
// to emit the outbound-LLM header-forwarding breadcrumb.
CvDiag.Logger = loggerFactory.CreateLogger("CvDiag");
var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>().Value.SerializerOptions;

// Single shared OpenAIClient for the whole column. Built once via the harness
// ApiKeyResolver (env OPENAI_API_KEY -> config OPENAI_API_KEY -> GitHubToken,
// fail-fast for non-mock endpoints) so EVERY feature agent hits the same
// upstream with the same credential resolution — no per-feature GitHubToken
// dance. Threaded into each feature factory's ctor. See the W0 contract §1.
var openAiClient = CreateOpenAiClient(builder.Configuration, loggerFactory.CreateLogger("Program"));

// ── Root agentic-chat agent (the Sales pipeline agent) ──────────────────────
// agentic-chat, chat-slots, chat-customization-css, prebuilt-{sidebar,popup},
// frontend-tools{,-async}, headless-simple, shared-state-read, and the two
// tool-rendering catch-all demos all proxy to this root agent via the shared
// Next.js `copilotkit/` runtime route.
var salesFactory = new SalesAgentFactory(builder.Configuration, openAiClient, jsonOptions, loggerFactory);
app.MapAGUI("/", salesFactory.CreateSalesAgent());

// ── D5 parity agents (one factory hosts the parity-feature surface) ─────────
var d5ParityFactory = new D5ParityAgentFactory(openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/headless-complete", d5ParityFactory.CreateHeadlessCompleteAgent());
app.MapAGUI("/voice", d5ParityFactory.CreateVoiceAgent());
app.MapAGUI("/gen-ui-agent", d5ParityFactory.CreateGenUiAgent());
app.MapAGUI("/gen-ui-tool-based", d5ParityFactory.CreateGenUiToolBasedAgent());
app.MapAGUI("/shared-state-streaming", d5ParityFactory.CreateSharedStateStreamingAgent());
app.MapAGUI("/readonly-state-agent-context", d5ParityFactory.CreateReadonlyStateAgentContext());
app.MapAGUI("/tool-rendering", d5ParityFactory.CreateToolRenderingAgent(reasoning: false));
app.MapAGUI("/tool-rendering-reasoning-chain", d5ParityFactory.CreateToolRenderingAgent(reasoning: true));

// ── Interrupt agent (NOT-SUPPORTED, wired for parity) ───────────────────────
// gen-ui-interrupt and interrupt-headless share this single backend; the
// differentiation is on the frontend (in-chat picker vs. headless button grid).
// Marked not_supported in manifest.yaml (skipped-incapable) pending a
// @copilotkit/react-core resume-path fix — wired here so the column is 1:1.
var interruptFactory = new InterruptAgentFactory(builder.Configuration, openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/interrupt-adapted", interruptFactory.CreateInterruptAgent());

// ── Multimodal (raw MapPost — the AG-UI adapter rejects content arrays) ─────
// Parses the request body directly and emits the small AG-UI SSE event subset
// the chat UI needs for text streaming over a vision-capable chat client.
app.MapPost("/multimodal", (HttpContext context) => MultimodalEndpoint.HandleAsync(
    context,
    salesFactory.CreateMultimodalChatClient(),
    loggerFactory.CreateLogger("MultimodalEndpoint")));

// ── Beautiful Chat flagship demo (shipped) ──────────────────────────────────
var beautifulChatFactory = new BeautifulChatAgentFactory(
    builder.Configuration,
    openAiClient,
    jsonOptions,
    loggerFactory.CreateLogger<BeautifulChatAgentFactory>());
app.MapAGUI("/beautiful-chat", beautifulChatFactory.Create());

// ── Agent Config (wraps a neutral inner agent in AgentConfigAgent) ──────────
app.MapAGUI("/agent-config", salesFactory.CreateAgentConfigAgent());

// ── Reasoning (reasoning-default + reasoning-custom share this backend) ─────
app.MapAGUI("/reasoning", salesFactory.CreateReasoningAgent());

// ── Declarative Gen UI (A2UI canonical BYOC) ────────────────────────────────
var declarativeGenUiAgent = new DeclarativeGenUiAgent(builder.Configuration, openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/declarative-gen-ui", declarativeGenUiAgent.Create());

// ── A2UI fixed-schema demo ──────────────────────────────────────────────────
var a2uiFixedSchemaAgent = new A2uiFixedSchemaAgent(builder.Configuration, openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/a2ui-fixed-schema", a2uiFixedSchemaAgent.Create());

// ── Open Generative UI — basic + advanced ───────────────────────────────────
var openGenUiFactory = new OpenGenUiAgentFactory(openAiClient);
app.MapAGUI("/open-gen-ui", openGenUiFactory.CreateAgent());
var openGenUiAdvancedFactory = new OpenGenUiAdvancedAgentFactory(openAiClient);
app.MapAGUI("/open-gen-ui-advanced", openGenUiAdvancedFactory.CreateAgent());

// ── BYOC demos (hashbrown + json-render) ────────────────────────────────────
var byocHashbrownFactory = new ByocHashbrownAgentFactory(openAiClient, loggerFactory);
app.MapAGUI("/byoc-hashbrown", byocHashbrownFactory.CreateAgent());
var byocJsonRenderFactory = new ByocJsonRenderAgentFactory(openAiClient, loggerFactory);
app.MapAGUI("/byoc-json-render", byocJsonRenderFactory.CreateAgent());

// ── MCP Apps demo ───────────────────────────────────────────────────────────
var mcpAppsFactory = new McpAppsAgentFactory(openAiClient, loggerFactory);
app.MapAGUI("/mcp-apps", mcpAppsFactory.CreateMcpAppsAgent());

// ── In-app HITL demo (frontend tools + async HITL) ──────────────────────────
var hitlInAppFactory = new HitlInAppAgentFactory(openAiClient, loggerFactory);
app.MapAGUI("/hitl-in-app", hitlInAppFactory.CreateHitlInAppAgent());

// ── In-chat HITL demo (useHumanInTheLoop) ───────────────────────────────────
var hitlInChatFactory = new HitlInChatAgentFactory(openAiClient, loggerFactory);
app.MapAGUI("/hitl-in-chat", hitlInChatFactory.CreateHitlInChatAgent());

// ── Shared State (Read + Write) demo ────────────────────────────────────────
var sharedStateReadWriteFactory = new SharedStateReadWriteAgentFactory(openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/shared-state-read-write", sharedStateReadWriteFactory.CreateAgent());

// ── Sub-Agents demo (supervisor delegates to research/writing/critique) ─────
var subagentsFactory = new SubagentsAgentFactory(openAiClient, loggerFactory, jsonOptions);
app.MapAGUI("/subagents", subagentsFactory.CreateAgent());

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

await app.RunAsync();

static OpenAIClient CreateOpenAiClient(IConfiguration configuration, ILogger logger)
{
    // Use the shared resolver so the primary OpenAI client and the secondary
    // tool-calling HTTP client (A2uiSecondaryToolCaller) agree on which upstream
    // endpoint to hit (see ApiKeyResolver for the env/config precedence and the
    // non-mock fail-fast).
    var endpoint = ApiKeyResolver.ResolveEndpoint(configuration);
    var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
    var endpointConfig = configuration["OPENAI_BASE_URL"];

    if (!string.IsNullOrEmpty(endpointEnv))
    {
        logger.LogInformation("Using OpenAI endpoint from OPENAI_BASE_URL env: {Endpoint}", endpoint);
    }
    else if (!string.IsNullOrEmpty(endpointConfig))
    {
        logger.LogInformation("Using OpenAI endpoint from configuration OPENAI_BASE_URL: {Endpoint}", endpoint);
    }
    else
    {
        logger.LogInformation("OPENAI_BASE_URL not set; using default OpenAI endpoint: {Endpoint}", endpoint);
    }

    var apiKey = ApiKeyResolver.ResolveApiKey(configuration, logger);

    return new OpenAIClient(
        new ApiKeyCredential(apiKey),
        AimockHeaderPolicy.CreateOpenAIClientOptions(endpoint));
}

public class WeatherInfo
{
    [JsonPropertyName("temperature")]
    public int Temperature { get; init; }

    [JsonPropertyName("conditions")]
    public string Conditions { get; init; } = string.Empty;

    [JsonPropertyName("humidity")]
    public int Humidity { get; init; }

    [JsonPropertyName("wind_speed")]
    public int WindSpeed { get; init; }

    [JsonPropertyName("feels_like")]
    public int FeelsLike { get; init; }

    [JsonPropertyName("city")]
    public string City { get; init; } = string.Empty;
}

public partial class Program { }

[JsonSerializable(typeof(WeatherInfo))]
[JsonSerializable(typeof(BeautifulChatTodo))]
[JsonSerializable(typeof(List<BeautifulChatTodo>))]
[JsonSerializable(typeof(BeautifulChatFlight))]
[JsonSerializable(typeof(List<BeautifulChatFlight>))]
internal partial class BeautifulChatSerializerContext : JsonSerializerContext
{
}
