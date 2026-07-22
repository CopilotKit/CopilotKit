using System.Reflection;
using CopilotKit.Intelligence;
using Microsoft.Agents.AI;
using Xunit;

namespace CopilotKit.Intelligence.AgentFramework.Tests;

public sealed class SkillRegistryContextProviderTests
{
    [Fact]
    public async Task LoadsBeforeNativeContext()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            var pending = new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously);
            client.NetworkOutcomes.Enqueue(_ => pending.Task);
            await using var provider = CreateProvider(client);

            var contextTask = InvokeNativeAsync(provider);
            Assert.False(contextTask.IsCompleted);

            pending.SetResult(TestSkillSets.Create(root));
            var context = await contextTask;

            Assert.Contains(TestSkillSets.SkillId, context.Instructions, StringComparison.Ordinal);
            Assert.Contains(TestSkillSets.VersionId, context.Instructions, StringComparison.Ordinal);
            Assert.Contains("# Skill\n", context.Instructions, StringComparison.Ordinal);
            Assert.Equal(SkillRegistryStatus.Ready, provider.Status);
            Assert.True(provider.IsReady);
            Assert.Single(client.NetworkCalls);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task RetriesAfterFailedThrottleWindow()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            var clock = new FakeTimeProvider();
            client.NetworkOutcomes.Enqueue(_ => Task.FromException<InstalledSkillSet>(Unavailable()));
            client.NetworkOutcomes.Enqueue(_ => Task.FromResult(TestSkillSets.Create(root)));
            await using var provider = CreateProvider(client, clock: clock);

            var first = await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.LoadAsync());
            var throttled = await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.LoadAsync());
            Assert.Same(first, throttled);
            Assert.Single(client.NetworkCalls);

            clock.Advance(TimeSpan.FromSeconds(30));
            var snapshot = await provider.LoadAsync();

            Assert.Equal(SkillRegistryStatus.Ready, snapshot.Status);
            Assert.Equal(2, client.NetworkCalls.Count);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task JoinedCallersShareTelemetrySinkFailure()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            var pending = new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously);
            client.NetworkOutcomes.Enqueue(_ => pending.Task);
            var sinkFailure = new InvalidOperationException("sink-exception-1");
            await using var provider = CreateProvider(
                client,
                telemetry: (name, metadata, cancellationToken) =>
                {
                    if (name == "status.changed" && Equals(metadata["status"], "ready"))
                    {
                        return ValueTask.FromException(sinkFailure);
                    }

                    return ValueTask.CompletedTask;
                });

            var callerA = provider.LoadAsync();
            var callerB = provider.LoadAsync();
            pending.SetResult(TestSkillSets.Create(root));

            var failureA = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerA);
            var failureB = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerB);
            Assert.Same(failureA, failureB);
            Assert.Same(sinkFailure, failureA.InnerException);
            Assert.Equal("LEARNING_TELEMETRY_SINK_FAILED", failureA.Code);
            Assert.Single(client.NetworkCalls);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task JoinTelemetryFailurePoisonsTheSharedInflightOperation()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            var pending = new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously);
            client.NetworkOutcomes.Enqueue(_ => pending.Task);
            var sinkFailure = new InvalidOperationException("join-sink-exception-1");
            var joinEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var releaseJoin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            await using var provider = CreateProvider(
                client,
                telemetry: async (name, _, cancellationToken) =>
                {
                    if (name != "load.singleflight_joined")
                    {
                        return;
                    }

                    joinEntered.SetResult();
                    await releaseJoin.Task.WaitAsync(cancellationToken);
                    throw sinkFailure;
                });

            var callerA = provider.LoadAsync();
            await WaitForAsync(() => client.NetworkCalls.Count == 1);
            var callerB = provider.LoadAsync();
            await joinEntered.Task;
            pending.SetResult(TestSkillSets.Create(root));
            await Task.Yield();
            Assert.False(callerA.IsCompleted);
            releaseJoin.SetResult();

            var failureA = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerA);
            var failureB = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerB);
            Assert.Same(failureA, failureB);
            Assert.Same(sinkFailure, failureA.InnerException);
            Assert.Equal("LEARNING_TELEMETRY_SINK_FAILED", failureA.Code);
            Assert.Equal(SkillRegistryStatus.Denied, provider.Status);
            Assert.Single(client.NetworkCalls);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task FutureLoadAfterDisposeRejects()
    {
        var client = new FakeRegistryClient();
        var provider = CreateProvider(client);
        await provider.DisposeAsync();

        var failure = await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider.LoadAsync());

        Assert.Equal("LEARNING_REGISTRY_CLOSED", failure.Code);
        Assert.Empty(client.NetworkCalls);
        await provider.DisposeAsync();
    }

    [Fact]
    public async Task TelemetryReentrancyNeverAwaitsTheSharedLoadTask()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            client.NetworkOutcomes.Enqueue(_ => Task.FromResult(TestSkillSets.Create(root)));
            SkillRegistryContextProvider? provider = null;
            var nestedFailures = new List<IntelligenceSdkException>();
            var nestedSnapshots = new List<SkillRegistrySnapshot>();
            provider = CreateProvider(
                client,
                telemetry: async (name, metadata, cancellationToken) =>
                {
                    if (name == "load.started")
                    {
                        nestedFailures.Add(
                            await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider!.LoadAsync(cancellationToken)));
                    }
                    else if ((name == "status.changed" && Equals(metadata["status"], "ready")) || name == "load.succeeded")
                    {
                        nestedSnapshots.Add(await provider!.LoadAsync(cancellationToken));
                    }
                });

            var outer = await provider.LoadAsync().WaitAsync(TimeSpan.FromSeconds(1));

            Assert.Equal("LEARNING_REGISTRY_STALE", Assert.Single(nestedFailures).Code);
            Assert.Equal(2, nestedSnapshots.Count);
            Assert.All(nestedSnapshots, nested => Assert.Same(outer, nested));
            Assert.Single(client.NetworkCalls);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task NativeContextLoadPropagatesCancellation()
    {
        var client = new FakeRegistryClient();
        client.NetworkOutcomes.Enqueue(async cancellationToken =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("unreachable");
        });
        await using var provider = CreateProvider(client);
        using var cancellation = new CancellationTokenSource();

        var load = InvokeNativeAsync(provider, cancellation.Token);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => load);
    }

    [Fact]
    public async Task LoadStartedTelemetryFailureDeniesAllJoinedCallers()
    {
        var client = new FakeRegistryClient();
        var sinkFailure = new InvalidOperationException("started-sink-failure");
        await using var provider = CreateProvider(
            client,
            telemetry: (name, _, _) => name == "load.started"
                ? ValueTask.FromException(sinkFailure)
                : ValueTask.CompletedTask);

        var callerA = provider.LoadAsync();
        var callerB = provider.LoadAsync();

        var failureA = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerA);
        var failureB = await Assert.ThrowsAsync<IntelligenceSdkException>(() => callerB);
        Assert.Same(failureA, failureB);
        Assert.Same(sinkFailure, failureA.InnerException);
        Assert.Equal("LEARNING_TELEMETRY_SINK_FAILED", failureA.Code);
        Assert.Equal(SkillRegistryStatus.Denied, provider.Status);
        Assert.Empty(client.NetworkCalls);
    }

    [Fact]
    public async Task FailureTelemetryCanReenterWithoutAwaitingTheSharedLoad()
    {
        var client = new FakeRegistryClient();
        client.NetworkOutcomes.Enqueue(_ => Task.FromException<InstalledSkillSet>(Unavailable()));
        SkillRegistryContextProvider? provider = null;
        var nestedFailures = new List<IntelligenceSdkException>();
        provider = CreateProvider(
            client,
            telemetry: async (name, _, cancellationToken) =>
            {
                if (name is "status.changed" or "load.failed")
                {
                    nestedFailures.Add(
                        await Assert.ThrowsAsync<IntelligenceSdkException>(() => provider!.LoadAsync(cancellationToken)));
                }
            });

        var outer = await Assert.ThrowsAsync<IntelligenceSdkException>(
            () => provider.LoadAsync().WaitAsync(TimeSpan.FromSeconds(1)));

        Assert.Equal(2, nestedFailures.Count);
        Assert.All(nestedFailures, nested => Assert.Same(outer, nested));
        Assert.Single(client.NetworkCalls);
    }

    [Fact]
    public async Task TelemetryUsesAssemblyVersionAndContainsNoRegistrySecrets()
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            client.NetworkOutcomes.Enqueue(_ => Task.FromResult(TestSkillSets.Create(root)));
            var events = new List<(string Name, IReadOnlyDictionary<string, object?> Metadata)>();
            await using var provider = CreateProvider(
                client,
                telemetry: (name, metadata, _) =>
                {
                    events.Add((name, metadata));
                    return ValueTask.CompletedTask;
                });

            await provider.LoadAsync();

            Assert.NotEmpty(events);
            Assert.All(events, item =>
            {
                Assert.Equal("agent-framework-dotnet", item.Metadata["framework"]);
                Assert.Equal(SkillRegistryContextProvider.AdapterVersion, item.Metadata["adapterVersion"]);
                var serialized = string.Join('|', item.Metadata.Select(pair => $"{pair.Key}={pair.Value}"));
                Assert.DoesNotContain(TestSkillSets.ContainerId, serialized, StringComparison.Ordinal);
                Assert.DoesNotContain(root, serialized, StringComparison.Ordinal);
                Assert.DoesNotContain("# Skill", serialized, StringComparison.Ordinal);
            });
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CloseDuringSuccessfulLoadSuppressesEveryLaterTerminalEvent(bool revoked)
    {
        var root = TestSkillSets.NewRoot();
        try
        {
            var client = new FakeRegistryClient();
            var pending = new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously);
            client.NetworkOutcomes.Enqueue(_ => pending.Task);
            var events = new List<(string Name, object? Status)>();
            var provider = CreateProvider(
                client,
                telemetry: (name, metadata, _) =>
                {
                    events.Add((name, metadata.GetValueOrDefault("status")));
                    return ValueTask.CompletedTask;
                });

            var load = provider.LoadAsync();
            await WaitForAsync(() => client.NetworkCalls.Count == 1);
            await provider.DisposeAsync();
            pending.SetResult(TestSkillSets.Create(root, revoked: revoked));

            var settled = await load;

            Assert.Equal(revoked ? SkillRegistryStatus.Revoked : SkillRegistryStatus.Ready, settled.Status);
            Assert.Equal(SkillRegistryStatus.Closed, provider.Status);
            Assert.Equal(
                [("load.started", null), ("status.changed", (object?)"closed")],
                events);
            await provider.DisposeAsync();
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Theory]
    [InlineData(false, "LEARNING_REGISTRY_STALE")]
    [InlineData(true, "LEARNING_REGISTRY_DENIED")]
    public async Task CloseDuringFailedLoadSuppressesEveryLaterTerminalEvent(
        bool denied,
        string expectedCode)
    {
        var client = new FakeRegistryClient();
        var pending = new TaskCompletionSource<InstalledSkillSet>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.NetworkOutcomes.Enqueue(_ => pending.Task);
        var events = new List<(string Name, object? Status)>();
        var provider = CreateProvider(
            client,
            telemetry: (name, metadata, _) =>
            {
                events.Add((name, metadata.GetValueOrDefault("status")));
                return ValueTask.CompletedTask;
            });

        var load = provider.LoadAsync();
        await WaitForAsync(() => client.NetworkCalls.Count == 1);
        await provider.DisposeAsync();
        pending.SetException(denied
            ? new IntelligenceSdkException(
                "permission denied",
                "UPSTREAM_DENIED",
                "permission",
                retryable: false,
                status: 403)
            : Unavailable());

        var failure = await Assert.ThrowsAsync<IntelligenceSdkException>(() => load);

        Assert.Equal(expectedCode, failure.Code);
        Assert.Equal(SkillRegistryStatus.Closed, provider.Status);
        Assert.Equal(
            [("load.started", null), ("status.changed", (object?)"closed")],
            events);
        await provider.DisposeAsync();
    }

    private static SkillRegistryContextProvider CreateProvider(
        FakeRegistryClient client,
        FakeTimeProvider? clock = null,
        SkillRegistryTelemetrySink? telemetry = null)
    {
        return new SkillRegistryContextProvider(
            client,
            TestSkillSets.ContainerId,
            new SkillRegistryContextProviderOptions
            {
                TimeProvider = clock ?? new FakeTimeProvider(),
                Telemetry = telemetry,
            });
    }

    private static async Task<AIContext> InvokeNativeAsync(
        SkillRegistryContextProvider provider,
        CancellationToken cancellationToken = default)
    {
        var method = typeof(SkillRegistryContextProvider).GetMethod(
            "ProvideAIContextAsync",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(method);
        var pending = Assert.IsType<ValueTask<AIContext>>(
            method.Invoke(provider, [null, cancellationToken]));
        return await pending;
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        while (!condition())
        {
            await Task.Delay(1, timeout.Token);
        }
    }

    private static IntelligenceSdkException Unavailable() => new(
        "offline",
        "UPSTREAM_UNAVAILABLE",
        "dependency",
        retryable: true);
}
