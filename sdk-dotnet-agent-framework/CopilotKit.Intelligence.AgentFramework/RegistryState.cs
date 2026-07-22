using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using CopilotKit.Intelligence;

namespace CopilotKit.Intelligence.AgentFramework;

internal sealed class RegistryState
{
    private static readonly AsyncLocal<RegistryState?> TelemetryOwner = new();
    private static readonly IReadOnlyList<SkillRegistryContextRecord> EmptySkills =
        Array.AsReadOnly(Array.Empty<SkillRegistryContextRecord>());
    private readonly IIntelligenceRegistryClient _client;
    private readonly string _learningContainerId;
    private readonly SkillRegistryContextProviderOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private RegistrySnapshot _snapshot;
    private Task<SkillRegistrySnapshot>? _inflight;
    private TaskCompletionSource _changed = NewSignal();
    private int _callerCount;

    internal RegistryState(
        IIntelligenceRegistryClient client,
        string learningContainerId,
        SkillRegistryContextProviderOptions options)
    {
        _client = client;
        _learningContainerId = learningContainerId;
        _options = options;
        _snapshot = RegistrySnapshot.Cold;
    }

    internal bool IsReady => Status is SkillRegistryStatus.Ready or SkillRegistryStatus.Revoked;
    internal SkillRegistryStatus Status => Volatile.Read(ref _snapshot).Public.Status;
    internal SkillRegistrySnapshot Snapshot => Volatile.Read(ref _snapshot).Public;

    internal Task<SkillRegistrySnapshot> PreloadAsync(CancellationToken cancellationToken) =>
        StartOrJoinAsync(cached: false, force: true, source: "preload", cancellationToken);

    internal Task<SkillRegistrySnapshot> PreloadCachedAsync(CancellationToken cancellationToken) =>
        StartOrJoinAsync(cached: true, force: true, source: "preload", cancellationToken);

    internal Task<SkillRegistrySnapshot> LoadAsync(CancellationToken cancellationToken) =>
        StartOrJoinAsync(cached: false, force: false, source: "load", cancellationToken);

    internal async Task<SkillRegistrySnapshot> WaitUntilReadyAsync(
        TimeSpan? timeout,
        CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        while (true)
        {
            var current = Volatile.Read(ref _snapshot);
            if (current.Public.Status is SkillRegistryStatus.Ready or SkillRegistryStatus.Revoked)
            {
                return current.Public;
            }

            if (current.Public.Status is SkillRegistryStatus.Denied or SkillRegistryStatus.Stale or SkillRegistryStatus.Closed)
            {
                throw current.Public.Error ?? StaleError();
            }

            var signal = Volatile.Read(ref _changed).Task;
            if (timeout is null)
            {
                await signal.WaitAsync(cancellationToken).ConfigureAwait(false);
                continue;
            }

            var elapsed = Stopwatch.GetElapsedTime(started);
            var remaining = timeout.Value - elapsed;
            if (remaining <= TimeSpan.Zero)
            {
                throw TimeoutError();
            }

            try
            {
                await signal.WaitAsync(remaining, cancellationToken).ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                throw TimeoutError();
            }
        }
    }

