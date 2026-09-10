using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace CopilotKit.Intelligence;

/// <summary>Mounts the multi-route browser API and persists all agent events through Intelligence.</summary>
public sealed class IntelligenceRuntime : IAsyncDisposable
{
    private readonly RuntimeOptions options;
    private readonly HttpClient http;
    private readonly HttpClient mcpHttp = CreateMcpHttpClient();

    /// <summary>Keep configured MCP headers on the registered endpoint.</summary>
    internal static HttpClient CreateMcpHttpClient() => new(new HttpClientHandler { AllowAutoRedirect = false });
    private readonly bool ownsHttp;
    private readonly bool ownsIntelligence;
    /// <summary>The SDK used for platform calls. An injected SDK remains application-owned.</summary>
    public IntelligenceClient Intelligence { get; }
    private readonly RuntimeTelemetry telemetry;
    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentDictionary<string, ActiveRun> runs = new();
    private int disposed;
    private sealed class MemoryPolicyException(string message, Exception? innerException = null) : Exception(message, innerException);
    private sealed class ActiveRun(CancellationTokenSource cancellation, string runId, string agentId)
    {
        internal CancellationTokenSource Cancellation { get; } = cancellation;
        internal TaskCompletionSource Lifecycle { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal Task Completion => Lifecycle.Task;
        internal Task Execution { get; set; } = Task.CompletedTask;
        internal CancellationTokenSource RenewalStop { get; } = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
        internal Task Renewal { get; set; } = Task.CompletedTask;
        internal string RunId { get; } = runId;
        internal string AgentId { get; } = agentId;
        internal Action? AbortPublisher { get; set; }
    }

    public IntelligenceRuntime(RuntimeOptions options, HttpClient? httpClient = null)
    {
        options.Validate();
        if (options.Intelligence is not null && httpClient is not null)
            throw new ArgumentException("Configure the platform HTTP client on the injected Intelligence SDK.", nameof(httpClient));
        this.options = options;
        Intelligence = options.Intelligence ?? new IntelligenceClient(new IntelligenceOptions
        {
            ApiKey = options.ApiKey, ApiUrl = options.ApiUrl, RunnerUrl = options.RunnerUrl,
            ClientUrl = options.ClientUrl, RequestTimeout = options.RequestTimeout
        }, httpClient);
        ownsIntelligence = options.Intelligence is null;
        http = httpClient ?? new HttpClient(); ownsHttp = httpClient is null;
        telemetry = new RuntimeTelemetry(options);
    }

    /// <summary>Maps an explicit route subtree. Authentication remains application-owned.</summary>
    public IEndpointConventionBuilder Map(IEndpointRouteBuilder endpoints, string basePath = "/copilotkit") => endpoints.Map(basePath.TrimEnd('/') + "/{**runtimePath}", HandleAsync);

