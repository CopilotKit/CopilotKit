using Microsoft.Extensions.Configuration;
using Xunit;

namespace MsAgentDotnet.AgentTests;

// Verifies the credential/endpoint resolution ported from ms-agent-harness-dotnet.
// The whole point of the port is the OPENAI_API_KEY-first precedence (so a
// GitHub-token-only config no longer forces the outbound call to authenticate
// with a GitHub token). These tests manipulate the process OPENAI_API_KEY /
// OPENAI_BASE_URL env vars; xunit runs the tests within a class sequentially and
// no other test class touches those vars, so the ctor/Dispose save-restore is
// race-free. Each test starts from a cleared env for deterministic precedence.
public sealed class ApiKeyResolverTests : IDisposable
{
    private readonly string? _origKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
    private readonly string? _origBase = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");

    public ApiKeyResolverTests()
    {
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        Environment.SetEnvironmentVariable("OPENAI_BASE_URL", null);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", _origKey);
        Environment.SetEnvironmentVariable("OPENAI_BASE_URL", _origBase);
    }

    private static IConfiguration Config(params (string Key, string? Value)[] kvps)
    {
        var dict = new Dictionary<string, string?>();
        foreach (var (k, v) in kvps)
        {
            dict[k] = v;
        }
        return new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    [Fact]
    public void ResolveApiKey_PrefersOpenAiKey_OverGitHubToken()
    {
        var config = Config(("OPENAI_API_KEY", "sk-real"), ("GitHubToken", "gho_token"));
        Assert.Equal("sk-real", ApiKeyResolver.ResolveApiKey(config));
    }

    [Fact]
    public void ResolveApiKey_FallsBackToGitHubToken_WhenNoOpenAiKey()
    {
        var config = Config(("GitHubToken", "gho_token"));
        Assert.Equal("gho_token", ApiKeyResolver.ResolveApiKey(config));
    }

    [Fact]
    public void ResolveApiKey_EnvOpenAiKey_WinsOverConfig()
    {
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", "sk-env");
        var config = Config(("OPENAI_API_KEY", "sk-config"), ("GitHubToken", "gho_token"));
        Assert.Equal("sk-env", ApiKeyResolver.ResolveApiKey(config));
    }

    [Fact]
    public void ResolveApiKey_IgnoresWhitespaceOpenAiKey_FallsBackToGitHubToken()
    {
        var config = Config(("OPENAI_API_KEY", "   "), ("GitHubToken", "gho_token"));
        Assert.Equal("gho_token", ApiKeyResolver.ResolveApiKey(config));
    }

    [Theory]
    [InlineData("http://aimock:4010/v1")]
    [InlineData("http://localhost:4010/v1")]
    [InlineData("http://127.0.0.1:4010/v1")]
    public void ResolveApiKey_ReturnsMockKey_WhenNoKeyAndMockEndpoint(string endpoint)
    {
        var config = Config(("OPENAI_BASE_URL", endpoint));
        Assert.Equal(ApiKeyResolver.MockApiKey, ApiKeyResolver.ResolveApiKey(config));
    }

    [Fact]
    public void ResolveApiKey_Throws_WhenNoKeyAndNonMockEndpoint()
    {
        var config = Config(("OPENAI_BASE_URL", "https://api.openai.com/v1"));
        Assert.Throws<InvalidOperationException>(() => ApiKeyResolver.ResolveApiKey(config));
    }

    [Fact]
    public void ResolveEndpoint_DefaultsToGitHubModels_WhenUnset()
    {
        Assert.Equal(ApiKeyResolver.DefaultOpenAiEndpoint, ApiKeyResolver.ResolveEndpoint(Config()));
    }

    [Fact]
    public void ResolveEndpoint_PrefersConfig_OverDefault()
    {
        var config = Config(("OPENAI_BASE_URL", "http://aimock:4010/v1"));
        Assert.Equal("http://aimock:4010/v1", ApiKeyResolver.ResolveEndpoint(config));
    }

    [Fact]
    public void ResolveEndpoint_EnvWinsOverConfig()
    {
        Environment.SetEnvironmentVariable("OPENAI_BASE_URL", "http://env-host:4010/v1");
        var config = Config(("OPENAI_BASE_URL", "http://config-host:4010/v1"));
        Assert.Equal("http://env-host:4010/v1", ApiKeyResolver.ResolveEndpoint(config));
    }
}