    internal async ValueTask DisposeAsync()
    {
        var changed = false;
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_snapshot.Public.Status != SkillRegistryStatus.Closed)
            {
                PublishLocked(new RegistrySnapshot(
                    new SkillRegistrySnapshot(
                        SkillRegistryStatus.Closed,
                        SkillRegistrySource.None,
                        null,
                        EmptySkills,
                        string.Empty,
                        ClosedError()),
                    null,
                    null,
                    null));
                changed = true;
            }
        }
        finally
        {
            _gate.Release();
        }

        if (changed)
        {
            await EmitAsync("status.changed", CancellationToken.None, ("status", "closed")).ConfigureAwait(false);
        }
    }

    private async Task<SkillRegistrySnapshot> StartOrJoinAsync(
        bool cached,
        bool force,
        string source,
        CancellationToken cancellationToken)
    {
        Task<SkillRegistrySnapshot>? task = null;
        RegistrySnapshot? immediate = null;
        var joined = false;
        var joinedCallers = 0;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = _snapshot;
            if (current.Public.Status == SkillRegistryStatus.Closed)
            {
                throw current.Public.Error ?? ClosedError();
            }

            if (current.Public.Status == SkillRegistryStatus.Denied)
            {
                throw current.Public.Error!;
            }

            if (_inflight is { IsCompleted: false })
            {
                if (ReferenceEquals(TelemetryOwner.Value, this))
                {
                    immediate = current;
                }
                else
                {
                    task = _inflight;
                    _callerCount++;
                    joinedCallers = _callerCount;
                    joined = true;
                }
            }
            else if (!force && current.LastAttemptTimestamp is long attempted &&
                     _options.TimeProvider.GetElapsedTime(attempted, _options.TimeProvider.GetTimestamp()) < _options.RefreshInterval)
            {
                immediate = current;
            }
            else
            {
                var prior = current;
                var started = _options.TimeProvider.GetTimestamp();
                var transition = current.Public.Status == SkillRegistryStatus.Cold
                    ? SkillRegistryStatus.Loading
                    : SkillRegistryStatus.Refreshing;
                PublishLocked(current with
                {
                    Public = CopyPublic(current.Public, transition, current.Public.Error),
                    LastAttemptTimestamp = started,
                });
                task = PerformLoadDeferredAsync(cached, source, prior, started, cancellationToken);
                _inflight = task;
                _callerCount = 1;
            }
        }
        finally
        {
            _gate.Release();
        }

        if (immediate is not null)
        {
            if (ReferenceEquals(TelemetryOwner.Value, this) && _inflight is { IsCompleted: false })
            {
                return Usable(immediate);
            }

            var throttleSource = source == "load" && immediate.Public.Status == SkillRegistryStatus.Stale
                ? "refresh"
                : source;
            await EmitAsync("load.throttled", cancellationToken, ("source", throttleSource)).ConfigureAwait(false);
            return Usable(immediate);
        }

        if (joined)
        {
            await EmitAsync(
                "load.singleflight_joined",
                cancellationToken,
                ("joinedCallers", joinedCallers)).ConfigureAwait(false);
        }

        var sharedTask = task!;
        try
        {
            return await sharedTask.ConfigureAwait(false);
        }
        finally
        {
            if (sharedTask.IsCompleted)
            {
                await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                try
                {
                    if (ReferenceEquals(_inflight, sharedTask))
                    {
                        _inflight = null;
                        _callerCount = 0;
                    }
                }
                finally
                {
                    _gate.Release();
                }
            }
        }
    }

    private async Task<SkillRegistrySnapshot> PerformLoadDeferredAsync(
        bool cached,
        string requestedSource,
        RegistrySnapshot prior,
        long started,
        CancellationToken cancellationToken)
    {
        await Task.Yield();
        return await PerformLoadAsync(cached, requestedSource, prior, started, cancellationToken).ConfigureAwait(false);
    }

    private async Task<SkillRegistrySnapshot> PerformLoadAsync(
        bool cached,
        string requestedSource,
        RegistrySnapshot prior,
        long started,
        CancellationToken cancellationToken)
    {
        var telemetrySource = requestedSource == "load" && prior.Public.Status != SkillRegistryStatus.Cold
            ? "refresh"
            : requestedSource;
        try
        {
            await EmitAsync("load.started", cancellationToken, ("source", telemetrySource)).ConfigureAwait(false);
        }
        catch (IntelligenceSdkException telemetryFailure) when (
            telemetryFailure.Code == "LEARNING_TELEMETRY_SINK_FAILED")
        {
            return await DenyForTelemetryFailureAsync(telemetryFailure, started).ConfigureAwait(false);
        }

        InstalledSkillSet installed;
        IReadOnlyList<SkillRegistryContextRecord> records;
        string instructions;
        try
        {
            installed = cached
                ? await _client.GetCachedAsync(_learningContainerId, cancellationToken).ConfigureAwait(false)
                : await _client.GetAsync(_learningContainerId, cancellationToken).ConfigureAwait(false);
            (records, instructions) = await RenderAsync(installed, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            await RestoreAfterCancellationAsync(prior).ConfigureAwait(false);
            throw;
        }
        catch (Exception failure)
        {
            return await FailAsync(failure, prior, started, cancellationToken).ConfigureAwait(false);
        }

        var source = installed.Freshness == CacheFreshness.Cached
            ? SkillRegistrySource.Cached
            : SkillRegistrySource.Fresh;
        var status = installed.Projection.Revoked ? SkillRegistryStatus.Revoked : SkillRegistryStatus.Ready;
        var completed = new RegistrySnapshot(
            new SkillRegistrySnapshot(
                status,
                source,
                installed.Projection.RegistryRevision,
                records,
                instructions,
                null),
            installed,
            started,
            _options.TimeProvider.GetTimestamp());

        await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (_snapshot.Public.Status != SkillRegistryStatus.Closed)
            {
                PublishLocked(completed);
            }
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            await EmitAsync("status.changed", cancellationToken, ("status", StatusName(status))).ConfigureAwait(false);
            await EmitAsync(
                "load.succeeded",
                cancellationToken,
                ("outcome", "success"),
                ("freshness", SourceName(source)),
                ("skillCount", records.Count),
                ("registryRevision", installed.Projection.RegistryRevision),
                ("latencyMs", ElapsedMilliseconds(started))).ConfigureAwait(false);
        }
        catch (IntelligenceSdkException telemetryFailure) when (
            telemetryFailure.Code == "LEARNING_TELEMETRY_SINK_FAILED")
        {
            return await FailAsync(telemetryFailure, prior, started, cancellationToken).ConfigureAwait(false);
        }

        return completed.Public;
    }

    private async Task<SkillRegistrySnapshot> DenyForTelemetryFailureAsync(
        IntelligenceSdkException failure,
        long started)
    {
        var denied = new RegistrySnapshot(
            new SkillRegistrySnapshot(
                SkillRegistryStatus.Denied,
                SkillRegistrySource.None,
                null,
                EmptySkills,
                string.Empty,
                failure),
            null,
            started,
            null);

        await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (_snapshot.Public.Status != SkillRegistryStatus.Closed)
            {
                PublishLocked(denied);
            }
        }
        finally
        {
            _gate.Release();
        }

        throw failure;
    }

    private async Task<SkillRegistrySnapshot> FailAsync(
        Exception failure,
        RegistrySnapshot prior,
        long started,
        CancellationToken cancellationToken)
    {
        var classified = ClassifyFailure(failure);
        var records = classified.Status == SkillRegistryStatus.Stale ? prior.Public.Skills : EmptySkills;
        var instructions = classified.Status == SkillRegistryStatus.Stale ? prior.Public.Instructions : string.Empty;
        var failed = new RegistrySnapshot(
            new SkillRegistrySnapshot(
                classified.Status,
                classified.Status == SkillRegistryStatus.Stale ? prior.Public.Source : SkillRegistrySource.None,
                classified.Status == SkillRegistryStatus.Stale ? prior.Public.RegistryRevision : null,
                records,
                instructions,
                classified.Error),
            classified.Status == SkillRegistryStatus.Stale ? prior.Installed : null,
            started,
            prior.LastSuccessTimestamp);

        await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (_snapshot.Public.Status != SkillRegistryStatus.Closed)
            {
                PublishLocked(failed);
            }
        }
        finally
        {
            _gate.Release();
        }

        await EmitAsync("status.changed", cancellationToken, ("status", StatusName(classified.Status))).ConfigureAwait(false);
        await EmitAsync(
            "load.failed",
            cancellationToken,
            ("outcome", "failure"),
            ("reason", classified.Reason),
            ("retryable", classified.Error.Retryable),
            ("errorCode", classified.Error.Code),
            ("errorCategory", classified.Error.Category),
            ("requestId", classified.Error.RequestId),
            ("traceId", classified.Error.TraceId),
            ("latencyMs", ElapsedMilliseconds(started))).ConfigureAwait(false);
        throw classified.Error;
    }

    private async Task RestoreAfterCancellationAsync(RegistrySnapshot prior)
    {
        await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (_snapshot.Public.Status != SkillRegistryStatus.Closed)
            {
                PublishLocked(prior);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<(IReadOnlyList<SkillRegistryContextRecord> Records, string Instructions)> RenderAsync(
        InstalledSkillSet installed,
        CancellationToken cancellationToken)
    {
        var entries = installed.Projection.Entries;
        if (installed.Projection.Revoked)
        {
            if (entries.Count != 0 || installed.Skills.Count != 0)
            {
                throw ValidationError("A revoked projection must be empty.", "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION");
            }

            return (EmptySkills, string.Empty);
        }

        if (entries.Count != installed.Skills.Count)
        {
            throw ValidationError("The generic SDK did not provide a complete verified skill projection.", "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION");
        }

        if (entries.Count > _options.MaximumSkills)
        {
            throw ValidationError("The verified Registry set exceeds the adapter skill limit.", "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS");
        }

        foreach (var entry in entries)
        {
            if (entry.Manifest is null)
            {
                throw ValidationError("The generic SDK did not provide a verified manifest.", "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION");
            }

            if (entry.Manifest.Files.Any(file =>
                    string.Equals(file.Role, "script", StringComparison.OrdinalIgnoreCase) ||
                    IsScriptsPath(file.Path)))
            {
                throw ValidationError("Executable skill artifacts are disabled by this adapter.", "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED");
            }
        }

        var records = new SkillRegistryContextRecord[entries.Count];
        var aggregate = 0;
        for (var index = 0; index < entries.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = entries[index];
            var skill = installed.Skills[index];
            if (entry.Position != index || skill.Position != index ||
                entry.SkillId != skill.SkillId || entry.VersionId != skill.VersionId)
            {
                throw ValidationError("Verified skill projection order or identity is invalid.", "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION");
            }

            byte[] bytes;
            try
            {
                bytes = await File.ReadAllBytesAsync(Path.Combine(skill.Directory, "SKILL.md"), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw ValidationError("A verified SKILL.md file could not be read.", "INTELLIGENCE_ADAPTER_INVALID_UTF8", "integrity", error);
            }

            if (bytes.Length > _options.MaximumSkillBytes)
            {
                throw ValidationError("A verified SKILL.md exceeds the adapter byte limit.", "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE");
            }

            aggregate = checked(aggregate + bytes.Length);
            if (aggregate > _options.MaximumContextBytes)
            {
                throw ValidationError("The rendered skill set exceeds the adapter context limit.", "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE");
            }

            string text;
            try
            {
                text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(bytes);
            }
            catch (DecoderFallbackException error)
            {
                throw ValidationError("A verified SKILL.md is not strict UTF-8.", "INTELLIGENCE_ADAPTER_INVALID_UTF8", "integrity", error);
            }

            records[index] = new SkillRegistryContextRecord(
                entry.Position,
                "instruction",
                entry.Name,
                text,
                bytes.Length,
                entry.SkillId,
                entry.VersionId,
                entry.Description);
        }

        var frozen = new ReadOnlyCollection<SkillRegistryContextRecord>(records);
        return (frozen, RenderInstructions(frozen));
    }

    private async ValueTask EmitAsync(
        string eventName,
        CancellationToken cancellationToken,
        params (string Key, object? Value)[] fields)
    {
        if (_options.Telemetry is null)
        {
            return;
        }

        var metadata = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["framework"] = "agent-framework-dotnet",
            ["adapterVersion"] = SkillRegistryContextProvider.AdapterVersion,
        };
        foreach (var (key, value) in fields)
        {
            if (value is not null)
            {
                metadata[key] = value;
            }
        }

        var previous = TelemetryOwner.Value;
        TelemetryOwner.Value = this;
        try
        {
            await _options.Telemetry(eventName, metadata, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception error)
        {
            if (error is IntelligenceSdkException sdk && sdk.Code == "LEARNING_TELEMETRY_SINK_FAILED")
            {
                throw;
            }

            throw new IntelligenceSdkException(
                "The adapter telemetry sink failed.",
                "LEARNING_TELEMETRY_SINK_FAILED",
                "internal",
                retryable: false,
                innerException: error);
        }
        finally
        {
            TelemetryOwner.Value = previous;
        }
    }

    private void PublishLocked(RegistrySnapshot snapshot)
    {
        Volatile.Write(ref _snapshot, snapshot);
        var changed = _changed;
        _changed = NewSignal();
        changed.TrySetResult();
    }

    private SkillRegistrySnapshot Usable(RegistrySnapshot snapshot)
    {
        if (snapshot.Public.Status is SkillRegistryStatus.Ready or SkillRegistryStatus.Revoked)
        {
            return snapshot.Public;
        }

        throw snapshot.Public.Error ?? StaleError();
    }

    private Failure ClassifyFailure(Exception failure)
    {
        var sdk = failure as IntelligenceSdkException ?? new IntelligenceSdkException(
            "The Registry load failed.",
            "LEARNING_REGISTRY_UNAVAILABLE",
            "availability",
            retryable: true,
            innerException: failure);
        if (IsDenied(sdk))
        {
            var denied = sdk.Code.StartsWith("INTELLIGENCE_ADAPTER_", StringComparison.Ordinal) ||
                         sdk.Code == "LEARNING_TELEMETRY_SINK_FAILED" ||
                         sdk.Code is "LEARNING_CONTAINER_ARCHIVED" or
                             "LEARNING_CONTAINER_PROJECT_MISMATCH" or
                             "LEARNING_CONTAINER_NOT_FOUND" or
                             "LEARNING_REGISTRY_UNRECOVERABLE"
                ? sdk
                : new IntelligenceSdkException(
                    "The Registry denied access to the verified skill set.",
                    "LEARNING_REGISTRY_DENIED",
                    sdk.Category,
                    retryable: false,
                    sdk.Status,
                    sdk.RequestId,
                    sdk.TraceId,
                    sdk);
            return new Failure(SkillRegistryStatus.Denied, denied, "denied");
        }

        var stale = new IntelligenceSdkException(
            "The refreshed Registry snapshot is unavailable.",
            "LEARNING_REGISTRY_STALE",
            sdk.Category == "validation" ? "integrity" : sdk.Category,
            sdk.Retryable,
            sdk.Status,
            sdk.RequestId,
            sdk.TraceId,
            sdk);
        return new Failure(
            SkillRegistryStatus.Stale,
            stale,
            stale.Category == "integrity" ? "integrity" : "transient");
    }

    private static bool IsDenied(IntelligenceSdkException error) =>
        error.Code.StartsWith("INTELLIGENCE_ADAPTER_", StringComparison.Ordinal) ||
        error.Code == "LEARNING_TELEMETRY_SINK_FAILED" ||
        error.Code is "LEARNING_CONTAINER_ARCHIVED" or
            "LEARNING_CONTAINER_PROJECT_MISMATCH" or
            "LEARNING_CONTAINER_NOT_FOUND" or
            "LEARNING_REGISTRY_UNRECOVERABLE" ||
        error.Category is "auth" or "permission" or "not_found" ||
        error.Status is 401 or 403 or 404 or 410;

    private static bool IsScriptsPath(string path)
    {
        var normalized = path.Normalize(NormalizationForm.FormC).Replace('\\', '/');
        var first = normalized.Split('/', 2)[0];
        return string.Equals(first, "scripts", StringComparison.OrdinalIgnoreCase);
    }

    private static string RenderInstructions(IReadOnlyList<SkillRegistryContextRecord> records)
    {
        if (records.Count == 0)
        {
            return string.Empty;
        }

        var rendered = new List<string>(records.Count + 1)
        {
            "CopilotKit Intelligence Registry skills (verified, ordered):",
        };
        rendered.AddRange(records.Select(record =>
            $"<skill id=\"{record.SkillId}\" version=\"{record.VersionId}\" " +
            $"name={JsonSerializer.Serialize(record.Name)} description={JsonSerializer.Serialize(record.Description)}>\n" +
            $"{record.Text}</skill>"));
        return string.Join("\n\n", rendered);
    }

    private static SkillRegistrySnapshot CopyPublic(
        SkillRegistrySnapshot snapshot,
        SkillRegistryStatus status,
        IntelligenceSdkException? error) =>
        new(
            status,
            snapshot.Source,
            snapshot.RegistryRevision,
            snapshot.Skills,
            snapshot.Instructions,
            error);

    private long ElapsedMilliseconds(long started) => (long)Math.Round(
        _options.TimeProvider.GetElapsedTime(started, _options.TimeProvider.GetTimestamp()).TotalMilliseconds);

    private static string StatusName(SkillRegistryStatus status) => status.ToString().ToLowerInvariant();
    private static string SourceName(SkillRegistrySource source) => source.ToString().ToLowerInvariant();

    private static TaskCompletionSource NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static IntelligenceSdkException ValidationError(
        string message,
        string code,
        string category = "validation",
        Exception? innerException = null) =>
        new(message, code, category, retryable: false, innerException: innerException);

    private static IntelligenceSdkException StaleError() => new(
        "The skill registry is not ready.",
        "LEARNING_REGISTRY_STALE",
        "availability",
        retryable: true);

    private static IntelligenceSdkException ClosedError() => new(
        "The skill registry is closed.",
        "LEARNING_REGISTRY_CLOSED",
        "lifecycle",
        retryable: false);

    private static IntelligenceSdkException TimeoutError() => new(
        "Timed out waiting for the skill registry to become ready.",
        "LEARNING_REGISTRY_READINESS_TIMEOUT",
        "availability",
        retryable: true);

    private sealed record RegistrySnapshot(
        SkillRegistrySnapshot Public,
        InstalledSkillSet? Installed,
        long? LastAttemptTimestamp,
        long? LastSuccessTimestamp)
    {
        internal static RegistrySnapshot Cold { get; } = new(
            new SkillRegistrySnapshot(
                SkillRegistryStatus.Cold,
                SkillRegistrySource.None,
                null,
                EmptySkills,
                string.Empty,
                null),
            null,
            null,
            null);
    }

    private sealed record Failure(
        SkillRegistryStatus Status,
        IntelligenceSdkException Error,
        string Reason);
}
