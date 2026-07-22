using System.Reflection;
using System.Text.Json;
using CopilotKit.Intelligence;
using Microsoft.Agents.AI;
using Xunit;

namespace CopilotKit.Intelligence.AgentFramework.Tests;

public sealed class ConformanceTests
{
    private static readonly string CorpusPath = FindCorpusPath();

    public static IEnumerable<object[]> ConformanceCases()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(CorpusPath));
        foreach (var item in document.RootElement.GetProperty("cases").EnumerateArray())
        {
            yield return [item.GetProperty("name").GetString()!, item.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(ConformanceCases))]
    public async Task AdapterConformance(string name, string caseJson)
    {
        using var document = JsonDocument.Parse(caseJson);
        var caseElement = document.RootElement;
        Assert.Equal(name, caseElement.GetProperty("name").GetString());
        var initial = caseElement.GetProperty("initialSnapshot");
        var operations = caseElement.GetProperty("operations");
        var expected = caseElement.GetProperty("expected");
        var root = TestSkillSets.NewRoot();
        Directory.CreateDirectory(root);
        try
        {
            var client = new FakeRegistryClient();
            var clock = new FakeTimeProvider();
            var telemetry = new List<TelemetryRecord>();
            var captureTelemetry = false;
            var baseline = 0L;
            var sinkFailure = new InvalidOperationException("sink-exception-1");
            var failTelemetryOnce = OperationsContain(operations, "telemetry-write");
            await using var provider = new SkillRegistryContextProvider(
                client,
                TestSkillSets.ContainerId,
                new SkillRegistryContextProviderOptions
                {
                    TimeProvider = clock,
                    Telemetry = (eventName, metadata, cancellationToken) =>
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        if (captureTelemetry && failTelemetryOnce && eventName == "status.changed" &&
                            metadata.TryGetValue("status", out var status) && status is "ready" or "revoked")
                        {
                            failTelemetryOnce = false;
                            return ValueTask.FromException(sinkFailure);
                        }

                        if (captureTelemetry)
                        {
                            telemetry.Add(new TelemetryRecord(
                                eventName,
                                clock.Milliseconds - baseline,
                                metadata));
                        }

                        return ValueTask.CompletedTask;
                    },
                });

            await SeedInitialSnapshotAsync(provider, client, clock, initial, root);
            AssertInitialSnapshot(provider.Snapshot, initial);
            client.NetworkCalls.Clear();
            client.CachedCalls.Clear();
            telemetry.Clear();
            baseline = clock.Milliseconds;
            captureTelemetry = true;

            var outcomes = BuildOutcomes(caseElement, root);
            var futures = outcomes.Select(_ =>
                new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously)).ToArray();
            var expectedClientCalls = expected.GetProperty("calls").GetProperty("client");
            var useCached = expectedClientCalls.GetProperty("getCached").GetInt32() > 0;
            foreach (var future in futures)
            {
                (useCached ? client.CachedOutcomes : client.NetworkOutcomes)
                    .Enqueue(_ => future.Task);
            }

            var previousStatus = StatusName(provider.Status);
            var transitions = new List<Transition>();
            var active = new List<Task<SkillRegistrySnapshot>>();
            var settled = new List<object>();
            object? readinessResult = null;
            var readinessCalls = 0;
            var outcomeIndex = 0;
            Func<Task<SkillRegistrySnapshot>>? delayedThrottleLoad = null;

            void Observe()
            {
                var current = StatusName(provider.Status);
                if (current != previousStatus)
                {
                    transitions.Add(new Transition(
                        clock.Milliseconds - baseline,
                        previousStatus,
                        current));
                    previousStatus = current;
                }
            }

            async Task SettleActiveAsync()
            {
                foreach (var task in active)
                {
                    try
                    {
                        settled.Add(await task.ConfigureAwait(false));
                    }
                    catch (Exception error)
                    {
                        settled.Add(error);
                    }
                }

                active.Clear();
                Observe();
            }

            async Task StartAsync(Task<SkillRegistrySnapshot> task, bool pump = true)
            {
                active.Add(task);
                if (!pump)
                {
                    return;
                }

                await PumpAsync();
                Observe();
                if (active.All(item => item.IsCompleted))
                {
                    await SettleActiveAsync();
                }
            }

            async Task<object> CheckReadinessAsync(TimeSpan? timeout = null)
            {
                readinessCalls++;
                try
                {
                    return await provider.WaitUntilReadyAsync(timeout).ConfigureAwait(false);
                }
                catch (Exception error)
                {
                    return error;
                }
            }

            var operationArray = operations.EnumerateArray().ToArray();
            for (var index = 0; index < operationArray.Length; index++)
            {
                var operation = operationArray[index];
                var kind = operation.GetProperty("kind").GetString()!;
                Assert.Contains(kind, KnownOperationKinds);
                clock.SetMilliseconds(baseline + operation.GetProperty("atMs").GetInt64());
                var nextKind = index + 1 < operationArray.Length
                    ? operationArray[index + 1].GetProperty("kind").GetString()
                    : null;
                switch (kind)
                {
                    case "load" when nextKind == "throttle-hit":
                        delayedThrottleLoad = () => provider.LoadAsync();
                        break;
                    case "load":
                    case "load-caller-a":
                    case "load-caller-b":
                    case "registry-request":
                        await StartAsync(provider.LoadAsync());
                        break;
                    case "cached-preload":
                        await StartAsync(provider.PreloadCachedAsync());
                        break;
                    case "throttle-check":
                        await StartAsync(provider.LoadAsync());
                        break;
                    case "throttle-hit":
                        Assert.NotNull(delayedThrottleLoad);
                        await StartAsync(delayedThrottleLoad());
                        delayedThrottleLoad = null;
                        break;
                    case "close":
                        await provider.DisposeAsync();
                        Observe();
                        break;
                    case "readiness" when nextKind != "timeout":
                        readinessResult = await CheckReadinessAsync();
                        break;
                    case "timeout":
                        readinessResult = await CheckReadinessAsync(TimeSpan.FromMilliseconds(1));
                        break;
                }

                var terminal = index == operationArray.Length - 1 ||
                    (kind == "transient-failure" && outcomes.Count == 2);
                if (terminal && outcomeIndex < outcomes.Count)
                {
                    var outcome = outcomes[outcomeIndex];
                    var future = futures[outcomeIndex];
                    outcomeIndex++;
                    if (outcome is Exception error)
                    {
                        future.SetException(error);
                    }
                    else
                    {
                        future.SetResult((InstalledSkillSet)outcome);
                    }

                    await PumpAsync();
                    await SettleActiveAsync();
                }
            }

            await SettleActiveAsync();
            Assert.Equal(outcomes.Count, outcomeIndex);
            Assert.All(futures, future => Assert.True(future.Task.IsCompleted));
            readinessResult ??= await CheckReadinessAsync();

            AssertReadiness(readinessResult, expected.GetProperty("readiness"));
            Assert.Equal(
                expected.GetProperty("calls").GetProperty("routing").GetProperty("readiness").GetInt32(),
                readinessCalls);
            Assert.Equal(expectedClientCalls.GetProperty("get").GetInt32(), client.NetworkCalls.Count);
            Assert.Equal(expectedClientCalls.GetProperty("getCached").GetInt32(), client.CachedCalls.Count);
            AssertDeclaredGenericCalls(operationArray, expectedClientCalls);
            AssertGenericResult(provider.Snapshot, readinessResult, expected.GetProperty("genericSdk"));
            AssertTransitions(transitions, expected.GetProperty("statusTransitions"));
            AssertTelemetry(telemetry, expected);
            if (name == "readiness-stale-rejects")
            {
                Assert.Equal(initial.GetProperty("skillCount").GetInt32(), provider.Snapshot.Skills.Count);
            }
            else
            {
                AssertRenderedRecords(provider.Snapshot.Skills, expected.GetProperty("renderedRecords"));
            }

            var nativeProceed = expected.GetProperty("nativeHook").GetProperty("proceed").GetBoolean();
            if (nativeProceed)
            {
                var nativeContext = await InvokeNativeAsync(provider);
                AssertRenderedInstructions(nativeContext.Instructions, expected.GetProperty("renderedRecords"));
            }
            else
            {
                await Assert.ThrowsAsync<IntelligenceSdkException>(() => InvokeNativeAsync(provider));
            }

            Assert.Equal(
                1,
                expected.GetProperty("calls").GetProperty("routing").GetProperty("nativeHook").GetInt32());

            if (expected.TryGetProperty("singleflight", out var singleflight))
            {
                Assert.Equal(singleflight.GetProperty("registryCalls").GetInt32(), client.NetworkCalls.Count);
                Assert.Equal(singleflight.GetProperty("callers").GetArrayLength(), settled.Count);
                Assert.Same(settled[0], settled[1]);
                var sharedFailure = Assert.IsType<IntelligenceSdkException>(settled[0]);
                Assert.Same(sinkFailure, sharedFailure.InnerException);
            }
            else if (operationArray.Length >= 2 &&
                     operationArray[0].GetProperty("kind").GetString() == "load-caller-a" &&
                     operationArray[1].GetProperty("kind").GetString() == "load-caller-b")
            {
                Assert.Equal(2, settled.Count);
                Assert.Same(settled[0], settled[1]);
            }
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task SeedInitialSnapshotAsync(
        SkillRegistryContextProvider provider,
        FakeRegistryClient client,
        FakeTimeProvider clock,
        JsonElement initial,
        string root)
    {
        var status = initial.GetProperty("status").GetString();
        if (status == "cold")
        {
            return;
        }

        var source = initial.GetProperty("source").GetString();
        var seed = TestSkillSets.Create(
            Path.Combine(root, "initial"),
            freshness: source == "fresh" ? CacheFreshness.Fresh : CacheFreshness.Cached,
            registryRevision: initial.GetProperty("registryRevision").GetString() ?? "revision-1");
        if (status is "ready" or "stale")
        {
            if (source == "fresh")
            {
                client.NetworkOutcomes.Enqueue(_ => Task.FromResult(seed));
                await provider.PreloadAsync();
            }
            else
            {
                client.CachedOutcomes.Enqueue(_ => Task.FromResult(seed));
                await provider.PreloadCachedAsync();
            }
        }

        if (initial.GetProperty("refreshDue").GetBoolean())
        {
            clock.Advance(TimeSpan.FromSeconds(30));
        }

        if (status == "stale")
        {
            clock.Advance(TimeSpan.FromSeconds(30));
            client.NetworkOutcomes.Enqueue(_ => Task.FromException<InstalledSkillSet>(
                ErrorFrom(initial.GetProperty("error"))));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.LoadAsync());
        }
        else if (status == "denied")
        {
            client.NetworkOutcomes.Enqueue(_ => Task.FromException<InstalledSkillSet>(
                ErrorFrom(initial.GetProperty("error"))));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.PreloadAsync());
        }
    }

    private static void AssertInitialSnapshot(SkillRegistrySnapshot snapshot, JsonElement initial)
    {
        Assert.Equal(initial.GetProperty("status").GetString(), StatusName(snapshot.Status));
        Assert.Equal(initial.GetProperty("source").GetString(), SourceName(snapshot.Source));
        Assert.Equal(initial.GetProperty("registryRevision").GetString(), snapshot.RegistryRevision);
        Assert.Equal(initial.GetProperty("skillCount").GetInt32(), snapshot.Skills.Count);
        Assert.Equal(
            initial.GetProperty("aggregateByteLength").GetInt32(),
            snapshot.Skills.Sum(record => record.ByteLength));
        _ = initial.GetProperty("lastAttemptAt");
        _ = initial.GetProperty("refreshDue").GetBoolean();
    }

    private static List<object> BuildOutcomes(JsonElement caseElement, string root)
    {
        var expected = caseElement.GetProperty("expected");
        var operations = caseElement.GetProperty("operations");
        var expectedCalls = expected.GetProperty("calls").GetProperty("client");
        var count = expectedCalls.GetProperty("get").GetInt32() + expectedCalls.GetProperty("getCached").GetInt32();
        if (count == 0)
        {
            return [];
        }

        if (count == 2)
        {
            return
            [
                new IntelligenceSdkException("transient-1", "UPSTREAM_UNAVAILABLE", "availability", retryable: true),
                CreateExpectedSet(caseElement, Path.Combine(root, "outcome-2")),
            ];
        }

        if (OperationsContain(operations, "transient-failure"))
        {
            return [new IntelligenceSdkException("transient-1", "UPSTREAM_UNAVAILABLE", "availability", retryable: true)];
        }

        if (OperationsContain(operations, "integrity-failure"))
        {
            return [new IntelligenceSdkException("integrity-1", IntelligenceErrorCodes.BlobIntegrityFailure, "integrity", retryable: false)];
        }

        var adapterValidation = new[]
        {
            "validate-count",
            "validate-instruction-bytes",
            "validate-aggregate-bytes",
            "decode-instruction",
            "reject-script",
        }.Any(kind => OperationsContain(operations, kind));
        var generic = expected.GetProperty("genericSdk");
        if (generic.TryGetProperty("error", out var genericError) && !adapterValidation &&
            !OperationsContain(operations, "telemetry-write"))
        {
            return [ErrorFrom(genericError)];
        }

        return [CreateExpectedSet(caseElement, Path.Combine(root, "outcome-1"))];
    }

    private static InstalledSkillSet CreateExpectedSet(JsonElement caseElement, string root)
    {
        var operations = caseElement.GetProperty("operations");
        var expected = caseElement.GetProperty("expected");
        var generic = expected.GetProperty("genericSdk");
        var result = generic.TryGetProperty("result", out var resultValue) ? resultValue : default;
        var freshness = result.ValueKind == JsonValueKind.Object &&
                        result.TryGetProperty("freshness", out var freshnessValue) &&
                        freshnessValue.GetString() == "cached"
            ? CacheFreshness.Cached
            : CacheFreshness.Fresh;
        var revision = result.ValueKind == JsonValueKind.Object &&
                       result.TryGetProperty("registryRevision", out var revisionValue)
            ? revisionValue.GetString() ?? "revision-1"
            : "revision-1";
        if (OperationsContain(operations, "validate-count"))
        {
            return TestSkillSets.CreateMany(root, Enumerable.Repeat("# Skill\n", 129).ToArray(), freshness, registryRevision: revision);
        }

        if (OperationsContain(operations, "validate-instruction-bytes"))
        {
            return TestSkillSets.Create(root, new string('x', 262_145), freshness, registryRevision: revision);
        }

        if (OperationsContain(operations, "validate-aggregate-bytes"))
        {
            return TestSkillSets.CreateMany(
                root,
                [new string('x', 209_715), new string('x', 209_715), new string('x', 209_715), new string('x', 209_715), new string('x', 209_717)],
                freshness,
                registryRevision: revision);
        }

        if (OperationsContain(operations, "reject-script"))
        {
            return TestSkillSets.Create(root, role: "script", freshness: freshness, registryRevision: revision);
        }

        var revoked = OperationsContain(operations, "revocation-observed");
        var records = expected.GetProperty("renderedRecords");
        var texts = records.EnumerateArray().Select(record => record.GetProperty("text").GetString()!).ToArray();
        if (OperationsContain(operations, "decode-instruction") && texts.Length == 0)
        {
            texts = ["# Skill\n"];
        }
        var set = TestSkillSets.CreateMany(root, texts, freshness, revoked, registryRevision: revision);
        if (OperationsContain(operations, "decode-instruction"))
        {
            File.WriteAllBytes(Path.Combine(set.Skills[0].Directory, "SKILL.md"), [0xff]);
        }

        return set;
    }

    private static IntelligenceSdkException ErrorFrom(JsonElement fields) => new(
        fields.TryGetProperty("causeIdentity", out var cause) ? cause.GetString()! : fields.GetProperty("code").GetString()!,
        fields.GetProperty("code").GetString()!,
        fields.GetProperty("category").GetString()!,
        fields.GetProperty("retryable").GetBoolean(),
        fields.TryGetProperty("httpStatus", out var status) ? status.GetInt32() : null,
        fields.TryGetProperty("requestId", out var requestId) ? requestId.GetString() : null,
        fields.TryGetProperty("traceId", out var traceId) ? traceId.GetString() : null);

    private static void AssertReadiness(object actual, JsonElement expected)
    {
        if (expected.TryGetProperty("result", out var result))
        {
            var snapshot = Assert.IsType<SkillRegistrySnapshot>(actual);
            Assert.Equal(result.GetProperty("state").GetString(), StatusName(snapshot.Status));
        }
        else
        {
            AssertError(Assert.IsType<IntelligenceSdkException>(actual), expected.GetProperty("error"));
        }
    }

    private static void AssertGenericResult(
        SkillRegistrySnapshot snapshot,
        object readiness,
        JsonElement expected)
    {
        if (expected.TryGetProperty("result", out var result))
        {
            Assert.Equal(result.GetProperty("state").GetString(), StatusName(snapshot.Status));
            if (result.TryGetProperty("freshness", out var freshness))
            {
                if (freshness.GetString() == "stale")
                {
                    Assert.Equal("stale", StatusName(snapshot.Status));
                }
                else
                {
                    Assert.Equal(freshness.GetString(), SourceName(snapshot.Source));
                }
                Assert.Equal(result.GetProperty("registryRevision").GetString(), snapshot.RegistryRevision);
                Assert.Equal(result.GetProperty("skillCount").GetInt32(), snapshot.Skills.Count);
                Assert.Equal(result.GetProperty("aggregateByteLength").GetInt32(), snapshot.Skills.Sum(record => record.ByteLength));
            }
            else if (result.TryGetProperty("closeCount", out var closeCount))
            {
                Assert.Equal(1, closeCount.GetInt32());
            }
        }
        else
        {
            AssertError(Assert.IsType<IntelligenceSdkException>(readiness), expected.GetProperty("error"));
        }
    }

    private static void AssertDeclaredGenericCalls(
        IReadOnlyList<JsonElement> operations,
        JsonElement expected)
    {
        var kinds = operations.Select(operation => operation.GetProperty("kind").GetString()!).ToArray();
        var projection = kinds.Count(kind => kind is "projection-request" or "conditional-projection-request" or "registry-request");
        var bundle = kinds.Count(kind => kind == "bundle-request");
        var cached = kinds.Count(kind => kind is "cache-read" or "cached-preload");
        Assert.Equal(expected.GetProperty("projection").GetInt32(), projection);
        Assert.Equal(expected.GetProperty("bundle").GetInt32(), bundle);
        Assert.Equal(expected.GetProperty("cached").GetInt32(), cached);
        Assert.Equal(expected.GetProperty("network").GetInt32(), projection + bundle);
    }

    private static void AssertTransitions(IReadOnlyList<Transition> actual, JsonElement expected)
    {
        var wanted = expected.EnumerateArray().ToArray();
        Assert.Equal(wanted.Length, actual.Count);
        for (var index = 0; index < wanted.Length; index++)
        {
            Assert.Equal(wanted[index].GetProperty("atMs").GetInt64(), actual[index].AtMs);
            Assert.Equal(wanted[index].GetProperty("from").GetString(), actual[index].From);
            Assert.Equal(wanted[index].GetProperty("to").GetString(), actual[index].To);
        }
    }

    private static void AssertTelemetry(IReadOnlyList<TelemetryRecord> actual, JsonElement expected)
    {
        var names = expected.GetProperty("telemetryNames").EnumerateArray().Select(item => item.GetString()).ToArray();
        Assert.Equal(names, actual.Select(record => record.Name));
        var records = expected.GetProperty("telemetryRecords").EnumerateArray().ToArray();
        Assert.Equal(records.Length, actual.Count);
        for (var index = 0; index < records.Length; index++)
        {
            var wanted = records[index];
            var wantedName = wanted.GetProperty("name").GetString();
            var wantedAt = wanted.GetProperty("atMs").GetInt64();
            Assert.Equal($"{wantedName}@{wantedAt}", $"{actual[index].Name}@{actual[index].AtMs}");
            Assert.Equal("agent-framework-dotnet", actual[index].Metadata["framework"]);
            foreach (var property in wanted.GetProperty("metadata").EnumerateObject())
            {
                if (property.Name == "framework")
                {
                    continue;
                }

                Assert.True(actual[index].Metadata.TryGetValue(property.Name, out var value), $"Missing telemetry field {property.Name}.");
                AssertJsonValue(value, property.Value);
            }
        }
    }

    private static void AssertRenderedRecords(
        IReadOnlyList<SkillRegistryContextRecord> actual,
        JsonElement expected)
    {
        var records = expected.EnumerateArray().ToArray();
        Assert.Equal(records.Length, actual.Count);
        for (var index = 0; index < records.Length; index++)
        {
            var wanted = records[index];
            Assert.Equal(wanted.GetProperty("position").GetInt32(), actual[index].Position);
            Assert.Equal(wanted.GetProperty("kind").GetString(), actual[index].Kind);
            Assert.Equal(wanted.GetProperty("name").GetString(), actual[index].Name);
            Assert.Equal(wanted.GetProperty("text").GetString(), actual[index].Text);
            Assert.Equal(wanted.GetProperty("byteLength").GetInt32(), actual[index].ByteLength);
            Assert.Equal(wanted.GetProperty("skillId").GetString(), actual[index].SkillId);
            Assert.Equal(wanted.GetProperty("versionId").GetString(), actual[index].VersionId);
            Assert.Equal(
                wanted.GetProperty("description").ValueKind == JsonValueKind.Null
                    ? null
                    : wanted.GetProperty("description").GetString(),
                actual[index].Description);
        }
    }

    private static void AssertRenderedInstructions(string? instructions, JsonElement records)
    {
        if (records.GetArrayLength() == 0)
        {
            Assert.True(string.IsNullOrEmpty(instructions));
            return;
        }

        Assert.NotNull(instructions);
        var cursor = -1;
        foreach (var record in records.EnumerateArray())
        {
            var text = record.GetProperty("text").GetString()!;
            var next = instructions.IndexOf(text, cursor + 1, StringComparison.Ordinal);
            Assert.True(next > cursor);
            Assert.Contains(record.GetProperty("skillId").GetString()!, instructions, StringComparison.Ordinal);
            Assert.Contains(record.GetProperty("versionId").GetString()!, instructions, StringComparison.Ordinal);
            cursor = next;
        }
    }

    private static void AssertError(IntelligenceSdkException actual, JsonElement expected)
    {
        Assert.Equal(expected.GetProperty("code").GetString(), actual.Code);
        Assert.Equal(expected.GetProperty("category").GetString(), actual.Category);
        Assert.Equal(expected.GetProperty("retryable").GetBoolean(), actual.Retryable);
        if (expected.TryGetProperty("httpStatus", out var status))
        {
            Assert.Equal(status.GetInt32(), actual.Status);
        }

        if (expected.TryGetProperty("requestId", out var requestId))
        {
            Assert.Equal(requestId.GetString(), actual.RequestId);
        }

        if (expected.TryGetProperty("traceId", out var traceId))
        {
            Assert.Equal(traceId.GetString(), actual.TraceId);
        }
    }

    private static void AssertJsonValue(object? actual, JsonElement expected)
    {
        switch (expected.ValueKind)
        {
            case JsonValueKind.String:
                Assert.Equal(expected.GetString(), actual?.ToString());
                break;
            case JsonValueKind.Number:
                Assert.Equal(expected.GetInt64(), Convert.ToInt64(actual));
                break;
            case JsonValueKind.True:
            case JsonValueKind.False:
                Assert.Equal(expected.GetBoolean(), Convert.ToBoolean(actual));
                break;
            case JsonValueKind.Null:
                Assert.Null(actual);
                break;
            default:
                throw new InvalidOperationException($"Unsupported expected metadata value {expected.ValueKind}.");
        }
    }

    private static async Task<AIContext> InvokeNativeAsync(SkillRegistryContextProvider provider)
    {
        var method = typeof(SkillRegistryContextProvider).GetMethod(
            "ProvideAIContextAsync",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(method);
        var pending = Assert.IsType<ValueTask<AIContext>>(method.Invoke(provider, [null, CancellationToken.None]));
        return await pending;
    }

    private static bool OperationsContain(JsonElement operations, string kind) =>
        operations.EnumerateArray().Any(operation => operation.GetProperty("kind").GetString() == kind);

    private static async Task PumpAsync()
    {
        for (var index = 0; index < 12; index++)
        {
            await Task.Yield();
        }
    }

    private static string StatusName(SkillRegistryStatus status) => status.ToString().ToLowerInvariant();
    private static string SourceName(SkillRegistrySource source) => source.ToString().ToLowerInvariant();

    private static string FindCorpusPath()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "packages", "intelligence", "conformance", "registry-adapters-v1.json");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("Could not locate registry-adapters-v1.json.");
    }

    private static readonly string[] KnownOperationKinds =
    [
        "load",
        "load-caller-a",
        "load-caller-b",
        "cached-preload",
        "registry-request",
        "throttle-check",
        "throttle-hit",
        "close",
        "readiness",
        "timeout",
        "projection-request",
        "conditional-projection-request",
        "bundle-request",
        "cache-read",
        "render",
        "not-modified",
        "changed-projection",
        "revocation-observed",
        "transient-failure",
        "integrity-failure",
        "denial-response",
        "validate-count",
        "validate-instruction-bytes",
        "validate-aggregate-bytes",
        "decode-instruction",
        "reject-script",
        "telemetry-write",
        "registry-error",
        "http-response",
        "canonical-error",
    ];

    private sealed record TelemetryRecord(
        string Name,
        long AtMs,
        IReadOnlyDictionary<string, object?> Metadata);

    private sealed record Transition(long AtMs, string From, string To);
}
