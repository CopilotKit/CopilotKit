using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class InspectorTests
{
    internal static async Task RunAsync()
    {
        await ParsesMetadata();
        await Task.WhenAll(HandlesAbsentMetadata(), RejectsMalformedMetadata(), BoundsMetadataRequest());
        await PreservesShortDeadlineAndCancellation();
        await SkipsAbsentBodies();
        await PreservesPlatformErrors();
    }

    private static async Task ParsesMetadata()
    {
        using var handler = new CaptureHandler { ResponseBody = """
            {"schemaVersion":1,"identity":{"organizationName":" Org ","projectName":" Project "},
            "plan":{"code":"pro","label":"Pro"},"license":{"state":"valid"},
            "action":{"kind":"manage_plan","url":"https://example.com/plans"},
            "usage":{"used":0,"limit":{"kind":"finite","value":100},"expiringSoonCount":0},"secret":"discard"}
            """ };
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var result = await sdk.GetInspectorMetadataAsync();
        var json = JsonSerializer.SerializeToNode(result);

        Check(JsonNode.DeepEquals(json, JsonNode.Parse("""
            {"schemaVersion":1,"identity":{"organizationName":"Org","projectName":"Project"},
            "plan":{"code":"pro","label":"Pro"},"license":{"state":"valid"},
            "action":{"kind":"manage_plan","url":"https://example.com/plans"},
            "usage":{"used":0,"limit":{"kind":"finite","value":100},"expiringSoonCount":0}}
            """)), "Inspector metadata uses canonical fields and retains known zero values");
        foreach (var (body, expected) in new (string, string)[]
        {
            ("null", "null"), ("[]", "null"), ("{\"schemaVersion\":2}", "null"),
            ("{\"schemaVersion\":true}", "null"), ("{\"schemaVersion\":1.0}", "{\"schemaVersion\":1}"),
            ("""{"schemaVersion":1,"identity":{},"plan":{"code":" x ","label":" X "},"license":{"state":"bad"},"usage":{"used":-1,"limit":{"kind":"unlimited"}}} """,
             """{"schemaVersion":1,"plan":{"code":"x","label":"X"}}"""),
            ("""{"schemaVersion":1,"usage":{"used":9007199254740991,"limit":{"kind":"unknown","value":3},"expiringSoonCount":-1}}""",
             """{"schemaVersion":1,"usage":{"used":9007199254740991,"limit":{"kind":"unknown"}}}"""),
            ("""{"schemaVersion":1,"usage":{"used":9007199254740992,"limit":{"kind":"unlimited"}}}""", "{\"schemaVersion\":1}")
        })
        {
            handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, body));
            result = await sdk.GetInspectorMetadataAsync();
            Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), JsonNode.Parse(expected)), "Inspector modules validate independently: " + body);
        }
        foreach (var url in new[] { "http://remote.test", "https://example.com?", "https://example.com#", "https://@example.com", "https://user:pass@example.com", "https://exa%20mple.com", "https://example.com:99999", "ftp://example.com", "https://[invalid]" })
        {
            handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, new JsonObject { ["schemaVersion"] = 1, ["action"] = new JsonObject { ["kind"] = "renew", ["url"] = url } }.ToJsonString()));
            result = await sdk.GetInspectorMetadataAsync();
            Check(JsonSerializer.SerializeToNode(result)?["action"] is null, "Inspector rejects unsafe action URL: " + url);
        }
        foreach (var url in new[] { "https://example.com/plans", "http://localhost:8080", "http://127.0.0.1/renew", "http://[::1]/renew" })
        {
            handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, new JsonObject { ["schemaVersion"] = 1, ["action"] = new JsonObject { ["kind"] = "renew", ["url"] = " " + url + " " } }.ToJsonString()));
            result = await sdk.GetInspectorMetadataAsync();
            Check(result?.Action?.Url == url && result.Action.Kind == InspectorActionKind.Renew, "Inspector retains safe action URL: " + url);
        }
        Check(handler.Method == "GET" && handler.Url == "https://api.intelligence.copilotkit.ai/api/inspector/metadata"
            && handler.Authorization == "Bearer key" && handler.Body is null, "metadata uses server credentials and a bodyless GET");
    }

    private static async Task HandlesAbsentMetadata()
    {
        foreach (var status in new[] { System.Net.HttpStatusCode.NoContent, System.Net.HttpStatusCode.NotFound })
        {
            using var handler = new CaptureHandler { StatusCode = status, ResponseBody = "provider-secret-payload" };
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            var result = await sdk.GetInspectorMetadataAsync();

            Check(result is null && handler.Calls == 1, "metadata absence ignores the response body: " + status);
        }
    }

    private static async Task RejectsMalformedMetadata()
    {
        foreach (var body in new[] { "", " ", "provider-secret-payload" })
        {
            using var http = new HttpClient(new CaptureHandler { ResponseBody = body });
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            try { await sdk.GetInspectorMetadataAsync(); throw new Exception("malformed metadata must fail"); }
            catch (IntelligenceException error)
            {
                Check(error.StatusCode == 502 && !error.ToString().Contains("provider-secret-payload"), "invalid metadata JSON fails without private content");
            }
        }
    }

    private static async Task BoundsMetadataRequest()
    {
        using var handler = new CaptureHandler { WaitForCancellation = true };
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        using var cancellation = new CancellationTokenSource();
        var request = sdk.GetInspectorMetadataAsync(cancellation.Token);
        try
        {
            await handler.Started.Task;
            try { await request.WaitAsync(TimeSpan.FromSeconds(7)); throw new Exception("metadata deadline did not cancel"); }
            catch (OperationCanceledException) { Check(true, "metadata caps the configured 30-second request at five seconds"); }
        }
        finally
        {
            cancellation.Cancel();
            try { await request; } catch (OperationCanceledException) { }
        }
    }

    private static async Task PreservesShortDeadlineAndCancellation()
    {
        foreach (var cancelCaller in new[] { false, true })
        {
            using var stream = new PendingStream();
            using var http = new HttpClient(new StreamHandler(System.Net.HttpStatusCode.OK, stream));
            using var sdk = new IntelligenceClient(new IntelligenceOptions
            {
                ApiKey = "key", RequestTimeout = cancelCaller ? TimeSpan.FromSeconds(30) : TimeSpan.FromMilliseconds(50)
            }, http);
            using var cancellation = new CancellationTokenSource();

            var request = sdk.GetInspectorMetadataAsync(cancellation.Token);
            await stream.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
            if (cancelCaller) cancellation.Cancel();
            try { await request.WaitAsync(TimeSpan.FromSeconds(2)); throw new Exception("streamed metadata did not cancel"); }
            catch (OperationCanceledException) { }

            Check(stream.Disposed, "streamed metadata retains caller cancellation and shorter SDK deadlines: " + cancelCaller);
        }
    }

    private static async Task SkipsAbsentBodies()
    {
        foreach (var status in new[] { System.Net.HttpStatusCode.NoContent, System.Net.HttpStatusCode.NotFound })
        {
            using var stream = new PendingStream();
            using var http = new HttpClient(new StreamHandler(status, stream));
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            var result = await sdk.GetInspectorMetadataAsync().WaitAsync(TimeSpan.FromSeconds(2));

            Check(result is null && !stream.Started.Task.IsCompleted && stream.Disposed, "absence closes unread metadata bodies: " + status);
        }
    }

    private static async Task PreservesPlatformErrors()
    {
        foreach (var status in new[] { 401, 403, 429, 503 })
        {
            using var http = new HttpClient(new CaptureHandler { StatusCode = (System.Net.HttpStatusCode)status, ResponseBody = "provider-secret-payload" });
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            try { await sdk.GetInspectorMetadataAsync(); throw new Exception("provider errors must fail"); }
            catch (IntelligenceException error)
            {
                Check(error.StatusCode == status && !error.ToString().Contains("provider-secret-payload"), "metadata retains provider status without content: " + status);
            }
        }
    }

    private sealed class StreamHandler(System.Net.HttpStatusCode status, Stream stream) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(status) { Content = new StreamContent(stream) });
    }

    private sealed class PendingStream : Stream
    {
        internal TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool Disposed { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return 0;
        }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }
}
