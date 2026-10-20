using System.Collections.Immutable;

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
    /// <summary>Containers to combine. Mutually exclusive with ContainerId and Revision; ignores their environment defaults.</summary>
    public IReadOnlyList<SkillContainerSource>? Containers { get; init; }
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
public record SkillRegistryStatus(bool Initialized, string? Revision, string Mode,
    DateTimeOffset? LastCheckedAt, bool Stale, SkillRegistryError? LastError);

/// <summary>A container source with an optional exact server revision.</summary>
public sealed record SkillContainerSource
{
    /// <summary>The unique, nonblank container ID.</summary>
    public required string Id { get; init; }
    /// <summary>An exact revision, or null to follow latest.</summary>
    public string? Revision { get; init; }
}

/// <summary>The immutable status of one configured container.</summary>
public sealed record SkillContainerStatus(string Id, bool Initialized, string? Revision, string Mode,
    DateTimeOffset? LastCheckedAt, bool Stale, SkillRegistryError? LastError)
    : SkillRegistryStatus(Initialized, Revision, Mode, LastCheckedAt, Stale, LastError);

/// <summary>Aggregate availability plus each container's independent status. Revision is null; use each container's revision.</summary>
public sealed record MultiSkillRegistryStatus(bool Initialized, string Mode, DateTimeOffset? LastCheckedAt,
    bool Stale, SkillRegistryError? LastError, ImmutableArray<SkillContainerStatus> Containers)
    : SkillRegistryStatus(Initialized, null, Mode, LastCheckedAt, Stale, LastError);

internal sealed record RegistryConfiguration(IntelligenceClient Client, bool OwnsClient, string ContainerId,
    string? Revision, TimeSpan FreshnessWindow, TimeSpan RequestTimeout, bool Debug)
{
    internal static RegistryConfiguration Resolve(SkillRegistryOptions options, bool useLegacyEnvironment = true)
    {
        try
        {
            ArgumentNullException.ThrowIfNull(options);
            var container = options.ContainerId ?? (useLegacyEnvironment ? Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID") : null);
            var revision = options.Revision ?? (useLegacyEnvironment ? Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_SKILLS_REVISION") : null);
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
