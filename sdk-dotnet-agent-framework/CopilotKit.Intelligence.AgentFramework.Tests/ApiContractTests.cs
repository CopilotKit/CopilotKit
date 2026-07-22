using System.Reflection;
using Microsoft.Agents.AI;
using Xunit;

namespace CopilotKit.Intelligence.AgentFramework.Tests;

public sealed class ApiContractTests
{
    [Fact]
    public void NativeContextProviderRegistrationContract()
    {
        AIContextProvider provider = new ProbeProvider();
        var options = new ChatClientAgentOptions
        {
            AIContextProviders = [provider],
        };

        Assert.Same(provider, Assert.Single(options.AIContextProviders!));

        var method = typeof(AIContextProvider).GetMethod(
            "ProvideAIContextAsync",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(method);
        Assert.Equal(typeof(ValueTask<AIContext>), method.ReturnType);
        Assert.Equal(
            [typeof(AIContextProvider.InvokingContext), typeof(CancellationToken)],
            method.GetParameters().Select(parameter => parameter.ParameterType));
    }

    [Fact]
    public void AdapterRetainsTheNativeContextMergeImplementation()
    {
        Assert.True(typeof(AIContextProvider).IsAssignableFrom(typeof(SkillRegistryContextProvider)));
        var mergeMethod = typeof(SkillRegistryContextProvider).GetMethod(
            "InvokingCoreAsync",
            BindingFlags.Instance | BindingFlags.NonPublic);

        Assert.NotNull(mergeMethod);
        Assert.Equal(typeof(AIContextProvider), mergeMethod.DeclaringType);
    }

    private sealed class ProbeProvider : AIContextProvider
    {
        protected override ValueTask<AIContext> ProvideAIContextAsync(
            InvokingContext context,
            CancellationToken cancellationToken = default)
        {
            return ValueTask.FromResult(new AIContext());
        }
    }
}
