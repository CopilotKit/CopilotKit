using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;

using var intelligence = new IntelligenceClient(new IntelligenceClientOptions(
    new Uri("https://intelligence.example.com/"),
    "example-access-token",
    "example-project",
    Path.Combine(Path.GetTempPath(), "copilotkit-intelligence-example")));
await using var skillRegistry = new SkillRegistryContextProvider(
    intelligence,
    "55555555-5555-4555-8555-555555555555");

var options = new ChatClientAgentOptions
{
    AIContextProviders = [skillRegistry],
};

Console.WriteLine(options.AIContextProviders!.Count());
