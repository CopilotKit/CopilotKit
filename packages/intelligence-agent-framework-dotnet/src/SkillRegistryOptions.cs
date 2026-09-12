namespace CopilotKit.Intelligence.AgentFramework;

/// <summary>Configuration shared by agents using one learned-skill registry.</summary>
public sealed class SkillRegistryOptions
{
    /// <summary>An application-owned canonical client. Its credentials and transport remain authoritative.</summary>
    public IntelligenceClient? Client { get; init; }
    /// <summary>API key for an adapter-owned client; defaults to CPK_INTELLIGENCE_API_KEY.</summary>
    public string? ApiKey { get; init; }
    /// <summary>API endpoint for an adapter-owned client; defaults to INTELLIGENCE_API_URL.</summary>
    public Uri? ApiUrl { get; init; }
    /// <summary>Container to read; defaults to CPK_INTELLIGENCE_LEARNING_CONTAINER_ID.</summary>
    public string? ContainerId { get; init; }
    /// <summary>Exact immutable revision; defaults to CPK_INTELLIGENCE_SKILLS_REVISION, otherwise latest.</summary>
    public string? Revision { get; init; }
    /// <summary>Minimum interval between successful checks. Zero checks on every invocation.</summary>
    public TimeSpan FreshnessWindow { get; init; } = TimeSpan.FromSeconds(5);
    /// <summary>Deadline for a refresh, including snapshot validation.</summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(5);
    /// <summary>Writes safe lifecycle messages to standard error. Disabled by default.</summary>
    public bool Debug { get; init; }
}

/// <summary>Safe diagnostic fields without transport causes or response contents.</summary>
public sealed record SkillRegistryError(string Code, string Message, bool Retryable);
/// <summary>An immutable view of registry availability and its last successful check.</summary>
public sealed record SkillRegistryStatus(bool Initialized, string? Revision, string Mode,
    DateTimeOffset? LastCheckedAt, bool Stale, SkillRegistryError? LastError);

internal sealed record RegistryConfiguration(IntelligenceClient Client, bool OwnsClient, string ContainerId,
    string? Revision, TimeSpan FreshnessWindow, TimeSpan RequestTimeout, bool Debug)
{
    internal static RegistryConfiguration Resolve(SkillRegistryOptions options)
    {
        try
        {
            ArgumentNullException.ThrowIfNull(options);
            var container = options.ContainerId ?? Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID");
            var revision = options.Revision ?? Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_SKILLS_REVISION");
            if (string.IsNullOrWhiteSpace(container) || container is "." or ".."
                || revision is not null && string.IsNullOrWhiteSpace(revision)
                || options.FreshnessWindow < TimeSpan.Zero || options.RequestTimeout <= TimeSpan.Zero
                || options.RequestTimeout.TotalMilliseconds > uint.MaxValue - 1)
                throw new ArgumentException("Invalid learned-skill configuration.");
            var client = options.Client;
            if (client is null)
            {
                var key = options.ApiKey ?? Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY");
                var endpoint = options.ApiUrl ?? new Uri(Environment.GetEnvironmentVariable("INTELLIGENCE_API_URL")
                    ?? "https://api.intelligence.copilotkit.ai");
                client = new IntelligenceClient(new IntelligenceOptions { ApiKey = key!, ApiUrl = endpoint, RequestTimeout = options.RequestTimeout });
            }
            return new(client, options.Client is null, container, revision, options.FreshnessWindow, options.RequestTimeout, options.Debug);
        }
        catch (Exception error) when (error is ArgumentException or UriFormatException)
        { throw new LearnedSkillsException("INVALID_CONFIG", false, error); }
    }
}
