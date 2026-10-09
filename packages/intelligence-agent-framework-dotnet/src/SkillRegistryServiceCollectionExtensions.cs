using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace CopilotKit.Intelligence.AgentFramework;

/// <summary>Registers selected agents and their shared learned-skill context provider.</summary>
public static class SkillRegistryServiceCollectionExtensions
{
    /// <summary>Registers a keyed native agent and provider. Resolve the provider with the same name to initialize it or inspect status.</summary>
    /// <remarks>DI disposes the provider. The model factory and an injected Intelligence client retain their normal application ownership.</remarks>
    public static IServiceCollection AddCopilotKitIntelligenceSkills(this IServiceCollection services, string name,
        SkillRegistryOptions options, Func<IServiceProvider, IChatClient> chatClientFactory, ChatClientAgentOptions? agentOptions = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(chatClientFactory);
        if (string.IsNullOrWhiteSpace(name) || options is null || agentOptions?.Name is not null && agentOptions.Name != name)
            throw new LearnedSkillsException("INVALID_CONFIG", false);
        var configured = agentOptions?.Clone() ?? new ChatClientAgentOptions();
        configured.Name = name;
        services.AddKeyedSingleton<SkillRegistryContextProvider>(name, (_, _) => new(options));
        services.AddKeyedSingleton<AIAgent>(name, (provider, _) =>
            provider.GetRequiredKeyedService<SkillRegistryContextProvider>(name).CreateAgent(chatClientFactory(provider), configured));
        return services;
    }
}
