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
    private readonly CancellationTokenSource shutdown = new();
    private Task<SkillSnapshot>? flight;

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
        if (options.ContainerId is not null || options.Revision is not null || options.Containers!.Count is < 1 or > 50)
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
        Task<SkillSnapshot> pending;
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (flight is null || flight.IsCompleted) flight = RefreshAsync();
            pending = flight;
        }
        return await pending.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<SkillSnapshot> RefreshAsync()
    {
        // Yield so the shared flight is installed before a synchronous transport can finish.
        await Task.Yield();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
        deadline.CancelAfter(configuration.RequestTimeout);
        var requests = children.Select(child => child.Registry.PendingRequest).OfType<LearnedSkillsBatchRequest>().ToArray();
        var batch = requests.Length > 0 ? FetchBatchAsync(requests, deadline.Token) : null;
        var requested = requests.Select(source => source.ContainerId).ToHashSet(StringComparer.Ordinal);
        var snapshots = await Task.WhenAll(children.Select(child => !requested.Contains(child.Id) ? Task.FromResult(child.Registry.CachedSnapshot) : child.Registry.AcquireAsync(shutdown.Token,
            async token => {
                var outcomes = await batch!.WaitAsync(token).ConfigureAwait(false);
                var outcome = outcomes[child.Id];
                if (outcome.Error is not null) throw outcome.Error;
                return outcome.Result!;
            }))).ConfigureAwait(false);
        shutdown.Token.ThrowIfCancellationRequested();
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

    private async Task<IReadOnlyDictionary<string, LearnedSkillsBatchResult>> FetchBatchAsync(LearnedSkillsBatchRequest[] requests, CancellationToken token)
    {
        try { return await configuration.Client.GetLearnedSkillsSnapshotsAsync(requests, token).ConfigureAwait(false); }
        catch (LearnedSkillsException error) when (error.Code is not ("NETWORK_ERROR" or "TIMEOUT" or "INVALID_SNAPSHOT" or "UNSUPPORTED_SERVER"))
        {
            foreach (var child in children) child.Registry.Deny(error);
            throw;
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
        shutdown.Cancel();
        foreach (var child in children) child.Registry.Dispose();
        if (configuration.OwnsClient) configuration.Client.Dispose();
    }
}
