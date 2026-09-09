using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>A single-run Phoenix channel with acknowledged delivery and bounded retry. An event remains unchanged until ACK.</summary>
internal sealed class PhoenixPublisher(RuntimeOptions options, string threadId, string runId, RuntimeTelemetry telemetry, Action stop) : IAsyncDisposable
{
    private ClientWebSocket? socket;
    private CancellationTokenSource? connection;
    private Task? receiver;
    private Task? heartbeat;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> pending = new();
    private readonly SemaphoreSlim sender = new(1, 1);
    private long reference;
    private string joinRef = "1";
    private string Topic => "ingestion:" + runId;

    public async Task JoinAsync(CancellationToken cancellationToken)
    {
        await CloseConnectionAsync();
        socket = new ClientWebSocket();
        socket.Options.AddSubProtocol("phoenix");
        socket.Options.AddSubProtocol("base64url.bearer.phx." + Convert.ToBase64String(Encoding.UTF8.GetBytes(options.ApiKey)).TrimEnd('='));
        var uri = new UriBuilder(options.RunnerUrl);
        uri.Scheme = uri.Scheme is "https" or "wss" ? "wss" : "ws";
        uri.Path = uri.Path.TrimEnd('/') + (uri.Path.TrimEnd('/').EndsWith("/websocket", StringComparison.Ordinal) ? "" : "/websocket");
        uri.Query = string.IsNullOrEmpty(uri.Query) ? "vsn=2.0.0" : uri.Query.TrimStart('?') + "&vsn=2.0.0";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.RequestTimeout);
        await socket.ConnectAsync(uri.Uri, timeout.Token);
        connection = new CancellationTokenSource();
        receiver = ReceiveAsync(socket, connection.Token);
        joinRef = Interlocked.Increment(ref reference).ToString(System.Globalization.CultureInfo.InvariantCulture);
        await PushAsync("phx_join", new JsonObject { ["thread_id"] = threadId, ["run_id"] = runId }, timeout.Token, joinRef);
        heartbeat = HeartbeatAsync(connection.Token);
        telemetry.Record("gateway.joined", "agent.run");
    }

    public async Task PublishAsync(JsonObject value, CancellationToken cancellationToken)
    {
        var payload = (JsonObject)value.DeepClone();
        payload["thread_id"] = threadId; payload["run_id"] = runId;
        var elapsed = Stopwatch.StartNew();
        var attempt = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (socket?.State != WebSocketState.Open) await JoinAsync(cancellationToken);
                await PushAsync("event", payload, cancellationToken);
                telemetry.Record("gateway.event_acknowledged", "agent.run", durationMs: elapsed.Elapsed.TotalMilliseconds, attempt: attempt);
                return;
            }
            catch (Exception error) when (error is WebSocketException or IOException or TimeoutException or OperationCanceledException)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (elapsed.Elapsed >= options.DeliveryTimeout) throw new RuntimeRequestException(502, "Event durability deadline exceeded");
                telemetry.Record("gateway.event_retry", "agent.run", attempt: ++attempt);
                await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(100 * Math.Pow(2, Math.Min(attempt, 5)), 2000)), cancellationToken);
            }
        }
    }

    private async Task<JsonObject> PushAsync(string name, JsonObject payload, CancellationToken cancellationToken, string? explicitReference = null, string? topic = null)
    {
        var id = explicitReference ?? Interlocked.Increment(ref reference).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var completion = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        try
        {
            var message = new JsonArray(topic == "phoenix" ? null : joinRef, id, topic ?? Topic, name, payload.DeepClone());
            await sender.WaitAsync(cancellationToken);
            try { await socket!.SendAsync(Encoding.UTF8.GetBytes(message.ToJsonString()), WebSocketMessageType.Text, true, cancellationToken); }
            finally { sender.Release(); }
            var reply = await completion.Task.WaitAsync(options.AckTimeout, cancellationToken);
            if (reply["status"]?.GetValue<string>() != "ok") throw new RuntimeRequestException(502, "Gateway rejected " + name);
            return reply;
        }
        finally { pending.TryRemove(id, out _); }
    }

    private async Task ReceiveAsync(ClientWebSocket webSocket, CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using var content = new MemoryStream();
                WebSocketReceiveResult part;
                do
                {
                    part = await webSocket.ReceiveAsync(buffer, cancellationToken);
                    if (part.MessageType == WebSocketMessageType.Close) throw new IOException("Gateway connection closed");
                    content.Write(buffer, 0, part.Count);
                    if (content.Length > 4 * 1024 * 1024) throw new IOException("Gateway frame exceeds limit");
                } while (!part.EndOfMessage);
                if (JsonNode.Parse(content.ToArray()) is not JsonArray frame || frame.Count < 5) continue;
                var name = frame[3]?.GetValue<string>();
                if (name == "phx_reply" && frame[1]?.GetValue<string>() is { } id && pending.TryRemove(id, out var waiter) && frame[4] is JsonObject reply) waiter.TrySetResult(reply);
                if (name is "phx_close" or "phx_error") { webSocket.Abort(); throw new IOException("Gateway channel closed"); }
                if (name == "ag_ui_event" && frame[4]?["type"]?.GetValue<string>() == "CUSTOM" && frame[4]?["name"]?.GetValue<string>() == "stop") stop();
            }
        }
        catch (Exception error)
        {
            foreach (var item in pending.Values) item.TrySetException(new IOException("Gateway disconnected", error));
        }
    }

    private async Task HeartbeatAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
            while (await timer.WaitForNextTickAsync(cancellationToken)) await PushAsync("heartbeat", new JsonObject(), cancellationToken, topic: "phoenix");
        }
        catch (Exception) { socket?.Abort(); }
    }

    private async Task CloseConnectionAsync()
    {
        if (connection is not null) await connection.CancelAsync();
        socket?.Abort();
        if (receiver is not null) await receiver;
        if (heartbeat is not null) await heartbeat;
        socket?.Dispose(); connection?.Dispose();
        receiver = null; heartbeat = null; connection = null;
    }

    public async ValueTask DisposeAsync()
    {
        if (socket?.State == WebSocketState.Open)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            try { await PushAsync("phx_leave", new JsonObject(), timeout.Token); } catch (Exception) { }
        }
        await CloseConnectionAsync(); sender.Dispose();
    }
}
