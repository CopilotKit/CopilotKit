namespace CopilotKit.Intelligence.AgentFramework;

/// <summary>Owns refresh state; invocation tools retain their own immutable snapshot.</summary>
internal sealed class SkillRegistry : IDisposable
{
    private readonly object gate = new();
    private readonly RegistryConfiguration configuration;
    private readonly TimeProvider clock;
    private readonly CancellationTokenSource shutdown = new();
    private SkillSnapshot? snapshot;
    private Task<SkillSnapshot>? flight;
    private LearnedSkillsException? blocked;
    private long lastSuccess;
    private bool disposed;
    private SkillRegistryStatus status;

    internal SkillRegistry(SkillRegistryOptions options, TimeProvider? clock = null)
    {
        configuration = RegistryConfiguration.Resolve(options);
        this.clock = clock ?? TimeProvider.System;
        status = new(false, null, configuration.Revision is null ? "latest" : "pinned", null, false, null);
    }

    internal SkillRegistryStatus Status { get { lock (gate) return status; } }

    internal Task<SkillSnapshot> AcquireAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        TaskCompletionSource<SkillSnapshot>? start = null;
        Task<SkillSnapshot> pending;
        SkillSnapshot? previous;
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (snapshot is not null && blocked is null && clock.GetElapsedTime(lastSuccess) < configuration.FreshnessWindow)
                return Task.FromResult(snapshot);
            previous = snapshot;
            if (flight is null)
            {
                start = new(TaskCreationOptions.RunContinuationsAsynchronously);
                flight = start.Task;
            }
            pending = flight;
        }
        if (start is not null) _ = RefreshAsync(start, previous);
        // Cancelling one caller never cancels the shared refresh.
        return pending.WaitAsync(cancellationToken);
    }

    private async Task RefreshAsync(TaskCompletionSource<SkillSnapshot> completion, SkillSnapshot? previous)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
        deadline.CancelAfter(configuration.RequestTimeout);
        try
        {
            var response = await configuration.Client.GetLearnedSkillsSnapshotAsync(configuration.ContainerId,
                configuration.Revision, previous?.ETag, deadline.Token).ConfigureAwait(false);
            SkillSnapshot next;
            if (response is LearnedSkillsUnchanged unchanged)
            {
                if (previous is null || unchanged.Revision != previous.Revision || unchanged.ETag != previous.ETag)
                    throw SkillSnapshot.Invalid();
                next = previous;
            }
            else if (response is LearnedSkillsSnapshot archive)
            {
                // Copy caller-owned bytes before scheduling validation on a worker.
                var captured = archive with { Bytes = archive.Bytes.ToArray() };
                next = await Task.Run(() => SkillSnapshot.Parse(captured, deadline.Token), deadline.Token)
                    .WaitAsync(deadline.Token).ConfigureAwait(false);
            }
            else throw SkillSnapshot.Invalid();
            if (configuration.Revision is not null && next.Revision != configuration.Revision) throw SkillSnapshot.Invalid();
            deadline.Token.ThrowIfCancellationRequested();
            lock (gate)
            {
                ObjectDisposedException.ThrowIf(disposed, this);
                snapshot = next;
                blocked = null;
                lastSuccess = clock.GetTimestamp();
                status = status with { Initialized = true, Revision = next.Revision, LastCheckedAt = clock.GetUtcNow(), Stale = false, LastError = null };
                flight = null;
            }
            Log(response is LearnedSkillsUnchanged ? "Learned skills are unchanged." : "Learned skills loaded.");
            completion.TrySetResult(next);
        }
        catch (Exception cause)
        {
            var error = cause as LearnedSkillsException ?? new LearnedSkillsException(
                cause is OperationCanceledException ? "TIMEOUT" : "INVALID_SNAPSHOT", cause is OperationCanceledException, cause);
            lock (gate)
            {
                flight = null;
                if (disposed) completion.TrySetCanceled(shutdown.Token);
                else
                {
                    if (!Transient(error)) blocked = error;
                    var activeError = blocked ?? error;
                    var useStale = snapshot is not null && blocked is null && Transient(error);
                    status = status with { Stale = useStale, LastError = new(activeError.Code, activeError.Message, activeError.Retryable) };
                    if (useStale) completion.TrySetResult(snapshot!);
                    else completion.TrySetException(activeError);
                }
            }
            Log(error.Message);
        }
    }

    private static bool Transient(LearnedSkillsException error) => error.Code is "NETWORK_ERROR" or "TIMEOUT" or "INVALID_SNAPSHOT" or "UNSUPPORTED_SERVER";
    private void Log(string message)
    {
        if (!configuration.Debug) return;
        // Diagnostics must not change invocation availability or refresh state.
        try { Console.Error.WriteLine(message); }
        catch (Exception) { }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
        }
        shutdown.Cancel();
        if (configuration.OwnsClient) configuration.Client.Dispose();
        // The source stays alive until outstanding refresh callbacks release their linked tokens.
    }
}
