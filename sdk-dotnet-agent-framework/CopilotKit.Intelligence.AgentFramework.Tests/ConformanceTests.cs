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

    [Fact]
    public void CorpusEnvelopeAndFixturesAreConsumedExactly()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(CorpusPath));
        var root = document.RootElement;
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("registry-adapters-v1", root.GetProperty("contractVersion").GetString());
        Assert.Equal("registry-sdk-v1.json", root.GetProperty("sourceCorpus").GetString());

        var distribution = root.GetProperty("distribution");
        Assert.True(distribution.GetProperty("repositoryTestOnly").GetBoolean());
        Assert.False(distribution.GetProperty("publishedExport").GetBoolean());
        Assert.False(distribution.GetProperty("runtimeDependency").GetBoolean());

        var fixtures = root.GetProperty("fixtures");
        Assert.Equal(TestSkillSets.RegistryRevision, fixtures.GetProperty("registryRevision").GetString());
        Assert.Equal(TestSkillSets.ChangedRegistryRevision, fixtures.GetProperty("changedRegistryRevision").GetString());
        Assert.Equal("registry-1", fixtures.GetProperty("etag").GetString());
        Assert.Equal("b86e5ce15092417a26042e892be2341121fc287e6215a49134448fe0e248cf0c", fixtures.GetProperty("bundleSha256").GetString());
        Assert.Equal(144, fixtures.GetProperty("bundleByteLength").GetInt32());
        Assert.Equal("# Skill\n", fixtures.GetProperty("instructionText").GetString());
        Assert.Equal(8, fixtures.GetProperty("instructionByteLength").GetInt32());
        Assert.Equal(TestSkillSets.ContainerId, fixtures.GetProperty("learningContainerId").GetString());
        Assert.Equal(TestSkillSets.SkillId, fixtures.GetProperty("skillId").GetString());
        Assert.Equal(TestSkillSets.VersionId, fixtures.GetProperty("versionId").GetString());
        Assert.Equal(0, fixtures.GetProperty("skillPosition").GetInt32());
        Assert.Equal(TestSkillSets.SkillName, fixtures.GetProperty("skillName").GetString());
        Assert.Equal(JsonValueKind.Null, fixtures.GetProperty("skillDescription").ValueKind);

        var limits = fixtures.GetProperty("limits");
        var options = new SkillRegistryContextProviderOptions();
        Assert.Equal(options.RefreshInterval.TotalMilliseconds, limits.GetProperty("throttleWindowMs").GetInt32());
        Assert.Equal(options.MaximumSkills, limits.GetProperty("maximumSkills").GetInt32());
        Assert.Equal(options.MaximumSkillBytes, limits.GetProperty("maximumInstructionBytes").GetInt32());
        Assert.Equal(options.MaximumContextBytes, limits.GetProperty("maximumAggregateBytes").GetInt32());

        var denialSources = root.GetProperty("cases").EnumerateArray()
            .Where(item => item.TryGetProperty("permanentDenialSource", out _))
            .Select(item => item.GetProperty("permanentDenialSource").GetString())
            .ToArray();
        Assert.Equal(10, denialSources.Length);
        Assert.Equal(denialSources.Length, denialSources.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void CorpusLeafFieldConsumptionCannotDriftSilently()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(CorpusPath));
        var actual = new HashSet<string>(StringComparer.Ordinal);
        CollectLeafPaths(document.RootElement, string.Empty, actual);
        Assert.Equal(ConsumedCorpusLeafPaths.Order(StringComparer.Ordinal), actual.Order(StringComparer.Ordinal));
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
        var identities = new IdentityMap();
        var root = TestSkillSets.NewRoot();
        Directory.CreateDirectory(root);
        try
        {
            var client = new FakeRegistryClient();
            var initialLastAttempt = initial.GetProperty("lastAttemptAt");
            var clock = new FakeTimeProvider(
                initial.GetProperty("status").GetString() == "stale" && initialLastAttempt.ValueKind == JsonValueKind.Number
                    ? initialLastAttempt.GetInt64() - 30_000
                    : 0);
            var telemetry = new List<TelemetryRecord>();
            var captureTelemetry = false;
            var baseline = 0L;
            var sinkFailure = new IntelligenceSdkException(
                "sink-exception-1",
                "LEARNING_TELEMETRY_SINK_FAILED",
                "internal",
                retryable: false);
            var failTelemetryOnce = OperationsContain(operations, "telemetry-write");
            if (expected.TryGetProperty("singleflight", out var expectedSingleflight))
            {
                identities.Assert(
                    expectedSingleflight.GetProperty("sinkExceptionIdentity").GetString()!,
                    sinkFailure);
            }
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

            await SeedInitialSnapshotAsync(provider, client, clock, initial, root, identities);
            AssertInitialSnapshot(provider, clock, initial);
            client.NetworkCalls.Clear();
            client.CachedCalls.Clear();
            telemetry.Clear();
            baseline = clock.Milliseconds;
            captureTelemetry = true;

            var outcomes = BuildOutcomes(caseElement, root, identities);
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

            async Task StartAsync(
                Task<SkillRegistrySnapshot> task,
                int callsAtStart,
                int telemetryAtStart)
            {
                active.Add(task);
                await WaitForProgressAsync(() =>
                    task.IsCompleted ||
                    client.NetworkCalls.Count + client.CachedCalls.Count > callsAtStart ||
                    telemetry.Count > telemetryAtStart);
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
                var callsBefore = client.NetworkCalls.Count + client.CachedCalls.Count;
                var telemetryBefore = telemetry.Count;
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
                        await StartAsync(provider.LoadAsync(), callsBefore, telemetryBefore);
                        break;
                    case "cached-preload":
                        await StartAsync(provider.PreloadCachedAsync(), callsBefore, telemetryBefore);
                        break;
                    case "throttle-check":
                        await StartAsync(provider.LoadAsync(), callsBefore, telemetryBefore);
                        break;
                    case "throttle-hit":
                        Assert.NotNull(delayedThrottleLoad);
                        await StartAsync(delayedThrottleLoad(), callsBefore, telemetryBefore);
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

                if (operation.TryGetProperty("networkCall", out var networkCall))
                {
                    Assert.Equal(
                        networkCall.GetBoolean(),
                        client.NetworkCalls.Count + client.CachedCalls.Count > callsBefore);
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

            AssertReadiness(readinessResult, expected.GetProperty("readiness"), identities);
            Assert.Equal(
                expected.GetProperty("calls").GetProperty("routing").GetProperty("readiness").GetInt32(),
                readinessCalls);
            Assert.Equal(expectedClientCalls.GetProperty("get").GetInt32(), client.NetworkCalls.Count);
            Assert.Equal(expectedClientCalls.GetProperty("getCached").GetInt32(), client.CachedCalls.Count);
            AssertDeclaredGenericCalls(operationArray, expectedClientCalls);
            AssertGenericResult(provider, readinessResult, expected.GetProperty("genericSdk"), identities);
            AssertTransitions(transitions, expected.GetProperty("statusTransitions"));
            AssertTelemetry(telemetry, expected);
            if (provider.Status == SkillRegistryStatus.Stale &&
                expected.GetProperty("renderedRecords").GetArrayLength() == 0)
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
                var barrier = singleflight.GetProperty("barrier").GetString();
                var barrierOperations = operationArray
                    .Where(operation => operation.TryGetProperty("barrier", out _))
                    .ToArray();
                Assert.NotEmpty(barrierOperations);
                Assert.All(
                    barrierOperations,
                    operation => Assert.Equal(barrier, operation.GetProperty("barrier").GetString()));
                Assert.Equal(singleflight.GetProperty("registryCalls").GetInt32(), client.NetworkCalls.Count);
                var callers = singleflight.GetProperty("callers").EnumerateArray().ToArray();
                Assert.Equal(callers.Length, settled.Count);
                for (var callerIndex = 0; callerIndex < callers.Length; callerIndex++)
                {
                    var caller = callers[callerIndex];
                    Assert.Equal(
                        $"caller-{(char)('a' + callerIndex)}",
                        caller.GetProperty("name").GetString());
                    var rejection = Assert.IsType<IntelligenceSdkException>(settled[callerIndex]);
                    identities.Assert(caller.GetProperty("rejectionIdentity").GetString()!, rejection);
                    identities.Assert(
                        caller.GetProperty("causeIdentity").GetString()!,
                        rejection.InnerException ?? rejection);
                }
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
        string root,
        IdentityMap identities)
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
                ErrorFrom(initial.GetProperty("error"), identities)));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.LoadAsync());
        }
        else if (status == "denied")
        {
            client.NetworkOutcomes.Enqueue(_ => Task.FromException<InstalledSkillSet>(
                ErrorFrom(initial.GetProperty("error"), identities)));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.PreloadAsync());
        }
    }

    private static void AssertInitialSnapshot(
        SkillRegistryContextProvider provider,
        FakeTimeProvider clock,
        JsonElement initial)
    {
        var snapshot = provider.Snapshot;
        Assert.Equal(initial.GetProperty("status").GetString(), StatusName(snapshot.Status));
        Assert.Equal(initial.GetProperty("source").GetString(), SourceName(snapshot.Source));
        Assert.Equal(initial.GetProperty("registryRevision").GetString(), snapshot.RegistryRevision);
        Assert.Equal(initial.GetProperty("skillCount").GetInt32(), snapshot.Skills.Count);
        Assert.Equal(
            initial.GetProperty("aggregateByteLength").GetInt32(),
            snapshot.Skills.Sum(record => record.ByteLength));
        var lastAttempt = initial.GetProperty("lastAttemptAt");
        Assert.Equal(
            lastAttempt.ValueKind == JsonValueKind.Null ? null : lastAttempt.GetInt64(),
            provider.LastAttemptTimestamp);
        var refreshDue = provider.LastAttemptTimestamp is long attempted &&
            clock.GetElapsedTime(attempted, clock.GetTimestamp()) >= TimeSpan.FromSeconds(30);
        Assert.Equal(initial.GetProperty("refreshDue").GetBoolean(), refreshDue);
    }

    private static List<object> BuildOutcomes(
        JsonElement caseElement,
        string root,
        IdentityMap identities)
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
                identities.Record(
                    "transient-1",
                    new IntelligenceSdkException("transient-1", "UPSTREAM_UNAVAILABLE", "availability", retryable: true)),
                CreateExpectedSet(caseElement, Path.Combine(root, "outcome-2")),
            ];
        }

        if (OperationsContain(operations, "transient-failure"))
        {
            return
            [
                identities.Record(
                    "transient-1",
                    new IntelligenceSdkException("transient-1", "UPSTREAM_UNAVAILABLE", "availability", retryable: true)),
            ];
        }

        if (OperationsContain(operations, "integrity-failure"))
        {
            return
            [
                identities.Record(
                    "integrity-1",
                    new IntelligenceSdkException("integrity-1", IntelligenceErrorCodes.BlobIntegrityFailure, "integrity", retryable: false)),
            ];
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
        if (caseElement.TryGetProperty("permanentDenialSource", out _))
        {
            return [PermanentDenialFrom(caseElement, identities)];
        }

        if (generic.TryGetProperty("error", out var genericError) && !adapterValidation &&
            !OperationsContain(operations, "telemetry-write"))
        {
            return [ErrorFrom(genericError, identities)];
        }

        return [CreateExpectedSet(caseElement, Path.Combine(root, "outcome-1"))];
    }

    private static IntelligenceSdkException PermanentDenialFrom(
        JsonElement caseElement,
        IdentityMap identities)
    {
        var source = caseElement.GetProperty("permanentDenialSource").GetString()!;
        var expected = caseElement.GetProperty("expected").GetProperty("genericSdk").GetProperty("error");
        var identity = expected.GetProperty("causeIdentity").GetString()!;
        Assert.Equal(source, identity);
        var category = expected.GetProperty("category").GetString()!;
        var status = expected.TryGetProperty("httpStatus", out var expectedStatus)
            ? expectedStatus.GetInt32()
            : (int?)null;
        string code;
        if (source.StartsWith("error-category-", StringComparison.Ordinal))
        {
            code = "UPSTREAM_DENIED";
            Assert.Null(status);
        }
        else if (source.StartsWith("http-", StringComparison.Ordinal))
        {
            code = "UPSTREAM_HTTP_ERROR";
            var operationStatus = caseElement.GetProperty("operations").EnumerateArray()
                .Single(operation => operation.GetProperty("kind").GetString() == "http-response")
                .GetProperty("status")
                .GetInt32();
            Assert.Equal(status, operationStatus);
            Assert.Equal($"http-{operationStatus}", source);
        }
        else
        {
            code = expected.GetProperty("code").GetString()!;
        }

        return identities.Record(
            identity,
            new IntelligenceSdkException(
                identity,
                code,
                category,
                expected.GetProperty("retryable").GetBoolean(),
                status,
                expected.TryGetProperty("requestId", out var requestId) ? requestId.GetString() : null,
                expected.TryGetProperty("traceId", out var traceId) ? traceId.GetString() : null));
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
            var observed = OperationValue(operations, "validate-count", "observed");
            return TestSkillSets.CreateMany(
                root,
                Enumerable.Repeat("# Skill\n", observed).ToArray(),
                freshness,
                registryRevision: revision);
        }

        if (OperationsContain(operations, "validate-instruction-bytes"))
        {
            var observed = OperationValue(operations, "validate-instruction-bytes", "observed");
            return TestSkillSets.Create(root, new string('x', observed), freshness, registryRevision: revision);
        }

        if (OperationsContain(operations, "validate-aggregate-bytes"))
        {
            var observed = OperationValue(operations, "validate-aggregate-bytes", "observed");
            var chunk = observed / 5;
            return TestSkillSets.CreateMany(
                root,
                [
                    new string('x', chunk),
                    new string('x', chunk),
                    new string('x', chunk),
                    new string('x', chunk),
                    new string('x', observed - (chunk * 4)),
                ],
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

    private static IntelligenceSdkException ErrorFrom(JsonElement fields, IdentityMap identities)
    {
        var identity = fields.GetProperty("causeIdentity").GetString()!;
        return identities.Record(
            identity,
            new IntelligenceSdkException(
                identity,
                fields.GetProperty("code").GetString()!,
                fields.GetProperty("category").GetString()!,
                fields.GetProperty("retryable").GetBoolean(),
                fields.TryGetProperty("httpStatus", out var status) ? status.GetInt32() : null,
                fields.TryGetProperty("requestId", out var requestId) ? requestId.GetString() : null,
                fields.TryGetProperty("traceId", out var traceId) ? traceId.GetString() : null));
    }

    private static void AssertReadiness(object actual, JsonElement expected, IdentityMap identities)
    {
        if (expected.TryGetProperty("result", out var result))
        {
            var snapshot = Assert.IsType<SkillRegistrySnapshot>(actual);
            Assert.Equal(result.GetProperty("state").GetString(), StatusName(snapshot.Status));
        }
        else
        {
            AssertError(
                Assert.IsType<IntelligenceSdkException>(actual),
                expected.GetProperty("error"),
                identities);
        }
    }

    private static void AssertGenericResult(
        SkillRegistryContextProvider provider,
        object readiness,
        JsonElement expected,
        IdentityMap identities)
    {
        var snapshot = provider.Snapshot;
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
                Assert.Equal(closeCount.GetInt32(), provider.CloseCount);
            }
        }
        else
        {
            AssertError(
                Assert.IsType<IntelligenceSdkException>(readiness),
                expected.GetProperty("error"),
                identities);
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
            var expectedMetadata = wanted.GetProperty("metadata");
            var expectedKeys = expectedMetadata.EnumerateObject()
                .Select(property => property.Name)
                .Append("adapterVersion")
                .Order(StringComparer.Ordinal)
                .ToArray();
            Assert.Equal(
                expectedKeys,
                actual[index].Metadata.Keys.Order(StringComparer.Ordinal));
            Assert.False(string.IsNullOrWhiteSpace(actual[index].Metadata["adapterVersion"]?.ToString()));
            foreach (var property in expectedMetadata.EnumerateObject())
            {
                if (property.Name == "framework")
                {
                    Assert.Equal("agent-framework-dotnet", actual[index].Metadata["framework"]);
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

    private static void AssertError(
        IntelligenceSdkException actual,
        JsonElement expected,
        IdentityMap identities)
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

        identities.Assert(
            expected.GetProperty("causeIdentity").GetString()!,
            actual.InnerException ?? actual);
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

    private static int OperationValue(JsonElement operations, string kind, string property) =>
        operations.EnumerateArray()
            .Single(operation => operation.GetProperty("kind").GetString() == kind)
            .GetProperty(property)
            .GetInt32();

    private static async Task PumpAsync()
    {
        for (var index = 0; index < 12; index++)
        {
            await Task.Yield();
        }
    }

    private static async Task WaitForProgressAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        while (!condition())
        {
            await Task.Delay(1, timeout.Token);
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

    private static void CollectLeafPaths(
        JsonElement element,
        string path,
        ISet<string> paths)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                CollectLeafPaths(
                    property.Value,
                    path.Length == 0 ? property.Name : $"{path}.{property.Name}",
                    paths);
            }

            return;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                CollectLeafPaths(item, $"{path}.[]", paths);
            }

            return;
        }

        paths.Add(path);
    }

    private static readonly HashSet<string> ConsumedCorpusLeafPaths = new(StringComparer.Ordinal)
    {
        "cases.[].expected.calls.client.bundle",
        "cases.[].expected.calls.client.cached",
        "cases.[].expected.calls.client.get",
        "cases.[].expected.calls.client.getCached",
        "cases.[].expected.calls.client.network",
        "cases.[].expected.calls.client.projection",
        "cases.[].expected.calls.routing.nativeHook",
        "cases.[].expected.calls.routing.readiness",
        "cases.[].expected.genericSdk.error.category",
        "cases.[].expected.genericSdk.error.causeIdentity",
        "cases.[].expected.genericSdk.error.code",
        "cases.[].expected.genericSdk.error.httpStatus",
        "cases.[].expected.genericSdk.error.requestId",
        "cases.[].expected.genericSdk.error.retryable",
        "cases.[].expected.genericSdk.error.traceId",
        "cases.[].expected.genericSdk.result.aggregateByteLength",
        "cases.[].expected.genericSdk.result.closeCount",
        "cases.[].expected.genericSdk.result.freshness",
        "cases.[].expected.genericSdk.result.registryRevision",
        "cases.[].expected.genericSdk.result.skillCount",
        "cases.[].expected.genericSdk.result.state",
        "cases.[].expected.nativeHook.proceed",
        "cases.[].expected.readiness.error.category",
        "cases.[].expected.readiness.error.causeIdentity",
        "cases.[].expected.readiness.error.code",
        "cases.[].expected.readiness.error.httpStatus",
        "cases.[].expected.readiness.error.requestId",
        "cases.[].expected.readiness.error.retryable",
        "cases.[].expected.readiness.error.traceId",
        "cases.[].expected.readiness.result.state",
        "cases.[].expected.renderedRecords.[].byteLength",
        "cases.[].expected.renderedRecords.[].description",
        "cases.[].expected.renderedRecords.[].kind",
        "cases.[].expected.renderedRecords.[].name",
        "cases.[].expected.renderedRecords.[].position",
        "cases.[].expected.renderedRecords.[].skillId",
        "cases.[].expected.renderedRecords.[].text",
        "cases.[].expected.renderedRecords.[].versionId",
        "cases.[].expected.singleflight.barrier",
        "cases.[].expected.singleflight.callers.[].causeIdentity",
        "cases.[].expected.singleflight.callers.[].name",
        "cases.[].expected.singleflight.callers.[].rejectionIdentity",
        "cases.[].expected.singleflight.registryCalls",
        "cases.[].expected.singleflight.sinkExceptionIdentity",
        "cases.[].expected.statusTransitions.[].atMs",
        "cases.[].expected.statusTransitions.[].from",
        "cases.[].expected.statusTransitions.[].to",
        "cases.[].expected.telemetryNames.[]",
        "cases.[].expected.telemetryRecords.[].atMs",
        "cases.[].expected.telemetryRecords.[].metadata.errorCategory",
        "cases.[].expected.telemetryRecords.[].metadata.errorCode",
        "cases.[].expected.telemetryRecords.[].metadata.framework",
        "cases.[].expected.telemetryRecords.[].metadata.freshness",
        "cases.[].expected.telemetryRecords.[].metadata.joinedCallers",
        "cases.[].expected.telemetryRecords.[].metadata.outcome",
        "cases.[].expected.telemetryRecords.[].metadata.reason",
        "cases.[].expected.telemetryRecords.[].metadata.registryRevision",
        "cases.[].expected.telemetryRecords.[].metadata.requestId",
        "cases.[].expected.telemetryRecords.[].metadata.retryable",
        "cases.[].expected.telemetryRecords.[].metadata.skillCount",
        "cases.[].expected.telemetryRecords.[].metadata.source",
        "cases.[].expected.telemetryRecords.[].metadata.status",
        "cases.[].expected.telemetryRecords.[].metadata.traceId",
        "cases.[].expected.telemetryRecords.[].name",
        "cases.[].initialSnapshot.aggregateByteLength",
        "cases.[].initialSnapshot.error.category",
        "cases.[].initialSnapshot.error.causeIdentity",
        "cases.[].initialSnapshot.error.code",
        "cases.[].initialSnapshot.error.httpStatus",
        "cases.[].initialSnapshot.error.retryable",
        "cases.[].initialSnapshot.lastAttemptAt",
        "cases.[].initialSnapshot.refreshDue",
        "cases.[].initialSnapshot.registryRevision",
        "cases.[].initialSnapshot.skillCount",
        "cases.[].initialSnapshot.source",
        "cases.[].initialSnapshot.status",
        "cases.[].name",
        "cases.[].operations.[].atMs",
        "cases.[].operations.[].barrier",
        "cases.[].operations.[].kind",
        "cases.[].operations.[].networkCall",
        "cases.[].operations.[].observed",
        "cases.[].operations.[].status",
        "cases.[].permanentDenialSource",
        "contractVersion",
        "distribution.publishedExport",
        "distribution.repositoryTestOnly",
        "distribution.runtimeDependency",
        "fixtures.bundleByteLength",
        "fixtures.bundleSha256",
        "fixtures.changedRegistryRevision",
        "fixtures.etag",
        "fixtures.instructionByteLength",
        "fixtures.instructionText",
        "fixtures.learningContainerId",
        "fixtures.limits.maximumAggregateBytes",
        "fixtures.limits.maximumInstructionBytes",
        "fixtures.limits.maximumSkills",
        "fixtures.limits.throttleWindowMs",
        "fixtures.registryRevision",
        "fixtures.skillDescription",
        "fixtures.skillId",
        "fixtures.skillName",
        "fixtures.skillPosition",
        "fixtures.versionId",
        "schemaVersion",
        "sourceCorpus",
    };

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

    private sealed class IdentityMap
    {
        private readonly Dictionary<string, object> _instances = new(StringComparer.Ordinal);

        internal T Record<T>(string identity, T instance)
            where T : class
        {
            Assert(identity, instance);
            return instance;
        }

        internal void Assert(string identity, object instance)
        {
            if (_instances.TryGetValue(identity, out var existing))
            {
                Xunit.Assert.Same(existing, instance);
            }
            else
            {
                _instances.Add(identity, instance);
            }
        }
    }
}
