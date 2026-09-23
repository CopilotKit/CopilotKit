using System.Collections.Immutable;
using System.Text;
using System.Text.Json;

namespace CopilotKit.Intelligence.AgentFramework;

/// <summary>Composes existing per-container caches into one invocation snapshot.</summary>
internal sealed class SkillRegistry : IDisposable
{
    private readonly object gate = new();
    private readonly RegistryConfiguration configuration;
    private readonly ImmutableArray<(string Id, SingleSkillRegistry Registry)> children;
    private readonly bool multiple;
    private SkillSnapshot? snapshot;
    private bool disposed;

    internal SkillRegistry(SkillRegistryOptions options, TimeProvider? clock = null)
    {
        if (options is null) throw new LearnedSkillsException("INVALID_CONFIG", false);
        multiple = options.Containers is not null;
        if (!multiple)
        {
            configuration = RegistryConfiguration.Resolve(options);
            children = [(configuration.ContainerId, new SingleSkillRegistry(configuration with { OwnsClient = false }, clock))];
            return;
        }
        if (options.ContainerId is not null || options.Revision is not null || options.Containers!.Count == 0)
            throw new LearnedSkillsException("INVALID_CONFIG", false);
        var sources = options.Containers.ToImmutableArray();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var source in sources)
        {
            if (source is null || string.IsNullOrWhiteSpace(source.Id) || source.Id is "." or ".."
                || source.Revision is not null && string.IsNullOrWhiteSpace(source.Revision) || !ids.Add(source.Id))
                throw new LearnedSkillsException("INVALID_CONFIG", false);
            try { _ = SkillSnapshot.Utf8.GetByteCount(source.Id); }
            catch (EncoderFallbackException error) { throw new LearnedSkillsException("INVALID_CONFIG", false, error); }
        }
        configuration = RegistryConfiguration.Resolve(new SkillRegistryOptions {
            Client = options.Client, ApiKey = options.ApiKey, ApiUrl = options.ApiUrl,
            ContainerId = sources[0].Id, Revision = sources[0].Revision,
            FreshnessWindow = options.FreshnessWindow, RequestTimeout = options.RequestTimeout, Debug = options.Debug
        }, useLegacyEnvironment: false);
        children = sources.Select(source => (source.Id, new SingleSkillRegistry(configuration with {
            ContainerId = source.Id, Revision = source.Revision, OwnsClient = false
        }, clock))).ToImmutableArray();
    }

    internal SkillRegistryStatus Status
    {
        get
        {
            if (!multiple) return children[0].Registry.Status;
            var statuses = children.Select(child => {
                var status = child.Registry.Status;
                return new SkillContainerStatus(child.Id, status.Initialized, status.Revision, status.Mode,
                    status.LastCheckedAt, status.Stale, status.LastError);
            }).ToImmutableArray();
            var errors = statuses.Select(status => status.LastError).OfType<SkillRegistryError>().ToArray();
            var error = errors.FirstOrDefault(item => item.Code is not ("NETWORK_ERROR" or "TIMEOUT" or "INVALID_SNAPSHOT" or "UNSUPPORTED_SERVER"))
                ?? errors.FirstOrDefault();
            lock (gate)
                return new MultiSkillRegistryStatus(snapshot is not null,
                    statuses.All(status => status.Mode == "pinned") ? "pinned" : "latest",
                    statuses.All(status => status.LastCheckedAt is not null) ? statuses.Min(status => status.LastCheckedAt) : null,
                    statuses.Any(status => status.Stale), error, statuses);
        }
    }

    internal async Task<SkillSnapshot> AcquireAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate) ObjectDisposedException.ThrowIf(disposed, this);
        if (!multiple) return await children[0].Registry.AcquireAsync(cancellationToken).ConfigureAwait(false);
        // Each child shields its own shared refresh from cancellation by an invocation.
        var snapshots = await Task.WhenAll(children.Select(child => child.Registry.AcquireAsync(cancellationToken))).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        var metadata = children.Select((child, index) => new[] { child.Id, snapshots[index].Revision, snapshots[index].ETag });
        var identity = "composite:" + SkillSnapshot.Hash(JsonSerializer.SerializeToUtf8Bytes(metadata));
        var skills = children.SelectMany((child, index) => snapshots[index].Skills.Select(skill =>
            skill with { Name = EncodeComponent(child.Id) + "/" + skill.Name }))
            .OrderBy(skill => skill.Name, Comparer<string>.Create(SkillSnapshot.Compare)).ToImmutableArray();
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (snapshot?.Revision != identity) snapshot = new SkillSnapshot(identity, identity, skills);
            return snapshot;
        }
    }

    // Match JavaScript encodeURIComponent, including its five extra safe punctuation characters.
    private static string EncodeComponent(string value)
    {
        var result = new StringBuilder();
        foreach (var octet in SkillSnapshot.Utf8.GetBytes(value))
        {
            if (octet is >= (byte)'a' and <= (byte)'z' or >= (byte)'A' and <= (byte)'Z'
                or >= (byte)'0' and <= (byte)'9' || "-_.!~*'()".Contains((char)octet))
                result.Append((char)octet);
            else result.Append('%').Append(octet.ToString("X2"));
        }
        return result.ToString();
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
        }
        foreach (var child in children) child.Registry.Dispose();
        if (configuration.OwnsClient) configuration.Client.Dispose();
    }
}
