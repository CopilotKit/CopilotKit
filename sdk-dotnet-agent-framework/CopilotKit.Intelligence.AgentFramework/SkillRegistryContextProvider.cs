using System.Reflection;
using CopilotKit.Intelligence;
using Microsoft.Agents.AI;

namespace CopilotKit.Intelligence.AgentFramework;

public enum SkillRegistryStatus
{
    Cold,
    Loading,
    Ready,
    Refreshing,
    Stale,
    Denied,
    Revoked,
    Closed,
}

public enum SkillRegistrySource
{
    None,
    Fresh,
    Cached,
}

public sealed record SkillRegistryContextRecord(
    int Position,
    string Kind,
    string Name,
    string Text,
    int ByteLength,
    string SkillId,
    string VersionId,
    string? Description);

public sealed class SkillRegistrySnapshot
{
    internal SkillRegistrySnapshot(
        SkillRegistryStatus status,
        SkillRegistrySource source,
        string? registryRevision,
        IReadOnlyList<SkillRegistryContextRecord> skills,
        string instructions,
        IntelligenceSdkException? error)
    {
        Status = status;
        Source = source;
        RegistryRevision = registryRevision;
        Skills = skills;
        Instructions = instructions;
        Error = error;
    }

    public SkillRegistryStatus Status { get; }
    public SkillRegistrySource Source { get; }
    public string? RegistryRevision { get; }
    public IReadOnlyList<SkillRegistryContextRecord> Skills { get; }
    public string Instructions { get; }
    public IntelligenceSdkException? Error { get; }
}

public delegate ValueTask SkillRegistryTelemetrySink(
    string eventName,
    IReadOnlyDictionary<string, object?> metadata,
    CancellationToken cancellationToken);

public sealed class SkillRegistryContextProviderOptions
{
    public int MaximumSkills { get; init; } = 128;
    public int MaximumSkillBytes { get; init; } = 262_144;
    public int MaximumContextBytes { get; init; } = 1_048_576;
    public TimeSpan RefreshInterval { get; init; } = TimeSpan.FromSeconds(30);
    public TimeProvider TimeProvider { get; init; } = TimeProvider.System;
    public SkillRegistryTelemetrySink? Telemetry { get; init; }
}

public sealed class SkillRegistryContextProvider : AIContextProvider, IAsyncDisposable
{
    internal const string SourceTreeVersion = "0.1.0";
    private readonly RegistryState _state;

    public SkillRegistryContextProvider(
        IntelligenceClient client,
        string learningContainerId,
        SkillRegistryContextProviderOptions? options = null)
        : this(new IntelligenceRegistryClient(client), learningContainerId, options)
    {
    }

    internal SkillRegistryContextProvider(
        IIntelligenceRegistryClient client,
        string learningContainerId,
        SkillRegistryContextProviderOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentException.ThrowIfNullOrWhiteSpace(learningContainerId);
        options ??= new SkillRegistryContextProviderOptions();
        if (options.MaximumSkills <= 0 || options.MaximumSkillBytes <= 0 || options.MaximumContextBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(options), "Adapter limits must be positive.");
        }

        if (options.RefreshInterval < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(options), "RefreshInterval must be non-negative.");
        }

        _state = new RegistryState(client, learningContainerId, options);
    }

    public bool IsReady => _state.IsReady;
    public SkillRegistryStatus Status => _state.Status;
    public SkillRegistrySnapshot Snapshot => _state.Snapshot;
    internal int CloseCount => _state.CloseCount;
    internal long? LastAttemptTimestamp => _state.LastAttemptTimestamp;

    public Task<SkillRegistrySnapshot> PreloadAsync(CancellationToken cancellationToken = default) =>
        _state.PreloadAsync(cancellationToken);

    public Task<SkillRegistrySnapshot> PreloadCachedAsync(CancellationToken cancellationToken = default) =>
        _state.PreloadCachedAsync(cancellationToken);

    public Task<SkillRegistrySnapshot> LoadAsync(CancellationToken cancellationToken = default) =>
        _state.LoadAsync(cancellationToken);

    public Task<SkillRegistrySnapshot> WaitUntilReadyAsync(
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default) =>
        _state.WaitUntilReadyAsync(timeout, cancellationToken);

    public ValueTask DisposeAsync() => _state.DisposeAsync();

    protected override async ValueTask<AIContext> ProvideAIContextAsync(
        InvokingContext context,
        CancellationToken cancellationToken = default)
    {
        var snapshot = await LoadAsync(cancellationToken).ConfigureAwait(false);
        return new AIContext
        {
            Instructions = snapshot.Instructions.Length == 0 ? null : snapshot.Instructions,
        };
    }

    internal static string ResolveAdapterVersion(string? informationalVersion)
    {
        if (string.IsNullOrWhiteSpace(informationalVersion))
        {
            return SourceTreeVersion;
        }

        var separator = informationalVersion.IndexOf('+', StringComparison.Ordinal);
        return separator < 0 ? informationalVersion : informationalVersion[..separator];
    }

    internal static string AdapterVersion { get; } = ResolveAdapterVersion(
        typeof(SkillRegistryContextProvider).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion);
}

internal interface IIntelligenceRegistryClient
{
    Task<InstalledSkillSet> GetAsync(string learningContainerId, CancellationToken cancellationToken);
    Task<InstalledSkillSet> GetCachedAsync(string learningContainerId, CancellationToken cancellationToken);
}

internal sealed class IntelligenceRegistryClient(IntelligenceClient client) : IIntelligenceRegistryClient
{
    private readonly IntelligenceClient _client = client ?? throw new ArgumentNullException(nameof(client));

    public Task<InstalledSkillSet> GetAsync(string learningContainerId, CancellationToken cancellationToken) =>
        _client.GetAsync(learningContainerId, cancellationToken);

    public Task<InstalledSkillSet> GetCachedAsync(string learningContainerId, CancellationToken cancellationToken) =>
        _client.GetCachedAsync(learningContainerId, cancellationToken);
}
