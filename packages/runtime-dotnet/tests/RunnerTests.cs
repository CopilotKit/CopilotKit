using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class RunnerTests
{
    public static async Task RunAsync()
    {
        await Task.WhenAll(ProjectOnlyMemoryMutationAsync("PATCH"), ProjectOnlyMemoryMutationAsync("DELETE"));
        await Task.WhenAll(StopAliasAsync(), StopAgentScopeAsync(), MalformedStopAsync(), InvalidMemoryPolicyAsync(), ProjectOnlyMemoryReadAsync(), MemoryCallbackFailureAsync());
        foreach (var mode in new[] { "error", "cancel-throws", "cancel-eof" }) await BeforeFirstYieldAsync(mode);
        await LeaseFailureBeforeDispatchAsync();
        await Task.WhenAll(StartupLeaseAsync(), StartupDisposeAsync());
        await AbruptStreamAsync();
        await LeaseFailureAsync();
        await BackpressureAsync();
        await IdleReconnectAsync();
        await BoundedShutdownAsync();
        await StopWithoutBodyAsync();
        foreach (var mode in new[] { "restart", "shutdown", "cancel" }) await CleanupHandoffAsync(mode);
        foreach (var callback in new[] { false, true }) await HandoffTimeoutAsync(callback);
        await ShutdownPendingTimeoutAsync();
    }

    private static async Task ShutdownPendingTimeoutAsync()
    {
        var agent = new TestAgent(true, true);
        await using var fixture = await Fixture.CreateAsync(agent);
        await fixture.StartRunAsync();
        fixture.Platform.HoldSuccessorDelete = true;
        fixture.Platform.IgnoreDeleteCancellation = true;
        var successor = fixture.StartRequestAsync(runId: "next");
        Task? shutdown = null;
        try
        {
            await fixture.Platform.SuccessorRenewed.Task.WaitAsync(TimeSpan.FromSeconds(2));
            shutdown = fixture.StopRuntimeAsync();
            await fixture.Platform.SuccessorDeleteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
            await fixture.ShutdownTimedOut.Task.WaitAsync(TimeSpan.FromSeconds(2));
            var retainedPendingCleanup = false;
            try { await shutdown.WaitAsync(TimeSpan.FromMilliseconds(80)); }
            catch (TimeoutException) { retainedPendingCleanup = true; }
            Check(retainedPendingCleanup, "shutdown timeout fallback still drains pending admission cleanup");
        }
        finally
        {
            fixture.Platform.ReleaseSuccessorDelete.TrySetResult();
            agent.Release.TrySetResult();
            await successor.WaitAsync(TimeSpan.FromSeconds(2));
            if (shutdown is not null) await shutdown.WaitAsync(TimeSpan.FromSeconds(2));
        }
        Check(agent.Invocations == 1, "shutdown fallback never dispatches the waiting successor");
    }

    private static async Task HandoffTimeoutAsync(bool blockedCallback)
    {
        var agent = new TestAgent(true, !blockedCallback, blockedCallback);
        await using var fixture = await Fixture.CreateAsync(agent);
        await fixture.StartRunAsync();
        try
        {
            var response = await fixture.StartRequestAsync(runId: "next").WaitAsync(TimeSpan.FromSeconds(2));
            Check(!response.IsSuccessStatusCode && agent.Invocations == 1, "handoff deadline prevents overlap with blocked cancellation: " + blockedCallback);
            Check(fixture.Platform.DeletedRuns.Contains("next"), "failed handoff releases only its own lease");
        }
        finally { agent.Release.TrySetResult(); }
    }

    private static async Task CleanupHandoffAsync(string mode)
    {
        var agent = new TestAgent(true);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.Platform.HoldDeleteRun = "run";
        await fixture.StartRunAsync();
        await fixture.StopAsync("thread", new { runId = "run" });
        await fixture.Platform.DeleteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        using var cancellation = new CancellationTokenSource();
        var successor = fixture.StartRequestAsync(runId: "next", cancellationToken: cancellation.Token);
        try
        {
            await fixture.Platform.SuccessorRenewed.Task.WaitAsync(TimeSpan.FromSeconds(2));
            Check(!successor.IsCompleted && agent.Invocations == 1, "successor renews while predecessor cleanup is pending: " + mode);
            Task? shutdown = null;
            if (mode == "shutdown")
            {
                fixture.Platform.HoldSuccessorDelete = true;
                shutdown = fixture.StopRuntimeAsync();
                await fixture.Platform.SuccessorDeleteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                Check(!shutdown.IsCompleted, "shutdown owns pending successor cleanup");
                fixture.Platform.ReleaseSuccessorDelete.TrySetResult();
            }
            if (mode == "cancel") cancellation.Cancel();
            if (mode != "restart")
            {
                await WaitAsync(() => fixture.Platform.DeletedRuns.Contains("next"));
                Check(agent.Invocations == 1, "canceled admission never starts the successor: " + mode);
                if (shutdown is not null) Check(!shutdown.IsCompleted, "shutdown still owns predecessor cleanup");
            }
            fixture.Platform.ReleaseDelete.TrySetResult();
            if (mode == "cancel")
            {
                try { await successor; throw new Exception("request cancellation was ignored"); }
                catch (OperationCanceledException) { }
            }
            else
            {
                var response = await successor.WaitAsync(TimeSpan.FromSeconds(2));
                Check(response.IsSuccessStatusCode == (mode == "restart"), "handoff returns the expected response: " + mode);
            }
            if (shutdown is not null) await shutdown.WaitAsync(TimeSpan.FromSeconds(2));
            if (mode == "restart")
            {
                await WaitAsync(() => agent.Invocations == 2);
                Check(fixture.Platform.LockRun == "next", "old cleanup preserves the successor lease");
                var stale = await fixture.StopAsync("thread", new { runId = "run" });
                Check((await stale.Content.ReadFromJsonAsync<JsonObject>())?["stopped"]?.GetValue<bool>() == false, "old Stop cannot cancel the successor");
                await fixture.StopAsync("thread", new { runId = "next" });
            }
        }
        finally { fixture.Platform.ReleaseDelete.TrySetResult(); fixture.Platform.ReleaseSuccessorDelete.TrySetResult(); }
    }

    private static async Task ProjectOnlyMemoryMutationAsync(string method)
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        fixture.MemoryGrant = new JsonObject { ["user"] = "none", ["project"] = "read-write" };
        var response = await fixture.MutateMemoryAsync(method);
        Check(response.IsSuccessStatusCode && fixture.Platform.MemoryCalls == 1 && fixture.Platform.ReceivedGrant == fixture.MemoryGrant.ToJsonString(), method + " existing memory delegates unknown scope with trusted project-only write grant");
        fixture.Platform.MemoryStatus = System.Net.HttpStatusCode.Forbidden;
        response = await fixture.MutateMemoryAsync(method);
        Check((int)response.StatusCode == 403 && fixture.Platform.MemoryCalls == 2, method + " preserves platform denial for the stored memory scope");
        fixture.MemoryGrant = new JsonObject { ["user"] = "read", ["project"] = "read" };
        response = await fixture.MutateMemoryAsync(method);
        Check((int)response.StatusCode == 403 && fixture.Platform.MemoryCalls == 2, method + " rejects grants with no write access before platform");
    }

    private static async Task StopAliasAsync()
    {
        var agent = new TestAgent(true);
        await using var fixture = await Fixture.CreateAsync(agent);
        await fixture.StartRunAsync();
        var response = await fixture.StopAsync("alias", new { runId = "run" });
        var body = await response.Content.ReadFromJsonAsync<JsonObject>();
        Check(response.IsSuccessStatusCode && body?["stopped"]?.GetValue<bool>() == true, "stop uses the platform canonical thread ID for an alias");
        await agent.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(2));
    }

    private static async Task StopAgentScopeAsync()
    {
        var agent = new TestAgent(true);
        await using var fixture = await Fixture.CreateAsync(agent);
        await fixture.StartRunAsync();
        fixture.Platform.ThreadAgent = "another-agent";
        var response = await fixture.StopAsync("thread", new { runId = "run" });
        Check((int)response.StatusCode == 403 && !agent.Cancelled.Task.IsCompleted, "stop denies a thread owned by another agent before cancellation");
    }

    private static async Task MalformedStopAsync()
    {
        foreach (var runId in new object?[] { null, 123, "", "  " })
        {
            await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
            var response = await fixture.StopAsync("thread", new { runId });
            Check((int)response.StatusCode == 400 && fixture.Platform.ThreadReads == 0, "malformed stop runId fails before platform access: " + (runId ?? "null"));
        }
    }

    private static async Task InvalidMemoryPolicyAsync()
    {
        foreach (var (json, status) in new[] { ("{\"user\":\"invalid\",\"project\":\"read\"}", 500), ("{\"project\":\"read\"}", 500), ("{\"user\":\"read\",\"project\":42}", 500), ("{\"user\":\"none\",\"project\":\"none\"}", 403) })
        {
            await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
            fixture.MemoryGrant = JsonNode.Parse(json)!.AsObject();
            var response = await fixture.ListMemoriesAsync();
            Check((int)response.StatusCode == status && fixture.Platform.MemoryCalls == 0, "invalid or denied memory grant fails before platform access: " + json);
        }
    }

    private static async Task ProjectOnlyMemoryReadAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        fixture.MemoryGrant = new JsonObject { ["user"] = "none", ["project"] = "read" };
        var response = await fixture.ListMemoriesAsync();
        Check(response.IsSuccessStatusCode && fixture.Platform.MemoryCalls == 1 && fixture.Platform.ReceivedGrant == fixture.MemoryGrant.ToJsonString(), "unscoped read forwards the trusted project-only grant instead of browser headers");
    }

    private static async Task MemoryCallbackFailureAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        fixture.FailMemoryPolicy = true;
        var response = await fixture.ListMemoriesAsync();
        Check((int)response.StatusCode == 500 && fixture.Platform.MemoryCalls == 0 && !(await response.Content.ReadAsStringAsync()).Contains("PRIVATE_POLICY_ERROR", StringComparison.Ordinal), "memory callback failure returns safe500 before platform access");
    }

    private static async Task BeforeFirstYieldAsync(string mode)
    {
        var agent = new BeforeYieldAgent(mode);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.Platform.History = "{\"messages\":[{\"id\":\"old\",\"role\":\"user\",\"content\":\"historic\"}]}";
        var response = await fixture.StartRequestAsync([new { id = "old", role = "user", content = "historic" }, new { id = "new", role = "user", content = "fresh" }]);
        Check(response.IsSuccessStatusCode, "pre-yield fixture joins before response: " + mode);
        await agent.Entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        if (mode != "error") await fixture.StopWithoutBodyAsync();
        await WaitAsync(() => fixture.Platform.Deleted);
        var events = fixture.Events.ToArray();
        Check(events.Select(value => value["type"]!.GetValue<string>()).SequenceEqual(["RUN_STARTED", "RUN_ERROR"]), "exactly one start precedes pre-yield terminal: " + mode);
        Check(events[0]["input"]?["threadId"]?.GetValue<string>() == "thread" && events[0]["input"]?["runId"]?.GetValue<string>() == "run" && events[0]["input"]?["messages"] is JsonArray messages && messages.Count == 1 && messages[0]?["id"]?.GetValue<string>() == "new", "pre-yield failure preserves canonical fresh input: " + mode);
    }

    private static async Task LeaseFailureBeforeDispatchAsync()
    {
        var agent = new TestAgent(false);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.HoldJoin = true; fixture.Platform.FailRenewal = true;
        var response = await fixture.StartRequestAsync();
        Check(!response.IsSuccessStatusCode && fixture.Platform.Renewals > 0 && agent.Invocations == 0, "failed startup lease prevents the first agent side effect");
    }

    private static async Task StartupLeaseAsync()
    {
        var agent = new TestAgent(false);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.HoldJoin = true;
        var request = fixture.StartRequestAsync();
        await fixture.JoinEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await WaitAsync(() => fixture.Platform.Renewals > 0);
        var supervised = fixture.Platform.Renewals > 0;
        await fixture.StopRuntimeAsync(); await request;
        Check(supervised && agent.Invocations == 0, "startup renews its lease before the gateway join completes");
    }

    private static async Task StartupDisposeAsync()
    {
        var agent = new TestAgent(false);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.HoldJoin = true; fixture.Platform.HoldDelete = true;
        var request = fixture.StartRequestAsync();
        await fixture.JoinEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var shutdown = fixture.StopRuntimeAsync();
        await fixture.Platform.DeleteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var waitedForCleanup = !shutdown.IsCompleted;
        fixture.Platform.ReleaseDelete.TrySetResult();
        await shutdown; var response = await request;
        Check(waitedForCleanup && !response.IsSuccessStatusCode && agent.Invocations == 0, "dispose waits for blocked startup cleanup and never starts the agent");
    }

    private static async Task AbruptStreamAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        await fixture.StartRunAsync();
        await WaitAsync(() => fixture.Events.Any(value => value["type"]?.GetValue<string>() is "RUN_ERROR" or "RUN_FINISHED"));
        var types = fixture.Events.Select(value => value["type"]!.GetValue<string>()).ToArray();
        Check(types.SequenceEqual(["RUN_STARTED", "TEXT_MESSAGE_START", "TOOL_CALL_START", "TEXT_MESSAGE_END", "TOOL_CALL_END", "TOOL_CALL_RESULT", "RUN_ERROR"]), "abrupt stream closes text and tools before INCOMPLETE_STREAM");
        Check(fixture.Events.Last()["code"]?.GetValue<string>() == "INCOMPLETE_STREAM", "abrupt completion has canonical error code");
    }

    private static async Task LeaseFailureAsync()
    {
        var agent = new TestAgent(true);
        await using var fixture = await Fixture.CreateAsync(agent);
        fixture.Platform.FailRenewal = true;
        await fixture.StartRunAsync();
        await agent.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await WaitAsync(() => fixture.Platform.Deleted);
        Check(fixture.Platform.Renewals > 0 && fixture.Platform.Deleted, "idle lease renewal failure cancels agent and releases lock");
    }

    private static async Task BackpressureAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        fixture.HoldAcks = true;
        using var telemetry = new DisposableTelemetry(fixture.Options);
        await using var publisher = new PhoenixPublisher(fixture.Options, "thread", "run", telemetry.Value, () => { });
        await publisher.JoinAsync(CancellationToken.None);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        var enqueued = 0;
        try { for (; enqueued < 1000; enqueued++) await publisher.PublishAsync(new JsonObject { ["type"] = "CUSTOM" }, cancellation.Token); }
        catch (OperationCanceledException) { }
        Check(enqueued <= 257 && enqueued >= 256, "publisher backpressure bounds queue to 256 plus one active event");
    }

    private static async Task IdleReconnectAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(false));
        fixture.CloseFirstJoin = true;
        using var telemetry = new DisposableTelemetry(fixture.Options);
        await using var publisher = new PhoenixPublisher(fixture.Options, "thread", "run", telemetry.Value, () => { });
        await publisher.JoinAsync(CancellationToken.None);
        await WaitAsync(() => fixture.Joins >= 2);
        Check(fixture.Events.IsEmpty, "idle planned reconnect rejoins without agent output");
    }

    private static async Task BoundedShutdownAsync()
    {
        var agent = new TestAgent(true, true);
        await using var fixture = await Fixture.CreateAsync(agent);
        await fixture.StartRunAsync();
        var shutdown = fixture.StopRuntimeAsync();
        var bounded = false;
        try { await shutdown.WaitAsync(TimeSpan.FromMilliseconds(900)); bounded = true; }
        catch (TimeoutException) { }
        finally { agent.Release.TrySetResult(); await shutdown; }
        Check(bounded, "shutdown bounds waiting for a cancellation-ignoring native agent");
    }

    private static async Task StopWithoutBodyAsync()
    {
        await using var fixture = await Fixture.CreateAsync(new TestAgent(true));
        await fixture.StartRunAsync();
        Check(await fixture.StopWithoutBodyAsync(), "stop keeps compatibility with an absent request body");
    }

    private static void Check(bool condition, string name) { Console.WriteLine((condition ? "PASS " : "FAIL ") + name); if (!condition) throw new Exception(name); }
    private static async Task WaitAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        while (!condition()) await Task.Delay(10, timeout.Token);
    }

    private sealed class DisposableTelemetry(RuntimeOptions options) : IDisposable
    {
        public RuntimeTelemetry Value { get; } = new(options);
        public void Dispose() => Value.DisposeAsync().AsTask().GetAwaiter().GetResult();
    }

    private sealed class TestAgent(bool idle, bool ignoreCancellation = false, bool blockCancellationCallback = false) : IRuntimeAgent
    {
        public string Description => "runner test";
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Invocations;
        public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Invocations);
            using var registration = blockCancellationCallback ? cancellationToken.Register(() => Release.Task.GetAwaiter().GetResult()) : default;
            try
            {
                yield return new JsonObject { ["type"] = "TEXT_MESSAGE_START", ["messageId"] = "message", ["role"] = "assistant" };
                yield return new JsonObject { ["type"] = "TOOL_CALL_START", ["toolCallId"] = "tool", ["toolCallName"] = "test" };
                if (ignoreCancellation) await Release.Task;
                else if (idle) await Task.Delay(Timeout.Infinite, cancellationToken);
            }
            finally { Cancelled.TrySetResult(); }
        }
    }

    private sealed class BeforeYieldAgent(string mode) : IRuntimeAgent
    {
        public string Description => "pre-yield test";
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
        {
            Entered.TrySetResult();
            if (mode == "error") throw new InvalidOperationException("immediate error");
            try { await Task.Delay(Timeout.Infinite, cancellationToken); }
            catch (OperationCanceledException) when (mode == "cancel-eof") { }
            yield break;
        }
    }

    private sealed class PlatformHandler : HttpMessageHandler
    {
        public bool FailRenewal; public int Renewals; public bool Deleted; public bool HoldDelete;
        public string? HoldDeleteRun; public string? LockRun;
        public bool HoldSuccessorDelete;
        public bool IgnoreDeleteCancellation;
        public ConcurrentBag<string> DeletedRuns { get; } = new();
        public TaskCompletionSource SuccessorRenewed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource SuccessorDeleteEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ReleaseSuccessorDelete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public string History = "{\"messages\":[]}";
        public string ThreadAgent = "default"; public int ThreadReads; public int MemoryCalls;
        public string? ReceivedGrant;
        public System.Net.HttpStatusCode MemoryStatus = System.Net.HttpStatusCode.OK;
        public TaskCompletionSource DeleteEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ReleaseDelete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null ? null : await request.Content.ReadFromJsonAsync<JsonObject>(cancellationToken);
            var runId = body?["runId"]?.GetValue<string>() ?? "run";
            if (path.StartsWith("/api/memories", StringComparison.Ordinal)) { Interlocked.Increment(ref MemoryCalls); ReceivedGrant = request.Headers.GetValues("x-cpki-memory-grant").Single(); return new HttpResponseMessage(MemoryStatus) { Content = new StringContent("{\"memories\":[]}") }; }
            if (request.Method == HttpMethod.Get && !path.EndsWith("/messages", StringComparison.Ordinal)) { Interlocked.Increment(ref ThreadReads); return new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new { thread = new { id = "thread", agentId = ThreadAgent } }) }; }
            if (request.Method == HttpMethod.Post && path.EndsWith("/lock", StringComparison.Ordinal)) LockRun = runId;
            if (request.Method == HttpMethod.Patch) { Interlocked.Increment(ref Renewals); if (runId == "next") SuccessorRenewed.TrySetResult(); if (FailRenewal) return new HttpResponseMessage(System.Net.HttpStatusCode.Conflict); }
            if (request.Method == HttpMethod.Delete) { DeleteEntered.TrySetResult(); if (HoldDelete || HoldDeleteRun == runId) await ReleaseDelete.Task.WaitAsync(cancellationToken); if (runId == "next" && HoldSuccessorDelete) { SuccessorDeleteEntered.TrySetResult(); await ReleaseSuccessorDelete.Task.WaitAsync(IgnoreDeleteCancellation ? CancellationToken.None : cancellationToken); } if (LockRun == runId) LockRun = null; DeletedRuns.Add(runId); Deleted = true; }
            var value = path.EndsWith("/messages", StringComparison.Ordinal) ? History : new JsonObject { ["threadId"] = "thread", ["runId"] = runId, ["joinToken"] = "token" }.ToJsonString();
            return new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(value) };
        }
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private WebApplication app = null!; private WebApplication host = null!; private IntelligenceRuntime runtime = null!; private HttpClient platformHttp = null!; private HttpClient browser = null!;
        public PlatformHandler Platform { get; } = new();
        public ConcurrentQueue<JsonObject> Events { get; } = new();
        public bool HoldAcks;
        public bool CloseFirstJoin; public int Joins;
        public bool HoldJoin;
        public TaskCompletionSource JoinEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ShutdownTimedOut { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public RuntimeOptions Options { get; private set; } = null!;
        public JsonObject? MemoryGrant { get; set; } = new() { ["user"] = "read-write", ["project"] = "read-write" };
        public bool FailMemoryPolicy;
        public static async Task<Fixture> CreateAsync(IRuntimeAgent agent)
        {
            var fixture = new Fixture();
            var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
            fixture.app = builder.Build(); fixture.app.UseWebSockets();
            fixture.app.Map("/runner/websocket", async context =>
            {
                using var socket = await context.WebSockets.AcceptWebSocketAsync("phoenix");
                var buffer = new byte[65536];
                try
                {
                    while (socket.State == WebSocketState.Open)
                    {
                        var part = await socket.ReceiveAsync(buffer, context.RequestAborted);
                        if (part.MessageType == WebSocketMessageType.Close) break;
                        var frame = JsonNode.Parse(buffer.AsSpan(0, part.Count))!.AsArray();
                        var name = frame[3]!.GetValue<string>();
                        if (name == "phx_join") { fixture.JoinEntered.TrySetResult(); if (fixture.HoldJoin) continue; }
                        if (name == "event") fixture.Events.Enqueue((JsonObject)frame[4]!.DeepClone());
                        if (name == "event" && fixture.HoldAcks) continue;
                        var reply = new JsonArray(frame[0]?.DeepClone(), frame[1]?.DeepClone(), frame[2]?.DeepClone(), "phx_reply", new JsonObject { ["status"] = "ok", ["response"] = new JsonObject() });
                        await socket.SendAsync(Encoding.UTF8.GetBytes(reply.ToJsonString()), WebSocketMessageType.Text, true, context.RequestAborted);
                        if (name == "phx_join" && Interlocked.Increment(ref fixture.Joins) == 1 && fixture.CloseFirstJoin)
                        {
                            await socket.CloseOutputAsync((WebSocketCloseStatus)1012, "gateway_draining", context.RequestAborted);
                            break;
                        }
                    }
                }
                catch (Exception error) when (error is WebSocketException or OperationCanceledException) { }
            });
            await fixture.app.StartAsync();
            var address = fixture.app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            fixture.Options = new RuntimeOptions { ApiUrl = new Uri(address), RunnerUrl = new Uri(address + "/runner"), ClientUrl = new Uri(address), ApiKey = "test", Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = agent }, IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("user")), MemoryGrant = (_, _, _) => fixture.FailMemoryPolicy ? throw new InvalidOperationException("PRIVATE_POLICY_ERROR") : ValueTask.FromResult(fixture.MemoryGrant), OnError = error => { if (error.Code == "RUN_SHUTDOWN_TIMEOUT") fixture.ShutdownTimedOut.TrySetResult(); }, TelemetryDisabled = true, RequestTimeout = TimeSpan.FromMilliseconds(300), LockHeartbeatInterval = TimeSpan.FromMilliseconds(30) };
            fixture.platformHttp = new HttpClient(fixture.Platform); fixture.runtime = new IntelligenceRuntime(fixture.Options, fixture.platformHttp);
            var hostBuilder = WebApplication.CreateBuilder(); hostBuilder.Logging.ClearProviders(); hostBuilder.WebHost.UseUrls("http://127.0.0.1:0");
            fixture.host = hostBuilder.Build(); fixture.runtime.Map(fixture.host); await fixture.host.StartAsync();
            fixture.browser = new HttpClient { BaseAddress = new Uri(fixture.host.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
            return fixture;
        }
        public async Task StartRunAsync()
        {
            var result = await StartRequestAsync();
            Check(result.IsSuccessStatusCode, "runner fixture starts through authenticated HTTP boundary");
        }
        public Task<HttpResponseMessage> StartRequestAsync(object[]? messages = null, string runId = "run", CancellationToken cancellationToken = default) => browser.PostAsJsonAsync("/copilotkit/agent/default/run", new { threadId = "thread", runId, messages = messages ?? Array.Empty<object>(), tools = Array.Empty<object>(), context = Array.Empty<object>(), state = new { }, forwardedProps = new { } }, cancellationToken);
        public Task StopRuntimeAsync() => runtime.DisposeAsync().AsTask();
        public async Task<bool> StopWithoutBodyAsync() => (await browser.PostAsync("/copilotkit/agent/default/stop/thread", null)).IsSuccessStatusCode;
        public Task<HttpResponseMessage> StopAsync(string thread, object body) => browser.PostAsJsonAsync("/copilotkit/agent/default/stop/" + thread, body);
        public Task<HttpResponseMessage> ListMemoriesAsync()
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/copilotkit/memories");
            request.Headers.TryAddWithoutValidation("x-cpki-memory-grant", "{\"user\":\"read-write\",\"project\":\"read-write\"}");
            return browser.SendAsync(request);
        }
        public Task<HttpResponseMessage> MutateMemoryAsync(string method)
        {
            var request = new HttpRequestMessage(new HttpMethod(method), "/copilotkit/memories/existing");
            if (method == "PATCH") request.Content = JsonContent.Create(new { content = "replacement", kind = "topical" });
            request.Headers.TryAddWithoutValidation("x-cpki-memory-grant", "{\"user\":\"read-write\",\"project\":\"read-write\"}");
            return browser.SendAsync(request);
        }
        public async ValueTask DisposeAsync() { await runtime.DisposeAsync(); browser.Dispose(); platformHttp.Dispose(); await host.StopAsync(); await host.DisposeAsync(); await app.StopAsync(); await app.DisposeAsync(); }
    }
}
