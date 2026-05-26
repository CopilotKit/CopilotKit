using Microsoft.Extensions.Configuration;

/// <summary>
/// Resolves the OpenAI-compatible API key for outbound LLM calls.
/// Single source of truth shared by <c>Program.cs</c> (primary OpenAI client)
/// and <see cref="A2uiSecondaryToolCaller"/> (secondary tool-calling HTTP client).
/// </summary>
internal static class ApiKeyResolver
{
    internal const string MockApiKey = "sk-mock-local";
    internal const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";

    /// <summary>
    /// Resolves the API key using (in order): <c>OPENAI_API_KEY</c> env var,
    /// <c>configuration["OPENAI_API_KEY"]</c>, then <c>configuration["GitHubToken"]</c>.
    ///
    /// If none of those are set, behavior depends on the upstream endpoint
    /// (<c>OPENAI_BASE_URL</c> env / config): when it looks like aimock or
    /// localhost, the mock key is returned silently (intended dev path); for
    /// any other endpoint we fail-fast with an <see cref="InvalidOperationException"/>
    /// so misconfigured prod deployments do not silently send a bogus key.
    /// </summary>
    internal static string ResolveApiKey(IConfiguration configuration, ILogger? logger = null)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
            ?? configuration["OPENAI_API_KEY"]
            ?? configuration["GitHubToken"];

        if (!string.IsNullOrEmpty(apiKey))
        {
            return apiKey;
        }

        var endpoint = ResolveEndpoint(configuration);
        if (IsMockEndpoint(endpoint))
        {
            // Silent fallback in dev — aimock/localhost ignores the key.
            return MockApiKey;
        }

        var message =
            "No API key found (checked OPENAI_API_KEY env, configuration[OPENAI_API_KEY], configuration[GitHubToken]) " +
            $"and OPENAI_BASE_URL ('{endpoint}') is not an aimock/localhost endpoint. " +
            "Refusing to fall back to the mock key for a non-mock endpoint.";
        logger?.LogCritical("[api-key-resolver] {Message}", message);
        throw new InvalidOperationException(message);
    }

    /// <summary>
    /// Returns the configured OpenAI endpoint, preferring env var then config,
    /// then falling back to the public Azure-hosted models endpoint.
    /// </summary>
    internal static string ResolveEndpoint(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        return Environment.GetEnvironmentVariable("OPENAI_BASE_URL")
            ?? configuration["OPENAI_BASE_URL"]
            ?? DefaultOpenAiEndpoint;
    }

    private static bool IsMockEndpoint(string endpoint)
    {
        // Parse and inspect ONLY the host component. Substring matching against
        // the full URL is exploitable: an attacker-controlled endpoint like
        // https://attacker.example.com/aimock-decoy or
        // https://api.openai.com/?env=localhost would otherwise be classified
        // as a mock and bypass the fail-fast guard, silently returning the
        // mock key.
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri))
        {
            return false;
        }

        var host = uri.Host;
        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host == "127.0.0.1"
            || host == "0.0.0.0"
            || host.Equals("aimock", StringComparison.OrdinalIgnoreCase)
            || host.StartsWith("aimock.", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".aimock", StringComparison.OrdinalIgnoreCase);
    }
}
