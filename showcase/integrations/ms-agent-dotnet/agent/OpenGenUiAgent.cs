using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

/// <summary>
/// Factory for the Open-Ended Generative UI (minimal) demo agent.
///
/// The simplest possible example that exercises the open-ended generative
/// UI pipeline. All the interesting work happens outside the agent:
///
/// - The CopilotKit runtime's <c>openGenerativeUI</c> flag (see
///   <c>src/app/api/copilotkit-ogui/route.ts</c>) auto-injects the
///   frontend-registered <c>generateSandboxedUi</c> tool. The LLM sees it
///   via the normal AG-UI flow.
/// - When the LLM calls <c>generateSandboxedUi</c>, the runtime's
///   <c>OpenGenerativeUIMiddleware</c> converts the streaming tool call
///   into <c>open-generative-ui</c> activity events that the built-in
///   renderer mounts inside a sandboxed iframe.
///
/// This is the minimal variant: no sandbox functions, no app-side tools.
/// The agent simply asks the LLM to design and emit a single-shot
/// sandboxed UI. The "advanced" sibling (<see cref="OpenGenUiAdvancedAgentFactory"/>)
/// builds on this with sandbox-to-host function calling via
/// <c>openGenerativeUI.sandboxFunctions</c>.
/// </summary>
public class OpenGenUiAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private const string SystemPrompt = @"You are a UI-generating assistant for an Open Generative UI demo
focused on intricate, educational visualisations (3D axes / rotations,
neural-network activations, sorting-algorithm walkthroughs, Fourier
series, wave interference, planetary orbits, etc.).

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. Design a visually polished, self-contained HTML + CSS +
SVG widget that *teaches* the requested concept.

The frontend injects a detailed ""design skill"" as agent context
describing the palette, typography, labelling, and motion conventions
expected — follow it closely. Key invariants:
- Use inline SVG (or <canvas>) for geometric content, not stacks of <div>s.
- Every axis is labelled; every colour-coded series has a legend.
- Prefer CSS @keyframes / transitions over setInterval; loop cyclical
  concepts with animation-iteration-count: infinite.
- Motion must teach — animate the actual step of the concept, not decoration.
- No fetch / XHR / localStorage — the sandbox has no same-origin access.

Output order:
- `initialHeight` (typically 480-560 for visualisations) first.
- A short `placeholderMessages` array (2-3 lines describing the build).
- `css` (complete).
- `html` (streams live — keep it tidy). CDN <script> tags for Chart.js /
  D3 / etc. go inside the html.

Keep your own chat message brief (1 sentence) — the real output is the
rendered visualisation.";

    private readonly OpenAIClient _openAiClient;

    public OpenGenUiAgentFactory(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpoint = Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? DefaultOpenAiEndpoint;

        _openAiClient = new OpenAIClient(
            new ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent CreateAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        // No backend tools. The `generateSandboxedUi` tool is registered
        // on the frontend by CopilotKitProvider (when `openGenerativeUI`
        // is enabled on the runtime) and merged into the agent's tool
        // list by the AG-UI protocol as a frontend-side action.
        return new ChatClientAgent(
            chatClient,
            name: "OpenGenUiAgent",
            description: SystemPrompt);
    }
}