    private async Task HandleAsync(HttpContext context)
    {
        var watch = Stopwatch.StartNew();
        var route = context.Request.RouteValues["runtimePath"]?.ToString()?.Trim('/') ?? "";
        var segments = route.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var agentOperation = segments.ElementAtOrDefault(2) is "run" or "connect" or "stop" ? segments[2] : "unknown";
        var operation = segments.FirstOrDefault() switch { "agent" => "agent." + agentOperation, "threads" => "threads", "memories" => "memories", "annotate" => "annotate", "info" => "info", "inspector-metadata" => "inspector.metadata", _ => "unknown" };
        using var activity = telemetry.Disabled ? null : RuntimeTelemetry.ActivitySource.StartActivity(operation, ActivityKind.Server);
        using var requestCancellation = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping.Token);
        requestCancellation.CancelAfter(options.RequestTimeout);
        var ct = requestCancellation.Token;
        try
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && options.AllowedOrigins.Count > 0)
            {
                if (!options.AllowedOrigins.Contains(origin)) throw new RuntimeRequestException(403, "Origin not allowed");
                context.Response.Headers.AccessControlAllowOrigin = origin;
                context.Response.Headers.Vary = "Origin";
                context.Response.Headers.AccessControlAllowCredentials = "true";
            }
            if (context.Request.Method == "OPTIONS")
            {
                context.Response.Headers.AccessControlAllowMethods = "GET, POST, PATCH, DELETE, OPTIONS";
                context.Response.Headers.AccessControlAllowHeaders = "Content-Type, Authorization";
                context.Response.StatusCode = 204; return;
            }
            if (route == "info")
            {
                if (context.Request.Method != "GET") throw new RuntimeRequestException(405, "Method not allowed");
                await WriteAsync(context, await InfoAsync(ct), ct); return;
            }
            if (route == "inspector-metadata")
            {
                context.Response.Headers.CacheControl = "no-store, private";
                if (context.Request.Method != "GET")
                {
                    context.Response.Headers.Allow = "GET";
                    throw new RuntimeRequestException(405, "Method not allowed");
                }
                await InspectorMetadataAsync(context, ct); return;
            }
            var user = await options.IdentifyUser(context, ct);
            if (user is null || string.IsNullOrWhiteSpace(user.Id)) throw new RuntimeRequestException(401, "Authenticated user required");
            if (segments.FirstOrDefault() == "agent" && segments.Length >= 3)
            {
                if (!options.Agents.TryGetValue(segments[1], out var agent)) throw new RuntimeRequestException(404, "Agent not found");
                if (context.Request.Method != "POST") throw new RuntimeRequestException(405, "Method not allowed");
                if (segments[2] == "stop" && segments.Length == 4)
                {
                    var stopBody = await ReadBodyAsync(context, ct, allowEmpty: true);
                    var requestedRun = stopBody.ContainsKey("runId") ? RuntimeValidation.RequiredString(stopBody, "runId") : null;
                    var lookup = await PlatformAsync("GET", ThreadPath(segments[3]) + "?userId=" + Escape(user.Id), null, user, ct);
                    var thread = lookup?["thread"] as JsonObject ?? throw new RuntimeRequestException(502, "Invalid thread response");
                    var canonicalThread = RequiredPlatformString(thread, "id");
                    if (thread.ContainsKey("agentId") && (thread["agentId"] is not JsonValue owner || !owner.TryGetValue<string>(out var ownerId) || ownerId != segments[1])) throw new RuntimeRequestException(403, "Thread access denied");
                    var stopped = runs.TryGetValue(canonicalThread, out var active) && active.AgentId == segments[1] && (requestedRun is null || requestedRun == active.RunId);
                    if (stopped) await active!.Cancellation.CancelAsync();
                    await WriteAsync(context, new JsonObject { ["stopped"] = stopped }, ct); return;
                }
                if (segments.Length != 3) throw new RuntimeRequestException(404, "Route not found");
                if (segments[2] is "run" or "connect") telemetry.Record("oss.runtime.copilot_request_created", operation);
                var body = await ReadBodyAsync(context, ct);
                if (segments[2] == "run") { RuntimeValidation.ValidateRun(body); await WriteAsync(context, await StartRunAsync(context, user, segments[1], agent, body, ct), ct); return; }
                if (segments[2] == "connect")
                {
                    var thread = RuntimeValidation.RequiredString(body, "threadId");
                    var result = await PlatformAsync("POST", ThreadPath(thread) + "/connect", new JsonObject { ["userId"] = user.Id, ["agentId"] = segments[1] }, user, ct);
                    if (result is null) { context.Response.StatusCode = 204; return; }
                    var canonical = RequiredPlatformString(result, "threadId"); var token = RequiredPlatformString(result, "joinToken");
                    context.Response.Headers.CacheControl = "no-cache";
                    await WriteAsync(context, ConnectionInfo(canonical, token), ct); return;
                }
                throw new RuntimeRequestException(404, "Route not found");
            }
            if (segments.FirstOrDefault() == "threads") { await ThreadsAsync(context, segments, user, ct); return; }
            if (segments.FirstOrDefault() == "memories") { await MemoriesAsync(context, segments, user, ct); return; }
            if (route == "annotate" && context.Request.Method == "POST")
            {
                var body = await ReadBodyAsync(context, ct);
                var filtered = Pick(body, "type", "threadId", "payload", "occurredAt");
                RuntimeValidation.RequiredString(filtered, "type"); RuntimeValidation.RequiredString(filtered, "threadId"); filtered["userId"] = user.Id;
                var id = body["clientEventId"]?.GetValue<string>() ?? Guid.NewGuid().ToString();
                var result = await PlatformAsync("PUT", "/connector/annotate/" + Escape(id), filtered, user, ct);
                if (result is null) throw new RuntimeRequestException(502, "Invalid annotation response");
                await WriteAsync(context, result, ct); return;
            }
            throw new RuntimeRequestException(404, "Route not found");
        }
        catch (MemoryPolicyException error) { ReportError(operation, "INVALID_MEMORY_GRANT", error); context.Response.StatusCode = 500; await WriteAsync(context, new JsonObject { ["error"] = error.Message }, CancellationToken.None); }
        catch (RuntimeRequestException error) { if (error.StatusCode >= 500) ReportError(operation, "REQUEST_FAILED", error); context.Response.StatusCode = error.StatusCode >= 500 && operation is "memories" or "annotate" ? 502 : error.StatusCode; await WriteAsync(context, new JsonObject { ["error"] = error.Message }, CancellationToken.None); }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) { context.Response.StatusCode = 400; await WriteAsync(context, new JsonObject { ["error"] = "Invalid request body" }, CancellationToken.None); }
        catch (Exception error) { ReportError(operation, "REQUEST_FAILED", error); context.Response.StatusCode = 502; await WriteAsync(context, new JsonObject { ["error"] = "Runtime dependency failed" }, CancellationToken.None); }
        finally { telemetry.Record("request.completed", operation, context.Response.StatusCode, watch.Elapsed.TotalMilliseconds); }
    }

    /// <summary>Returns SDK-sanitized display metadata without app-user credentials.</summary>
    private async Task InspectorMetadataAsync(HttpContext context, CancellationToken ct)
    {
        InspectorMetadata? metadata;
        try { metadata = await Intelligence.GetInspectorMetadataAsync(ct); }
        catch (Exception error)
        {
            ReportError("inspector.metadata", "INSPECTOR_METADATA_FAILED", error);
            context.Response.StatusCode = 204; return;
        }
        if (metadata is null) { context.Response.StatusCode = 204; return; }
        await context.Response.WriteAsJsonAsync(metadata, cancellationToken: ct);
    }

    private async Task<JsonObject> InfoAsync(CancellationToken ct)
    {
        RuntimeEntitlementResponse entitlement;
        try { entitlement = await Intelligence.GetRuntimeEntitlementsAsync(ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (RuntimeEntitlementException error) when (!error.Retryable)
        {
            entitlement = new(RuntimeEntitlementStatus.Misconfigured, Error: new("runtime_entitlements_misconfigured", "Runtime entitlement lookup is misconfigured", false));
        }
        catch (Exception)
        {
            entitlement = new(RuntimeEntitlementStatus.Unavailable, Error: new("runtime_entitlements_unavailable", "Runtime entitlement lookup failed", true));
        }
        var agents = new JsonObject();
        foreach (var pair in options.Agents) agents[pair.Key] = new JsonObject { ["name"] = pair.Key, ["description"] = pair.Value.Description, ["className"] = pair.Value.GetType().Name };
        var info = new JsonObject
        {
            ["version"] = "0.1.0", ["mode"] = "intelligence", ["agents"] = agents,
            ["audioFileTranscriptionEnabled"] = false, ["a2uiEnabled"] = options.A2UI?.Enabled == true, ["openGenerativeUIEnabled"] = false,
            ["threadEndpoints"] = new JsonObject { ["list"] = true, ["inspect"] = true, ["mutations"] = true, ["realtimeMetadata"] = true },
            ["intelligence"] = new JsonObject { ["wsUrl"] = options.ClientUrl.ToString().TrimEnd('/') },
            ["suggestions"] = false, ["inspectorMetadata"] = true, ["telemetryDisabled"] = telemetry.Disabled, ["runtimeEntitlements"] = JsonSerializer.SerializeToNode(entitlement),
            ["licenseStatus"] = entitlement.Entitlement?.Active == true ? "valid" : entitlement.Error?.Retryable == true ? "unknown" : "none"
        };
        if (options.A2UI?.Enabled == true)
        {
            info["a2ui"] = new JsonObject { ["enabled"] = true };
            if (options.A2UI.Agents is not null) info["a2ui"]!["agents"] = new JsonArray(options.A2UI.Agents.Select(agent => (JsonNode?)JsonValue.Create(agent)).ToArray());
        }
        return info;
    }

    private async Task<JsonObject> StartRunAsync(HttpContext context, RuntimeUser user, string agentId, IRuntimeAgent agent, JsonObject input, CancellationToken ct)
    {
        var mcpServers = options.McpAppsServers.Where(server => server.AgentId is null || server.AgentId == agentId).ToList();
        if (mcpServers.Count > 0 || input["forwardedProps"]?["__proxiedMCPRequest"] is not null) agent = new McpAppsAgent(agent, mcpServers, mcpHttp, name => telemetry.Record(name, "agent.run"));
        var providerCatalog = input["forwardedProps"]?["a2uiCatalogAvailable"] is JsonValue catalog && catalog.TryGetValue<bool>(out var hasCatalog) && hasCatalog;
        if (options.A2UI?.Enabled != false && (options.A2UI is not null || providerCatalog) && (options.A2UI?.Agents is null || options.A2UI.Agents.Contains(agentId))) agent = new A2UIAgent(agent, options.A2UI ?? new A2UIOptions(), providerCatalog);
        var thread = RuntimeValidation.RequiredString(input, "threadId"); var run = RuntimeValidation.RequiredString(input, "runId");
        var container = options.LearningContainer is null ? null : await options.LearningContainer(context, user, agentId, input, ct);
        var create = new JsonObject { ["threadId"] = thread, ["userId"] = user.Id, ["agentId"] = agentId };
        if (container is not null) create["learningContainerId"] = container;
        try { await PlatformAsync("GET", ThreadPath(thread) + "?userId=" + Escape(user.Id), null, user, ct); }
        catch (RuntimeRequestException error) when (error.StatusCode == 404)
        {
            try { await PlatformAsync("POST", "/api/threads", create, user, ct); }
            catch (RuntimeRequestException race) when (race.StatusCode == 409) { await PlatformAsync("GET", ThreadPath(thread) + "?userId=" + Escape(user.Id), null, user, ct); }
        }
        var lockBody = new JsonObject { ["runId"] = run, ["userId"] = user.Id, ["agentId"] = agentId, ["ttlSeconds"] = options.LockTtlSeconds };
        if (container is not null) lockBody["learningContainerId"] = container;
        if (options.LockKeyPrefix is not null) lockBody["lockKeyPrefix"] = options.LockKeyPrefix;
        JsonNode? locked;
        try { locked = await PlatformAsync("POST", ThreadPath(thread) + "/lock", lockBody, user, ct); }
        catch (RuntimeRequestException error) { throw new RuntimeRequestException(error.StatusCode == 409 ? 409 : 502, "Thread lock denied"); }
        PhoenixPublisher? publisher = null;
        ActiveRun? state = null;
        try
        {
            thread = RequiredPlatformString(locked, "threadId"); run = RequiredPlatformString(locked, "runId"); var joinToken = RequiredPlatformString(locked, "joinToken");
            state = new ActiveRun(CancellationTokenSource.CreateLinkedTokenSource(stopping.Token), run, agentId);
            if (!runs.TryAdd(thread, state)) throw new RuntimeRequestException(409, "Thread already running");
            state.Renewal = RenewAsync(thread, run, state.Cancellation, state.RenewalStop.Token);
            using var startup = CancellationTokenSource.CreateLinkedTokenSource(ct, state.Cancellation.Token);
            var canonical = (JsonObject)input.DeepClone(); canonical["threadId"] = thread; canonical["runId"] = run;
            var history = await PlatformAsync("GET", ThreadPath(thread) + "/messages?userId=" + Escape(user.Id), null, user, startup.Token);
            if (history?["messages"] is not JsonArray historic) throw new RuntimeRequestException(502, "Invalid thread history response");
            var ids = historic.Select(message => message?["id"]?.GetValue<string>()).ToHashSet();
            var persisted = new JsonArray(input["messages"]!.AsArray().Where(message => !ids.Contains(message?["id"]?.GetValue<string>())).Select(message => message?.DeepClone()).ToArray());
            var current = state;
            publisher = new PhoenixPublisher(options, thread, run, telemetry, () => current.Cancellation.Cancel());
            state.AbortPublisher = publisher.Abort;
            await publisher.JoinAsync(startup.Token);
            startup.Token.ThrowIfCancellationRequested();
            telemetry.Record("oss.runtime.agent_execution_stream_started", "agent.run");
            state.Execution = ExecuteRunAsync(agent, canonical, persisted, publisher, state, thread, run);
            context.Response.Headers.CacheControl = "no-cache";
            var result = ConnectionInfo(thread, joinToken); result["runId"] = run; return result;
        }
        catch
        {
            if (state is not null) await ReleaseRunAsync(thread, run, state, publisher);
            else { if (publisher is not null) await publisher.DisposeAsync(); await CleanupLockAsync(thread, run); }
            throw;
        }
    }

    private async Task ExecuteRunAsync(IRuntimeAgent agent, JsonObject input, JsonArray persisted, PhoenixPublisher publisher, ActiveRun state, string thread, string run)
    {
        var sequence = new EventSequencer(thread, run);
        var started = false; var terminal = false; var errored = false; var clock = Stopwatch.StartNew();
        var openMessages = new HashSet<string>();
        var openTools = new Dictionary<string, (bool Ended, bool Result)>();
        async Task Emit(JsonObject value, CancellationToken cancellationToken)
        {
            var type = value["type"]?.GetValue<string>();
            if (terminal) return;
            cancellationToken.ThrowIfCancellationRequested();
            if (type == "RUN_STARTED")
            {
                var canonicalInput = (JsonObject)input.DeepClone(); canonicalInput["messages"] = persisted.DeepClone(); value["input"] = canonicalInput;
            }
            var messageId = value["messageId"]?.GetValue<string>();
            var toolCallId = value["toolCallId"]?.GetValue<string>();
            if (type == "TEXT_MESSAGE_START" && messageId is not null) openMessages.Add(messageId);
            if (type == "TEXT_MESSAGE_END" && messageId is not null) openMessages.Remove(messageId);
            if (type == "TOOL_CALL_START" && toolCallId is not null) openTools[toolCallId] = (false, false);
            if (toolCallId is not null && openTools.TryGetValue(toolCallId, out var tool))
            {
                if (type == "TOOL_CALL_END") tool.Ended = true;
                if (type == "TOOL_CALL_RESULT") tool.Result = true;
                if (tool.Ended && tool.Result) openTools.Remove(toolCallId); else openTools[toolCallId] = tool;
            }
            if (openMessages.Count + openTools.Count > 4096) throw new RuntimeRequestException(502, "Too many open stream items");
            if (type == "RUN_ERROR" && !errored)
            {
                errored = true; telemetry.Record("oss.runtime.agent_execution_stream_errored", "agent.run", errorCode: "AGENT_EXECUTION_FAILED");
                ReportError("agent.run", "AGENT_EXECUTION_FAILED", new RuntimeRequestException(502, "Agent emitted RUN_ERROR"));
            }
            await publisher.PublishAsync(sequence.StampAgentEvent(value), cancellationToken);
            if (type == "RUN_STARTED") started = true;
            if (type is "RUN_FINISHED" or "RUN_ERROR") terminal = true;
        }
        async Task CloseOpenItems(CancellationToken cancellationToken)
        {
            if (terminal) return;
            foreach (var id in openMessages.ToArray()) await Emit(new JsonObject { ["type"] = "TEXT_MESSAGE_END", ["messageId"] = id }, cancellationToken);
            foreach (var (id, tool) in openTools.ToArray())
            {
                if (!tool.Ended) await Emit(new JsonObject { ["type"] = "TOOL_CALL_END", ["toolCallId"] = id }, cancellationToken);
                if (!tool.Result) await Emit(new JsonObject { ["type"] = "TOOL_CALL_RESULT", ["toolCallId"] = id, ["messageId"] = id + "-result", ["role"] = "tool", ["content"] = new JsonObject { ["status"] = "error", ["reason"] = "missing_terminal_event", ["message"] = "Run ended without emitting a terminal event" }.ToJsonString() }, cancellationToken);
            }
        }
        var streamCompleted = false;
        try
        {
            await foreach (var value in agent.RunAsync(input, state.Cancellation.Token))
            {
                if (!started && value["type"]?.GetValue<string>() != "RUN_STARTED") await Emit(new JsonObject { ["type"] = "RUN_STARTED" }, state.Cancellation.Token);
                await Emit(value, state.Cancellation.Token);
            }
            if (!started) await Emit(new JsonObject { ["type"] = "RUN_STARTED" }, state.Cancellation.Token);
            if (!terminal)
            {
                await CloseOpenItems(state.Cancellation.Token);
                await Emit(new JsonObject { ["type"] = "RUN_ERROR", ["message"] = "Run ended without emitting a terminal event", ["code"] = "INCOMPLETE_STREAM" }, state.Cancellation.Token);
            }
            await publisher.CompleteAsync(state.Cancellation.Token);
            streamCompleted = true;
        }
        catch (Exception error)
        {
            if (!errored)
            {
                errored = true;
                telemetry.Record("oss.runtime.agent_execution_stream_errored", "agent.run", errorCode: state.Cancellation.IsCancellationRequested ? "RUN_CANCELLED" : "AGENT_EXECUTION_FAILED");
                ReportError("agent.run", "AGENT_EXECUTION_FAILED", error);
            }
            using var finalTimeout = new CancellationTokenSource(options.AckTimeout + TimeSpan.FromSeconds(1));
            try
            {
                if (!started) await Emit(new JsonObject { ["type"] = "RUN_STARTED" }, finalTimeout.Token);
                await CloseOpenItems(finalTimeout.Token);
                if (!terminal) await Emit(new JsonObject { ["type"] = "RUN_ERROR", ["message"] = state.Cancellation.IsCancellationRequested ? "Run canceled" : "Agent execution failed" }, finalTimeout.Token);
                await publisher.CompleteAsync(finalTimeout.Token);
            }
            catch (Exception) { telemetry.Record("run.durability_failed", "agent.run"); }
        }
        finally
        {
            try
            {
                await ReleaseRunAsync(thread, run, state, publisher, completeLifecycle: false);
                if (streamCompleted) telemetry.Record("oss.runtime.agent_execution_stream_ended", "agent.run");
                telemetry.Record("run.completed", "agent.run", durationMs: clock.Elapsed.TotalMilliseconds);
            }
            finally { state.Lifecycle.TrySetResult(); }
        }
    }

    /// <summary>Completes the registered lifecycle only after lease and transport cleanup.</summary>
    private async Task ReleaseRunAsync(string thread, string run, ActiveRun state, PhoenixPublisher? publisher, bool completeLifecycle = true)
    {
        try
        {
            await state.RenewalStop.CancelAsync(); await state.Renewal;
            if (publisher is not null) await publisher.DisposeAsync();
            await CleanupLockAsync(thread, run);
        }
        finally
        {
            runs.TryRemove(new KeyValuePair<string, ActiveRun>(thread, state));
            state.RenewalStop.Dispose(); state.Cancellation.Dispose();
            if (completeLifecycle) state.Lifecycle.TrySetResult();
        }
    }

    private async Task RenewAsync(string thread, string run, CancellationTokenSource runCancellation, CancellationToken ct)
    {
        try
        {
            using var timer = new PeriodicTimer(options.LockHeartbeatInterval);
            while (await timer.WaitForNextTickAsync(ct))
            {
                var body = new JsonObject { ["runId"] = run, ["ttlSeconds"] = options.LockTtlSeconds };
                if (options.LockKeyPrefix is not null) body["lockKeyPrefix"] = options.LockKeyPrefix;
                await PlatformAsync("PATCH", ThreadPath(thread) + "/lock", body, null, ct); telemetry.Record("lock.renewed", "agent.run");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception error) { ReportError("agent.run", "LOCK_RENEWAL_FAILED", error); telemetry.Record("lock.renewal_failed", "agent.run"); await runCancellation.CancelAsync(); }
    }

    private async Task CleanupLockAsync(string thread, string run)
    {
        using var timeout = new CancellationTokenSource(options.RequestTimeout);
        try { await PlatformAsync("DELETE", ThreadPath(thread) + "/lock", new JsonObject { ["runId"] = run }, null, timeout.Token); }
        catch (Exception error) { ReportError("agent.run", "LOCK_CLEANUP_FAILED", error); telemetry.Record("lock.cleanup_failed", "agent.run"); }
    }

    private async Task ThreadsAsync(HttpContext context, string[] parts, RuntimeUser user, CancellationToken ct)
    {
        var method = context.Request.Method;
        if (parts.Length == 1 && method == "GET")
        {
            var agent = context.Request.Query["agentId"].ToString(); if (string.IsNullOrWhiteSpace(agent)) throw new RuntimeRequestException(400, "Valid agentId query param is required");
            var query = "?userId=" + Escape(user.Id) + "&agentId=" + Escape(agent);
            foreach (var key in new[] { "includeArchived", "limit", "cursor" }) if (context.Request.Query.TryGetValue(key, out var value)) query += "&" + key + "=" + Escape(value.ToString());
            await WriteAsync(context, await PlatformAsync("GET", "/api/threads" + query, null, user, ct), ct); return;
        }
        if (parts.Length == 2 && parts[1] == "subscribe" && method == "POST")
        {
            var result = await PlatformAsync("POST", "/api/threads/subscribe", new JsonObject { ["userId"] = user.Id }, user, ct);
            await WriteAsync(context, new JsonObject { ["joinToken"] = RequiredPlatformString(result, "joinToken") }, ct); return;
        }
        if (parts.Length < 2) throw new RuntimeRequestException(404, "Route not found");
        var thread = parts[1];
        if (method == "GET" && parts.Length == 3 && parts[2] is "messages" or "events" or "state")
        {
            if (parts[2] == "messages") { await WriteAsync(context, await PlatformAsync("GET", ThreadPath(thread) + "/messages?userId=" + Escape(user.Id), null, user, ct), ct); return; }
            await PlatformAsync("GET", ThreadPath(thread) + "?userId=" + Escape(user.Id), null, user, ct);
            var data = await PlatformAsync("GET", "/api/_inspect/threads/" + Escape(thread) + "/" + parts[2], null, user, ct);
            await WriteAsync(context, new JsonObject { [parts[2]] = parts[2] == "events" ? data?["events"]?.DeepClone() : data?["kind"]?.GetValue<string>() == "snapshot" ? data?["state"]?.DeepClone() : null }, ct); return;
        }
        if ((method == "PATCH" || method == "DELETE") && parts.Length == 2 || method == "POST" && parts.Length == 3 && parts[2] == "archive")
        {
            var body = await ReadBodyAsync(context, ct); var agent = RuntimeValidation.RequiredString(body, "agentId");
            var mutation = Pick(body, "name"); mutation["userId"] = user.Id; mutation["agentId"] = agent;
            if (parts.Length == 3) mutation["archived"] = true;
            if (method == "DELETE") mutation["reason"] = $"Deleted via CopilotKit runtime (userId={user.Id}, agentId={agent})";
            var result = await PlatformAsync(method == "POST" ? "PATCH" : method, ThreadPath(thread), mutation, user, ct);
            await WriteAsync(context, method == "DELETE" ? new JsonObject { ["threadId"] = thread, ["deleted"] = true } : parts.Length == 3 ? new JsonObject { ["threadId"] = thread, ["archived"] = true } : result?["thread"]?.DeepClone(), ct); return;
        }
        throw new RuntimeRequestException(404, "Route not found");
    }

    private async Task MemoriesAsync(HttpContext context, string[] parts, RuntimeUser user, CancellationToken ct)
    {
        var method = context.Request.Method;
        if (parts.Length > 2) throw new RuntimeRequestException(404, "Route not found");
        var id = parts.ElementAtOrDefault(1);
        var path = "/api/memories" + (id is null ? "" : "/" + Escape(id));
        JsonObject? body = null;
        if (method == "GET" && id is null) { if (context.Request.Query["includeInvalidated"] == "true") path += "?includeInvalidated=true"; }
        else if (method == "POST" && id == "subscribe") { }
        else if (method == "DELETE" && id is not null) { }
        else if (method == "POST" && id == "recall")
        {
            body = Pick(await ReadBodyAsync(context, ct), "query", "limit", "scope"); RuntimeValidation.RequiredString(body, "query");
            if (body["limit"] is not null && (body["limit"] is not JsonValue value || !value.TryGetValue<int>(out var limit) || limit <= 0)) throw new RuntimeRequestException(400, "Recall limit must be a positive integer");
        }
        else if (method == "POST" && id is null || method == "PATCH" && id is not null)
        {
            body = Pick(await ReadBodyAsync(context, ct), "content", "kind", "scope", "sourceThreadIds");
            RuntimeValidation.RequiredString(body, "content");
            if (RuntimeValidation.RequiredString(body, "kind") is not ("topical" or "episodic" or "operational")) throw new RuntimeRequestException(400, "Invalid memory kind");
            body["sourceThreadIds"] ??= new JsonArray();
            if (body["sourceThreadIds"] is not JsonArray ids || ids.Any(node => node is not JsonValue item || !item.TryGetValue<string>(out _))) throw new RuntimeRequestException(400, "sourceThreadIds must be an array of strings");
        }
        else throw new RuntimeRequestException(404, "Route not found");
        if (body?["scope"] is not null && body["scope"]!.GetValue<string>() is not ("user" or "project")) throw new RuntimeRequestException(400, "Invalid memory scope");
        JsonObject? grant;
        try { grant = options.MemoryGrant is null ? null : await options.MemoryGrant(context, user, ct); }
        catch (Exception error) { throw new MemoryPolicyException("Memory policy failed", error); }
        if (options.MemoryGrant is not null && grant is null) throw new RuntimeRequestException(403, "Memory access denied");
        if (grant is not null)
        {
            foreach (var name in new[] { "user", "project" })
                if (grant[name] is not JsonValue value || !value.TryGetValue<string>(out var level) || level is not ("none" or "read" or "read-write")) throw new MemoryPolicyException("Memory policy returned an invalid grant");
            grant = Pick(grant, "user", "project");
            if (grant["user"]!.GetValue<string>() == "none" && grant["project"]!.GetValue<string>() == "none") throw new RuntimeRequestException(403, "Memory access denied");
            var write = method is "PATCH" or "DELETE" || method == "POST" && id is null;
            var scope = body?["scope"]?.GetValue<string>();
            if (scope is null && id is not null && (method is "PATCH" or "DELETE"))
            {
                // The platform resolves the existing memory's scope and enforces this grant.
                if (grant["user"]!.GetValue<string>() != "read-write" && grant["project"]!.GetValue<string>() != "read-write") throw new RuntimeRequestException(403, "Memory access denied");
            }
            else if (write || scope is not null)
            {
                var access = grant[scope ?? "user"]!.GetValue<string>();
                if (access == "none" || write && access != "read-write") throw new RuntimeRequestException(403, "Memory access denied");
            }
        }
        var result = await PlatformAsync(method, path, body, user, ct, grant);
        if (method == "DELETE") { context.Response.StatusCode = 204; return; }
        if ((method == "GET" || id == "recall") && result?["memories"] is not JsonArray) throw new RuntimeRequestException(502, "Invalid memory list response");
        if (method == "POST" && id is null) context.Response.StatusCode = 201;
        await WriteAsync(context, result, ct);
    }

    private async Task<JsonNode?> PlatformAsync(string method, string path, JsonNode? body, RuntimeUser? user, CancellationToken ct, JsonObject? grant = null)
    {
        var headers = new Dictionary<string, string>();
        if (user is not null) headers["x-cpki-user-id"] = user.Id;
        if (grant is not null) headers["x-cpki-memory-grant"] = grant.ToJsonString();
        try { return await Intelligence.RequestAsync(new HttpMethod(method), path, body, ct, headers); }
        catch (IntelligenceException error)
        {
            throw new RuntimeRequestException(error.StatusCode, "Intelligence platform request failed");
        }
    }

    private async Task<JsonObject> ReadBodyAsync(HttpContext context, CancellationToken ct, bool allowEmpty = false)
    {
        if (context.Request.ContentLength > options.MaxRequestBytes) throw new RuntimeRequestException(413, "Request exceeds size limit");
        using var stream = new MemoryStream(); var buffer = new byte[8192]; int size;
        while ((size = await context.Request.Body.ReadAsync(buffer, ct)) > 0)
        {
            if (stream.Length + size > options.MaxRequestBytes) throw new RuntimeRequestException(413, "Request exceeds size limit"); stream.Write(buffer, 0, size);
        }
        if (allowEmpty && stream.Length == 0) return new JsonObject();
        return JsonNode.Parse(stream.ToArray()) as JsonObject ?? throw new RuntimeRequestException(400, "Expected JSON object");
    }
    private static string Escape(string value) => Uri.EscapeDataString(value);
    private static string ThreadPath(string thread) => "/api/threads/" + Escape(thread);
    private static string RequiredPlatformString(JsonNode? value, string field) => value?[field] is JsonValue item && item.TryGetValue<string>(out var text) && !string.IsNullOrWhiteSpace(text) ? text : throw new RuntimeRequestException(502, "Platform credentials unavailable");
    private JsonObject ConnectionInfo(string thread, string token) => new() { ["threadId"] = thread, ["joinToken"] = token, ["realtime"] = new JsonObject { ["clientUrl"] = options.ClientUrl.ToString().TrimEnd('/'), ["topic"] = "thread:" + thread } };
    private static JsonObject Pick(JsonObject source, params string[] keys)
    {
        var result = new JsonObject(); foreach (var key in keys) if (source.ContainsKey(key)) result[key] = source[key]?.DeepClone(); return result;
    }
    private static Task WriteAsync(HttpContext context, JsonNode? value, CancellationToken ct) => context.Response.WriteAsJsonAsync(value, cancellationToken: ct);

    private void ReportError(string operation, string code, Exception error)
    {
        try { options.OnError?.Invoke(new RuntimeError(operation, code, error)); }
        catch (Exception) { /* An application error reporter cannot replace the original result. */ }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        await stopping.CancelAsync();
        try { await Task.WhenAll(runs.Values.Select(run => run.Completion)).WaitAsync(options.RequestTimeout); }
        catch (TimeoutException error)
        {
            ReportError("agent.run", "RUN_SHUTDOWN_TIMEOUT", error);
            var outstanding = runs.ToArray();
            foreach (var pair in outstanding) pair.Value.AbortPublisher?.Invoke();
            await Task.WhenAll(outstanding.Select(pair => CleanupLockAsync(pair.Key, pair.Value.RunId)));
        }
        await telemetry.DisposeAsync(); stopping.Dispose(); mcpHttp.Dispose(); if (ownsHttp) http.Dispose();
        if (ownsIntelligence) Intelligence.Dispose();
    }
}
