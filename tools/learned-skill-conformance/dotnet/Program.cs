using System.ClientModel;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

var endpoint = Environment.GetEnvironmentVariable("LEARNED_SKILL_AIMOCK_URL") ?? throw new InvalidOperationException("AIMock endpoint is required.");
using var intelligence = new IntelligenceClient(new IntelligenceOptions {
    ApiKey = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY")!,
    ApiUrl = new Uri(Environment.GetEnvironmentVariable("INTELLIGENCE_API_URL")!)
});
using var skills = new SkillRegistryContextProvider(new SkillRegistryOptions {
    Client = intelligence, ContainerId = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID"), FreshnessWindow = TimeSpan.Zero
});
await skills.InitializeAsync();
using var model = new OpenAIClient(new ApiKeyCredential("aimock"), new OpenAIClientOptions { Endpoint = new Uri(endpoint + "/v1") })
    .GetChatClient("gpt-4o-mini").AsIChatClient();
var agent = skills.CreateAgent(model, new ChatClientAgentOptions {
    ChatOptions = new() { Instructions = "Developer policy: follow the published refund procedure." }
});
var response = await agent.RunAsync("Learned skill acceptance refund");
if (!response.Text.Contains("Acceptance complete")) throw new Exception("Native acceptance did not complete.");
