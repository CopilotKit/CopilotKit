using System.Reflection;
using Xunit;

namespace CopilotKit.Intelligence.AgentFramework.Tests;

public sealed class PackageTests
{
    private static readonly string[] RequiredHeadings =
    [
        "## Installation",
        "## Native registration",
        "## Lifecycle and preload",
        "## Fresh and cached data",
        "## Limits and scripts",
        "## Telemetry",
        "## Errors",
        "## Closing",
        "## Compatibility",
        "## Ownership and release",
    ];

    [Fact]
    public void ReadmeAndPublicApiContract()
    {
        var readme = File.ReadAllText(FindPackageFile("README.md"));
        Assert.All(RequiredHeadings, heading => Assert.Contains(heading, readme, StringComparison.Ordinal));
        Assert.Contains("CopilotKit.Intelligence.AgentFramework", readme, StringComparison.Ordinal);
        Assert.Contains("new SkillRegistryContextProvider(", readme, StringComparison.Ordinal);
        Assert.Contains("AIContextProviders = [skillRegistry]", readme, StringComparison.Ordinal);
        Assert.DoesNotContain("DelegatingAIAgent", readme, StringComparison.Ordinal);

        var publicTypes = typeof(SkillRegistryContextProvider).Assembly
            .GetExportedTypes()
            .Select(type => type.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        Assert.Equal(
            new[]
            {
                "SkillRegistryContextProvider",
                "SkillRegistryContextProviderOptions",
                "SkillRegistryContextRecord",
                "SkillRegistrySnapshot",
                "SkillRegistrySource",
                "SkillRegistryStatus",
                "SkillRegistryTelemetrySink",
            }.Order(StringComparer.Ordinal),
            publicTypes);
    }

    [Theory]
    [InlineData("9.8.7+abcdef", "9.8.7")]
    [InlineData("9.8.7", "9.8.7")]
    [InlineData(null, SkillRegistryContextProvider.SourceTreeVersion)]
    [InlineData("", SkillRegistryContextProvider.SourceTreeVersion)]
    public void AdapterVersionUsesPackageMetadataWithSourceFallback(string? value, string expected)
    {
        Assert.Equal(expected, SkillRegistryContextProvider.ResolveAdapterVersion(value));
        Assert.Equal(
            SkillRegistryContextProvider.ResolveAdapterVersion(
                typeof(SkillRegistryContextProvider).Assembly
                    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                    .InformationalVersion),
            SkillRegistryContextProvider.AdapterVersion);
    }

    private static string FindPackageFile(string relativePath)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sdk-dotnet-agent-framework", relativePath);
            if (File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new FileNotFoundException($"Could not locate sdk-dotnet-agent-framework/{relativePath}.");
    }
}
