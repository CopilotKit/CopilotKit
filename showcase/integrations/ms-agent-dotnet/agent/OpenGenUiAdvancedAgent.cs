using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

/// <summary>
/// Factory for the Open-Ended Generative UI (Advanced) demo agent.
///
/// This is the "advanced" variant of the Open Generative UI demo. The key
/// distinguishing feature: the agent-authored, sandboxed UI can invoke
/// frontend-registered <strong>sandbox functions</strong> — functions the
/// app defines on the host page (see
/// <c>src/app/demos/open-gen-ui-advanced/sandbox-functions.ts</c>) and
/// makes callable from inside the iframe via
/// <c>await Websandbox.connection.remote.&lt;name&gt;(args)</c>.
///
/// How it works end-to-end:
/// - The frontend passes <c>openGenerativeUI={{ sandboxFunctions }}</c>
///   to the <c>CopilotKitProvider</c>. The provider injects a JSON
///   descriptor of those functions into the agent context.
/// - The CopilotKit runtime picks up both the frontend-registered
///   <c>generateSandboxedUi</c> tool (auto-registered by the provider
///   when OGUI is enabled on the runtime) AND the sandbox-function
///   descriptors and merges them into what the LLM sees.
/// - The LLM generates HTML + JS that calls
///   <c>Websandbox.connection.remote.&lt;name&gt;(...)</c> in response
///   to user interactions.
/// - The runtime's <c>OpenGenerativeUIMiddleware</c> converts the
///   streaming <c>generateSandboxedUi</c> tool call into
///   <c>open-generative-ui</c> activity events that the built-in
///   renderer mounts inside a sandboxed iframe.
/// - The renderer wires each <c>sandboxFunctions</c> entry as a
///   <c>localApi</c> method on the websandbox connection so in-iframe
///   code can call it.
///
/// The "minimal" sibling (<see cref="OpenGenUiAgentFactory"/>) uses the
/// same OGUI pipeline without sandbox functions.
/// </summary>
public class OpenGenUiAdvancedAgentFactory
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    private const string SystemPrompt = @"You are a UI-generating assistant for the Open Generative UI (Advanced) demo.

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. The generated UI must be INTERACTIVE and must invoke the
available host-side sandbox functions described in your agent context
(delivered via `copilotkit.context`) in response to user interactions.

Sandbox-function calling contract (inside the generated iframe):
- Call a host function with:
      await Websandbox.connection.remote.<functionName>(args)
  The call returns a Promise; await it.
- Each handler returns a plain object. Read the return shape from the
  function's description in your context and use the EXACT field names
  it returns (e.g. if the description says the handler returns
  `{ ok, value }`, read `res.value` — not `res.result`).
- Descriptions, names, and JSON-schema parameter shapes for every
  available sandbox function are listed in your context. Read them
  carefully and wire at least one interactive UI element to call one.

Sandbox iframe restrictions (CRITICAL):
- The iframe runs with `sandbox=""allow-scripts""` ONLY. Forms are NOT
  allowed. You MUST NOT use `<form>` elements or `<button type=""submit"">`.
  Clicking a submit button inside a sandboxed form is blocked by the
  browser BEFORE any onsubmit handler runs, so the sandbox-function call
  never fires.
- Use plain `<button type=""button"">` elements and wire them with
  `addEventListener('click', ...)` or an inline click handler. Do the same
  for ""Enter"" keypresses on inputs: attach a `keydown` listener that
  checks `e.key === 'Enter'` and calls your handler directly — do NOT
  wrap inputs in a `<form>`.

Generation guidance:
- Emit `initialHeight` and `placeholderMessages` first, then CSS, then
  HTML, then `jsFunctions` / `jsExpressions` if helpful.
- Always include a visible result element (e.g. an output div) that you
  UPDATE after the sandbox function resolves, so the user can *see* the
  round-trip: ""Button clicked -> remote call -> visible result"".
- Use CDN scripts (Chart.js, D3, etc.) via <script> tags in the HTML head
  when you need libraries.
- Do NOT use fetch/XHR, localStorage, or document.cookie — the sandbox
  has no same-origin access. ONLY use `Websandbox.connection.remote.*`
  for host-page interactions.
- Keep your own chat message brief (1 sentence max); the rendered UI is
  the real output.";

    private readonly OpenAIClient _openAiClient;

    public OpenGenUiAdvancedAgentFactory(IConfiguration configuration)
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

        // No backend tools. The `generateSandboxedUi` frontend tool is
        // injected by the runtime's OGUI middleware, and the sandbox
        // functions appear as agent context (copilotkit.context) — both
        // are merged into the tool/context payload the LLM sees via the
        // normal AG-UI flow.
        return new ChatClientAgent(
            chatClient,
            name: "OpenGenUiAdvancedAgent",
            description: SystemPrompt);
    }
}
